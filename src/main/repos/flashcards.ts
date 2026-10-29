import { getDb } from '../db'
import { now } from './dates'
import { ftsDelete, ftsUpsert } from './search'
import { getSetting } from './settings'
import { RATINGS, parseParams, schedule } from '@shared/fsrs'
import { clozeNumbers } from '@shared/cloze'
import type { Card, Deck, NoteCardLine, ReviewGrade } from '@shared/types'

/** A deck made from a note that is in the trash: hidden with the note until it comes back. */
const TRASHED_DECK = `EXISTS (SELECT 1 FROM notes n WHERE n.id = d.note_id AND n.deleted_at IS NOT NULL)`

/** A due time compared as a time: rows hold it as ISO or in SQLite's own form, which sort apart as text. */
const DUE = `julianday(c.next_review_date)`

const DECK_ROWS = `
    SELECT d.*,
      (SELECT COUNT(*) FROM flashcards c WHERE c.deck_id = d.id) AS card_count,
      (SELECT COUNT(*) FROM flashcards c WHERE c.deck_id = d.id AND ${DUE} <= julianday(?)) AS due_count
    FROM flashcard_decks d`

export function listDecks(notebookId?: number): Deck[] {
  const nowIso = now()
  const base = `${DECK_ROWS} WHERE NOT ${TRASHED_DECK}`
  if (notebookId !== undefined) {
    return getDb().prepare(`${base} AND d.notebook_id = ? ORDER BY d.id`).all(nowIso, notebookId) as Deck[]
  }
  return getDb().prepare(`${base} ORDER BY d.id`).all(nowIso) as Deck[]
}

function getDeck(id: number): Deck {
  return getDb().prepare(`${DECK_ROWS} WHERE d.id = ?`).get(now(), id) as Deck
}

/** Inserts a deck with its search entry and returns the new id. */
function insertDeck(notebookId: number, name: string, noteId: number | null = null): number {
  const info = getDb()
    .prepare(`INSERT INTO flashcard_decks (notebook_id, name, created_at, note_id) VALUES (?, ?, ?, ?)`)
    .run(notebookId, name, now(), noteId)
  const id = Number(info.lastInsertRowid)
  ftsUpsert('deck', id, name, '')
  return id
}

export function createDeck(notebookId: number, name: string): Deck {
  return getDeck(insertDeck(notebookId, name))
}

export function renameDeck(id: number, name: string): void {
  getDb().prepare(`UPDATE flashcard_decks SET name = ? WHERE id = ?`).run(name, id)
  ftsUpsert('deck', id, name, '')
}

export function removeDeck(id: number): void {
  getDb().prepare(`DELETE FROM flashcard_decks WHERE id = ?`).run(id)
  ftsDelete('deck', id)
}

export function listCards(deckId: number): Card[] {
  return getDb().prepare(`SELECT * FROM flashcards WHERE deck_id = ? ORDER BY id`).all(deckId) as Card[]
}

export function dueCards(deckId: number): Card[] {
  return getDb()
    .prepare(
      `SELECT c.* FROM flashcards c JOIN flashcard_decks d ON d.id = c.deck_id
       WHERE c.deck_id = ? AND ${DUE} <= julianday(?) AND NOT ${TRASHED_DECK} ORDER BY ${DUE}`
    )
    .all(deckId, now()) as Card[]
}

/** Adds one card, or one per cloze number when the front holds cloze markup. Returns the first. */
export function addCard(deckId: number, front: string, back: string): Card {
  const db = getDb()
  let ids: number[] = []
  db.transaction(() => {
    ids = applyLine(deckId, [], front, back, null, false).ids
  })()
  return db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(ids[0]) as Card
}

/**
 * The hand-added cloze cards that were added together with `card`. Nothing stores that link,
 * so the cloze cards in its deck with its front and back are dealt out in id order, each to
 * the first set still missing its cloze number, and the set holding `card` is the one. A set
 * never holds a number twice, so an edit can never delete a card of another set.
 */
function handSet(card: Card): Card[] {
  const twins = getDb()
    .prepare(`SELECT * FROM flashcards WHERE deck_id = ? AND source_line IS NULL AND cloze > 0 AND front = ? AND back = ? ORDER BY id`)
    .all(card.deck_id, card.front, card.back) as Card[]
  const sets: Card[][] = []
  for (const c of twins) {
    const set = sets.find((s) => !s.some((x) => x.cloze === c.cloze))
    if (set) set.push(c)
    else sets.push([c])
  }
  return sets.find((s) => s.some((x) => x.id === card.id)) ?? [card]
}

/**
 * Edits a card together with its cloze siblings: the cards of the same note line, or for
 * a card added by hand, the cards added with it (`handSet`).
 */
export function updateCard(id: number, front: string, back: string): void {
  const db = getDb()
  const card = db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(id) as Card | undefined
  if (!card) return
  db.transaction(() => {
    const siblings =
      card.source_line !== null
        ? (db.prepare(`SELECT * FROM flashcards WHERE deck_id = ? AND source_line = ? ORDER BY id`).all(card.deck_id, card.source_line) as Card[])
        : card.cloze > 0
          ? handSet(card)
          : [card]
    applyLine(card.deck_id, siblings, front, back, card.source_line, card.source_line !== null)
  })()
}

export function removeCard(id: number): void {
  getDb().prepare(`DELETE FROM flashcards WHERE id = ?`).run(id)
}

/**
 * Review one card and append to the review log. The scheduling maths is in `@shared/fsrs`;
 * this reads the memory state, writes the new one and records what happened.
 */
export function reviewCard(cardId: number, grade: ReviewGrade): Card {
  const db = getDb()
  const card = db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card | undefined
  if (!card) throw new Error(`card ${cardId} not found`)

  // Not the module-level now(): the schedule and the log must use the same instant.
  const reviewedAt = new Date()
  // Fitted parameters stored by earlier versions still apply; anything unusable gives the defaults.
  const params = parseParams(getSetting('fsrs_params'))
  const result = schedule(
    { state: card.state ?? 'new', stability: card.stability, difficulty: card.difficulty, lastReview: card.last_review },
    RATINGS[grade],
    reviewedAt,
    params
  )
  const reviewedAtIso = reviewedAt.toISOString()

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE flashcards
          SET stability = ?, difficulty = ?, state = ?, last_review = ?, next_review_date = ?,
              interval_days = ?
        WHERE id = ?`
    ).run(
      result.stability,
      result.difficulty,
      result.state,
      reviewedAtIso,
      result.due,
      result.scheduledDays,
      cardId
    )
    logReview({
      cardId,
      deckId: card.deck_id,
      rating: RATINGS[grade],
      // The state the card was in when asked; true retention only counts 'review' rows.
      state: card.state ?? 'new',
      stability: result.stability,
      difficulty: result.difficulty,
      elapsedDays: result.elapsedDays,
      scheduledDays: result.scheduledDays,
      reviewedAt: reviewedAtIso
    })
  })
  tx()
  return db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card
}

/** Appends one row to the review log. */
export function logReview(r: {
  cardId: number
  deckId: number | null
  rating: number
  state: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reviewedAt: string
}): void {
  getDb()
    .prepare(
      `INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(r.cardId, r.deckId, r.rating, r.state, r.stability, r.difficulty, r.elapsedDays, r.scheduledDays, r.reviewedAt)
}

/* ------------------------------ Lines and cloze ----------------------------- */

/**
 * Makes the cards of one line match `front` and `back`: one card per cloze number, or a
 * single plain card (cloze 0). A card whose number is still asked is updated in place, so
 * a change of wording keeps its scheduling; a new number gets a new card and a dropped one
 * is deleted (its review log rows stay, with `card_id` set to null). `keyed` lines carry a
 * `source_line`, taken from the line's first card. Call inside a transaction.
 */
function applyLine(
  deckId: number,
  current: Card[],
  front: string,
  back: string,
  key: number | null,
  keyed: boolean
): { key: number | null; ids: number[] } {
  const db = getDb()
  const wanted = clozeNumbers(front)
  const byNum = new Map<number, Card>()
  const stale: Card[] = []
  for (const c of current) {
    if (byNum.has(c.cloze)) stale.push(c)
    else byNum.set(c.cloze, c)
  }
  const ids: number[] = []
  let lineKey = key
  for (const n of wanted.length > 0 ? wanted : [0]) {
    const card = byNum.get(n)
    if (card) {
      byNum.delete(n)
      if (card.front !== front || card.back !== back) {
        db.prepare(`UPDATE flashcards SET front = ?, back = ? WHERE id = ?`).run(front, back, card.id)
      }
      ids.push(card.id)
      continue
    }
    const info = db
      .prepare(`INSERT INTO flashcards (deck_id, front, back, next_review_date, source_line, cloze) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(deckId, front, back, now(), lineKey, n)
    const id = Number(info.lastInsertRowid)
    if (keyed && lineKey === null) {
      lineKey = id
      db.prepare(`UPDATE flashcards SET source_line = ? WHERE id = ?`).run(id, id)
    }
    ids.push(id)
  }
  for (const c of [...byNum.values(), ...stale]) db.prepare(`DELETE FROM flashcards WHERE id = ?`).run(c.id)
  return { key: lineKey, ids }
}

/* ---------------------------- Note -> deck bridge --------------------------- */

/**
 * Syncs a note's `Term :: Definition` and cloze lines into the one deck linked to that
 * note, creating it on the first run. Lines are matched to their cards by the id an earlier
 * sync stamped on them, then, for a line without one (pasted, or written before it was
 * stamped), by its front text. Matched cards are updated in place; new lines get cards;
 * cards whose line is gone are deleted, like the tasks of a deleted checkbox. Cards added
 * to the deck by hand are left alone. Returns the deck and the line ids in `lines` order,
 * for stamping back into the doc.
 */
export function syncNoteCards(
  noteId: number,
  notebookId: number,
  name: string,
  lines: NoteCardLine[]
): { deck: Deck; lineIds: number[] } {
  const db = getDb()
  let deckId = 0
  const lineIds: number[] = []
  db.transaction(() => {
    const linked = db.prepare(`SELECT id FROM flashcard_decks WHERE note_id = ? ORDER BY id LIMIT 1`).get(noteId) as
      | { id: number }
      | undefined
    deckId = linked ? linked.id : insertDeck(notebookId, name, noteId)

    const groups = new Map<number, Card[]>()
    const synced = db.prepare(`SELECT * FROM flashcards WHERE deck_id = ? AND source_line IS NOT NULL ORDER BY id`).all(deckId) as Card[]
    for (const c of synced) groups.set(c.source_line!, [...(groups.get(c.source_line!) ?? []), c])

    const clean = lines.map((l) => ({ lineId: l.lineId, front: l.front.trim(), back: l.back.trim() }))
    const claim = new Map<number, number>() // line index -> line key
    const taken = new Set<number>()
    clean.forEach((l, i) => {
      if (l.lineId !== null && groups.has(l.lineId) && !taken.has(l.lineId)) {
        claim.set(i, l.lineId)
        taken.add(l.lineId)
      }
    })
    clean.forEach((l, i) => {
      if (claim.has(i)) return
      for (const [key, group] of groups) {
        if (!taken.has(key) && group[0].front === l.front) {
          claim.set(i, key)
          taken.add(key)
          break
        }
      }
    })

    clean.forEach((l, i) => {
      if (!l.front) {
        lineIds.push(0)
        return
      }
      const key = claim.get(i) ?? null
      const res = applyLine(deckId, key !== null ? groups.get(key)! : [], l.front, l.back, key, true)
      lineIds.push(res.key ?? 0)
    })
    for (const [key, group] of groups) {
      if (taken.has(key)) continue
      for (const c of group) db.prepare(`DELETE FROM flashcards WHERE id = ?`).run(c.id)
    }
  }).immediate() // reads before it writes, like syncNoteTasks
  return { deck: getDeck(deckId), lineIds }
}
