/**
 * Maps an Anki collection onto Inkling decks, cards and review history. Pure: the rows
 * come in already read from the collection's SQLite file (see `main/import/anki.ts`) and
 * a plan comes out for `main/repos/imports.ts` to write in one transaction.
 *
 * Two collection layouts exist. Schema 11 (`collection.anki2`, `collection.anki21`)
 * keeps note types and decks as JSON in the `col` row. Schema 18 (`collection.anki21b`)
 * has `notetypes`, `fields`, `templates` and `decks` tables, with protobuf configs and
 * deck names split by \x1f instead of `::`.
 *
 * A card's front and back are the fields its template shows: the front is what the
 * question side references, the back what the answer side adds. That covers Basic, the
 * reversed and type-in variants and cloze alike. Without a usable template, ord 1 swaps
 * the first two fields and any further fields go on the back.
 */
import { ankiHtmlToText } from './ankiText'
import { DEFAULT_PARAMS, fromSm2, nextMemoryState, type CardState, type MemoryState, type Rating } from './fsrs'
import { replayMemoryState, toSequence } from './fsrs-optimise'

const FIELD_SEPARATOR = String.fromCharCode(0x1f)
const DAY_MS = 86_400_000

/* --------------------------------- Raw rows -------------------------------- */

export interface AnkiColRow {
  crt: number
  models: string
  decks: string
}
export interface AnkiNotetypeRow {
  id: number
  name: string
  config: Uint8Array
}
export interface AnkiFieldRow {
  ntid: number
  ord: number
  name: string
}
export interface AnkiTemplateRow {
  ntid: number
  ord: number
  config: Uint8Array
}
export interface AnkiDeckRow {
  id: number
  name: string
}
export interface AnkiNoteRow {
  id: number
  guid: string
  mid: number
  flds: string
}
export interface AnkiCardRow {
  id: number
  nid: number
  did: number
  ord: number
  type: number
  queue: number
  due: number
  ivl: number
  factor: number
  reps: number
  lapses: number
  odid: number
  odue: number
  data: string
}
export interface AnkiRevlogRow {
  id: number
  cid: number
  ease: number
  ivl: number
  type: number
}

/** Everything read from a collection. The schema 18 tables are empty on older layouts. */
export interface AnkiRows {
  col: AnkiColRow
  notetypes: AnkiNotetypeRow[]
  fields: AnkiFieldRow[]
  templates: AnkiTemplateRow[]
  decks: AnkiDeckRow[]
  notes: AnkiNoteRow[]
  cards: AnkiCardRow[]
  revlog: AnkiRevlogRow[]
}

/* ------------------------------- Note types -------------------------------- */

export interface AnkiNoteType {
  cloze: boolean
  imageOcclusion: boolean
  fields: string[]
  /** Question and answer templates by card ord. */
  templates: Map<number, { q: string; a: string }>
}

/** `originalStockKind` / `original_stock_kind` of Anki's image occlusion note type. */
const STOCK_KIND_IMAGE_OCCLUSION = 6

type ProtoValue = number | Uint8Array

/** Reads the top-level fields of a protobuf message; enough for the configs used here. */
export function readProto(buf: Uint8Array): Map<number, ProtoValue[]> {
  const out = new Map<number, ProtoValue[]>()
  let i = 0
  const varint = (): number => {
    let value = 0
    let scale = 1
    for (;;) {
      if (i >= buf.length) throw new Error('truncated protobuf')
      const b = buf[i++]
      value += (b & 0x7f) * scale
      if (b < 0x80) return value
      scale *= 128
    }
  }
  while (i < buf.length) {
    const key = varint()
    const field = Math.floor(key / 8)
    const wire = key % 8
    let value: ProtoValue
    if (wire === 0) value = varint()
    else if (wire === 2) {
      const len = varint()
      value = buf.subarray(i, i + len)
      i += len
    } else if (wire === 1) {
      i += 8
      continue
    } else if (wire === 5) {
      i += 4
      continue
    } else throw new Error(`unsupported protobuf wire type ${wire}`)
    out.set(field, [...(out.get(field) ?? []), value])
  }
  return out
}

function safeProto(buf: Uint8Array | null): Map<number, ProtoValue[]> | null {
  try {
    return buf ? readProto(buf) : null
  } catch {
    return null
  }
}

const protoString = (msg: Map<number, ProtoValue[]>, field: number): string => {
  const v = msg.get(field)?.[0]
  return v instanceof Uint8Array ? new TextDecoder().decode(v) : ''
}
const protoNumber = (msg: Map<number, ProtoValue[]>, field: number): number => {
  const v = msg.get(field)?.[0]
  return typeof v === 'number' ? v : 0
}

export function readNoteTypes(rows: AnkiRows): Map<number, AnkiNoteType> {
  const types = new Map<number, AnkiNoteType>()
  if (rows.notetypes.length > 0) {
    // Schema 18. Notetype.Config: kind = 1 (1 = cloze), original_stock_kind = 9.
    // Template.Config: q_format = 1, a_format = 2.
    for (const nt of rows.notetypes) {
      // An unreadable config reads as a plain note type.
      const config = safeProto(nt.config) ?? new Map<number, ProtoValue[]>()
      types.set(nt.id, {
        cloze: protoNumber(config, 1) === 1,
        imageOcclusion: protoNumber(config, 9) === STOCK_KIND_IMAGE_OCCLUSION,
        fields: [],
        templates: new Map()
      })
    }
    for (const f of [...rows.fields].sort((a, b) => a.ord - b.ord)) types.get(f.ntid)?.fields.push(f.name)
    for (const t of rows.templates) {
      const config = safeProto(t.config)
      if (config) types.get(t.ntid)?.templates.set(t.ord, { q: protoString(config, 1), a: protoString(config, 2) })
    }
    return types
  }

  // Schema 11: `col.models` is a JSON object keyed by note type id; type 1 is cloze.
  let models: Record<string, unknown> = {}
  try {
    models = JSON.parse(rows.col.models || '{}') as Record<string, unknown>
  } catch {
    /* no note types: every card reads as unusable */
  }
  for (const [key, value] of Object.entries(models)) {
    const m = value as {
      id?: number | string
      type?: number
      originalStockKind?: number
      flds?: Array<{ name: string; ord: number }>
      tmpls?: Array<{ ord: number; qfmt: string; afmt: string }>
    }
    types.set(Number(m.id ?? key), {
      cloze: m.type === 1,
      imageOcclusion: m.originalStockKind === STOCK_KIND_IMAGE_OCCLUSION,
      fields: [...(m.flds ?? [])].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: new Map((m.tmpls ?? []).map((t) => [t.ord, { q: t.qfmt ?? '', a: t.afmt ?? '' }]))
    })
  }
  return types
}

/** Deck names by id, with Anki's `::` between parent and child. */
export function readDecks(rows: AnkiRows): Map<number, string> {
  const decks = new Map<number, string>()
  if (rows.decks.length > 0) {
    for (const d of rows.decks) decks.set(d.id, d.name.split(FIELD_SEPARATOR).join('::'))
    return decks
  }
  try {
    const json = JSON.parse(rows.col.decks || '{}') as Record<string, { id?: number | string; name?: string }>
    for (const [key, d] of Object.entries(json)) decks.set(Number(d.id ?? key), d.name ?? 'Default')
  } catch {
    /* cards of unknown decks land in "Default", as in Anki */
  }
  return decks
}

/* -------------------------------- Templates -------------------------------- */

/** Template tags that are not fields. */
const SPECIAL_TAGS = new Set(['FrontSide', 'Tags', 'Type', 'Deck', 'Subdeck', 'Card', 'CardFlag', 'CardID'])

/**
 * The fields a template shows, as indexes in order. Section tags (`{{#X}}`, `{{^X}}`,
 * `{{/X}}`) and comments are skipped; filters (`cloze:`, `hint:`, `text:`) are peeled off.
 * `{{type:X}}` is an answer box: on the question side it shows nothing of X.
 */
export function templateFields(format: string, names: readonly string[], question: boolean): number[] {
  const out: number[] = []
  for (const match of format.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const tag = match[1].trim()
    if (/^[#^/!]/.test(tag)) continue
    const parts = tag.split(':')
    const name = parts[parts.length - 1].trim()
    if (SPECIAL_TAGS.has(name)) continue
    if (question && parts.slice(0, -1).some((p) => p.trim() === 'type')) continue
    const index = names.indexOf(name)
    if (index >= 0 && !out.includes(index)) out.push(index)
  }
  return out
}

/** Which fields make the front and which the back of card `ord`. */
export function cardSides(type: AnkiNoteType, ord: number): { front: number[]; back: number[] } {
  const all = type.fields.map((_, i) => i)
  const template = type.templates.get(type.cloze ? 0 : ord)
  if (template) {
    const front = templateFields(template.q, type.fields, true)
    const back = templateFields(template.a, type.fields, false).filter((i) => !front.includes(i))
    if (front.length > 0) return { front, back }
  }
  if (type.cloze) return { front: [0], back: all.slice(1) }
  const first = ord === 1 && all.length > 1 ? 1 : 0
  return { front: [first], back: [...all.slice(0, 2).filter((i) => i !== first), ...all.slice(2)] }
}

/* -------------------------------- The plan --------------------------------- */

export interface ImportReview {
  rating: Rating
  /** The state the card was in when asked, as `review_log.state` records it. */
  state: CardState
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reviewedAt: string
}

export interface ImportCard {
  /** `anki:<note guid>:<card ord>`, so a second import can skip it. */
  externalId: string
  /** The Anki deck id; the plan's `decks` holds its name. */
  deck: number
  front: string
  back: string
  cloze: number
  state: CardState
  due: string
  stability: number | null
  difficulty: number | null
  lastReview: string | null
  intervalDays: number
  repetitions: number
  easeFactor: number
  reviews: ImportReview[]
}

export interface ImportSkipped {
  /** Images, sounds and videos removed from imported notes. */
  media: number
  suspended: number
  imageOcclusion: number
  /** Cards whose question is only an image or a sound. */
  mediaOnly: number
  /** Cards whose note or note type is missing, or that come out empty. */
  unusable: number
}

export interface ImportPlan {
  decks: Array<{ id: number; name: string }>
  cards: ImportCard[]
  skipped: ImportSkipped
}

/** Anki card types: 0 new, 1 learning, 2 review, 3 relearning. */
const STATES: readonly CardState[] = ['new', 'learning', 'review', 'relearning']
/** Revlog types: 0 learning, 1 review, 2 relearning, 3 filtered, 4 manual, 5 rescheduled. */
const REVLOG_STATES: Record<number, CardState> = { 0: 'learning', 1: 'review', 2: 'relearning', 3: 'review' }

/** A "Forget" or reset: a manual entry with no answer that put the card back to new. */
const isReset = (r: AnkiRevlogRow): boolean => r.ease === 0 && r.type === 4 && r.ivl === 0

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** FSRS state Anki stored on the card (`cards.data` JSON: s, d, lrt), if any. */
function storedMemory(data: string): { state: MemoryState; lastReview: number | null } | null {
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as { s?: unknown; d?: unknown; lrt?: unknown }
    if (typeof parsed.s !== 'number' || typeof parsed.d !== 'number' || !(parsed.s > 0) || !(parsed.d > 0)) return null
    // Anki keeps difficulty on FSRS's own 1-10 scale. A value below 1 can only be the
    // 0-1 fraction its browser shows, so it is scaled up rather than clamped.
    const difficulty = parsed.d < 1 ? 1 + parsed.d * 9 : parsed.d
    return {
      state: { stability: parsed.s, difficulty: clamp(difficulty, 1, 10) },
      lastReview: typeof parsed.lrt === 'number' && parsed.lrt > 0 ? parsed.lrt * 1000 : null
    }
  } catch {
    return null
  }
}

/**
 * Turns the rows of an Anki collection into what Inkling writes. `now` stamps new cards
 * as due; `params` are the FSRS parameters used to replay review histories.
 */
export function planImport(rows: AnkiRows, now: Date, params: readonly number[] = DEFAULT_PARAMS): ImportPlan {
  const types = readNoteTypes(rows)
  const deckNames = readDecks(rows)
  const notes = new Map(rows.notes.map((n) => [n.id, n]))
  const crtMs = rows.col.crt * 1000
  // A date that can't be represented falls back to now: one odd card must not
  // abort a whole import.
  const safeIso = (ms: number): string => {
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? now.toISOString() : d.toISOString()
  }
  const dayToIso = (day: number): string => safeIso(crtMs + day * DAY_MS)

  const revlog = new Map<number, AnkiRevlogRow[]>()
  for (const r of rows.revlog) {
    const list = revlog.get(r.cid)
    if (list) list.push(r)
    else revlog.set(r.cid, [r])
  }

  const skipped: ImportSkipped = { media: 0, suspended: 0, imageOcclusion: 0, mediaOnly: 0, unusable: 0 }
  const mediaCounted = new Set<number>()
  const cards: ImportCard[] = []
  const usedDecks = new Set<number>()

  // Anki's order: new cards by their queue position, the rest as they were created.
  const ordered = [...rows.cards].sort((a, b) =>
    a.type === 0 && b.type === 0 ? a.due - b.due || a.id - b.id : a.type === 0 ? 1 : b.type === 0 ? -1 : a.id - b.id
  )

  for (const card of ordered) {
    if (card.queue === -1) {
      skipped.suspended++
      continue
    }
    const note = notes.get(card.nid)
    const type = note ? types.get(note.mid) : undefined
    if (!note || !type) {
      skipped.unusable++
      continue
    }
    const raw = note.flds.split(FIELD_SEPARATOR)
    if (type.imageOcclusion || raw.some((f) => /\{\{c\d+::image-occlusion:/.test(f))) {
      skipped.imageOcclusion++
      continue
    }

    const sides = cardSides(type, card.ord)
    const texts = raw.map(ankiHtmlToText)
    const join = (idx: number[], sep: string): string =>
      idx
        .map((i) => texts[i]?.text ?? '')
        .filter(Boolean)
        .join(sep)
    const front = join(sides.front, '\n')
    const back = join(sides.back, '\n\n')
    const cloze = type.cloze ? card.ord + 1 : 0
    if (!front && sides.front.some((i) => (texts[i]?.media ?? 0) > 0)) {
      // The question is a picture or a sound, which Inkling can't show yet.
      skipped.mediaOnly++
      continue
    }
    if (!front || (cloze > 0 && !new RegExp(`\\{\\{c${cloze}::`).test(front))) {
      skipped.unusable++
      continue
    }
    if (!mediaCounted.has(note.id)) {
      mediaCounted.add(note.id)
      skipped.media += [...sides.front, ...sides.back].reduce((n, i) => n + (texts[i]?.media ?? 0), 0)
    }

    // A card in a filtered deck belongs to its home deck and keeps its home due date.
    const deck = card.odid ? card.odid : card.did
    const dueNumber = card.odid && card.odue ? card.odue : card.due
    // The old (v1) scheduler kept a lapsed card as type 2 in the learning queue
    // while it relearned, with its due date as a timestamp in seconds.
    const state = card.type === 2 && card.queue === 1 ? 'relearning' : (STATES[card.type] ?? 'new')
    const due =
      state === 'new'
        ? now.toISOString()
        : state === 'review'
          ? dayToIso(dueNumber)
          : // Learning steps are due at a timestamp in seconds, day-long steps on a day number.
            dueNumber > 1_000_000_000
            ? safeIso(dueNumber * 1000)
            : dayToIso(dueNumber)

    const history = [...(revlog.get(card.id) ?? [])].sort((a, b) => a.id - b.id)
    let lastReset = -1
    history.forEach((r, i) => {
      if (isReset(r)) lastReset = i
    })
    const answered = (r: AnkiRevlogRow): boolean => r.ease >= 1 && r.ease <= 4
    const graded = history.filter(answered)
    const current = history.slice(lastReset + 1).filter(answered)
    // Complete: it starts with the card's very first answer, given while it was new, and
    // was never reset. Only then is the first row 'new', which the optimiser asks for.
    const complete = lastReset < 0 && graded.length > 0 && graded[0].type === 0

    const reviews: ImportReview[] = []
    let replay: MemoryState | null = null
    let previousAt = 0
    for (const r of history) {
      if (isReset(r)) {
        replay = null
        continue
      }
      if (!answered(r)) continue
      const rating = r.ease as Rating
      const elapsed = replay ? Math.max(0, (r.id - previousAt) / DAY_MS) : 0
      const next = nextMemoryState(replay, elapsed, rating, params)
      replay = { stability: next.stability, difficulty: next.difficulty }
      reviews.push({
        rating,
        state: complete && r === graded[0] ? 'new' : (REVLOG_STATES[r.type] ?? 'review'),
        stability: next.stability,
        difficulty: next.difficulty,
        elapsedDays: elapsed,
        scheduledDays: Math.max(r.ivl, 0),
        reviewedAt: new Date(r.id).toISOString()
      })
      previousAt = r.id
    }

    let memory: MemoryState | null = null
    let lastReview: number | null = graded.length > 0 ? graded[graded.length - 1].id : null
    if (state !== 'new') {
      const stored = storedMemory(card.data)
      if (stored) {
        memory = stored.state
        lastReview = stored.lastReview ?? lastReview
      } else if (current.length > 0 && current[0].type === 0) {
        memory = replayMemoryState(
          toSequence(current.map((r) => ({ rating: r.ease as Rating, at: r.id }))),
          params
        )
      } else {
        memory = fromSm2(card.factor > 0 ? card.factor / 1000 : 2.5, Math.max(card.ivl, 0))
      }
      if (lastReview === null && state === 'review') lastReview = Date.parse(due) - Math.max(card.ivl, 0) * DAY_MS
    }

    usedDecks.add(deck)
    cards.push({
      externalId: `anki:${note.guid}:${card.ord}`,
      deck,
      front,
      back,
      cloze,
      state,
      due,
      stability: memory?.stability ?? null,
      difficulty: memory?.difficulty ?? null,
      lastReview: state === 'new' || lastReview === null ? null : new Date(lastReview).toISOString(),
      intervalDays: state === 'review' || state === 'relearning' ? Math.max(card.ivl, 0) : 0,
      repetitions: card.reps,
      easeFactor: card.factor > 0 ? card.factor / 1000 : 2.5,
      reviews
    })
  }

  const decks = [...usedDecks]
    .map((id) => ({ id, name: deckNames.get(id) ?? 'Default' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { decks, cards, skipped }
}
