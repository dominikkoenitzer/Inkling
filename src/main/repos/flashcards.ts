import { getDb } from '../db'
import { now } from './dates'
import { ftsDelete, ftsUpsert } from './search'
import { getSetting } from './settings'
import { DEFAULT_RETENTION, RATINGS, parseParams, schedule } from '@shared/fsrs'
import { clozeNumbers } from '@shared/cloze'
import type { Card, Deck, NoteCardLine, ReviewGrade } from '@shared/types'

export function listDecks(notebookId?: number): Deck[] {
  const nowIso = now()
  const base = `
    SELECT d.*,
      (SELECT COUNT(*) FROM flashcards c WHERE c.deck_id = d.id) AS card_count,
      (SELECT COUNT(*) FROM flashcards c WHERE c.deck_id = d.id AND c.next_review_date <= ?) AS due_count
    FROM flashcard_decks d`
  if (notebookId !== undefined) {
    return getDb().prepare(`${base} WHERE d.notebook_id = ? ORDER BY d.id`).all(nowIso, notebookId) as Deck[]
  }
  return getDb().prepare(`${base} ORDER BY d.id`).all(nowIso) as Deck[]
}

export function createDeck(notebookId: number, name: string): Deck {
  const info = getDb()
    .prepare(`INSERT INTO flashcard_decks (notebook_id, name, created_at) VALUES (?, ?, ?)`)
    .run(notebookId, name, now())
  const id = Number(info.lastInsertRowid)
  ftsUpsert('deck', id, name, '')
  return listDecks(notebookId).find((d) => d.id === id)!
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
    .prepare(`SELECT * FROM flashcards WHERE deck_id = ? AND next_review_date <= ? ORDER BY next_review_date`)
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
 * Edits a card together with its cloze siblings: the cards of the same note line, or for
 * a card added by hand, the cloze cards in its deck that share its text.
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
          ? (db
              .prepare(`SELECT * FROM flashcards WHERE deck_id = ? AND source_line IS NULL AND cloze > 0 AND front = ? ORDER BY id`)
              .all(card.deck_id, card.front) as Card[])
          : [card]
    applyLine(card.deck_id, siblings, front, back, card.source_line, card.source_line !== null)
  })()
}

export function removeCard(id: number): void {
  getDb().prepare(`DELETE FROM flashcards WHERE id = ?`).run(id)
}

/**
 * The retention and FSRS parameters in use. Retention is fixed at 90%: the setting was
 * removed in 0.6.0, so a value stored before then is ignored. The parameters are the
 * user's fitted ones, or the defaults.
 */
export function schedulerSettings(): { retention: number; params: number[] } {
  return { retention: DEFAULT_RETENTION, params: parseParams(getSetting('fsrs_params')) }
}

/**
 * Review one card and append to the review log. The scheduling maths is in `@shared/fsrs`;
 * this reads the memory state, writes the new one and records what happened. The old SM-2
 * columns are kept roughly in step for anything still reading them.
 */
export function reviewCard(cardId: number, grade: ReviewGrade): Card {
  const db = getDb()
  const card = db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card | undefined
  if (!card) throw new Error(`card ${cardId} not found`)

  // Not the module-level now(): the schedule and the log must use the same instant.
  const reviewedAt = new Date()
  const { retention, params } = schedulerSettings()
  const result = schedule(
    { state: card.state ?? 'new', stability: card.stability, difficulty: card.difficulty, lastReview: card.last_review },
    RATINGS[grade],
    reviewedAt,
    retention,
    params
  )
  const reviewedAtIso = reviewedAt.toISOString()

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE flashcards
          SET stability = ?, difficulty = ?, state = ?, last_review = ?, next_review_date = ?,
              interval_days = ?, repetitions = ?, ease_factor = ?
        WHERE id = ?`
    ).run(
      result.stability,
      result.difficulty,
      result.state,
      reviewedAtIso,
      result.due,
      result.scheduledDays,
      grade === 'again' ? 0 : card.repetitions + 1,
      // Mirror difficulty back onto the SM-2 ease factor (inverse of the v4 migration).
      Math.round((2.5 - ((result.difficulty - 1) * 1.2) / 9) * 1000) / 1000,
      cardId
    )
    db.prepare(
      `INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cardId,
      card.deck_id,
      RATINGS[grade],
      // The state the card was in when asked; true retention only counts 'review' rows.
      card.state ?? 'new',
      result.stability,
      result.difficulty,
      result.elapsedDays,
      result.scheduledDays,
      reviewedAtIso
    )
  })
  tx()
  return db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card
}

export function createDeckFromPairs(notebookId: number, name: string, pairs: Array<[string, string]>): Deck {
  const deck = createDeck(notebookId, name)
  const insert = getDb().prepare(`INSERT INTO flashcards (deck_id, front, back, next_review_date) VALUES (?, ?, ?, ?)`)
  const tx = getDb().transaction(() => {
    for (const [front, back] of pairs) insert.run(deck.id, front, back, now())
  })
  tx()
  return listDecks(notebookId).find((d) => d.id === deck.id)!
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
    if (linked) {
      deckId = linked.id
    } else {
      const info = db
        .prepare(`INSERT INTO flashcard_decks (notebook_id, name, created_at, note_id) VALUES (?, ?, ?, ?)`)
        .run(notebookId, name, now(), noteId)
      deckId = Number(info.lastInsertRowid)
      ftsUpsert('deck', deckId, name, '')
    }

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
  })()
  return { deck: listDecks().find((d) => d.id === deckId)!, lineIds }
}
