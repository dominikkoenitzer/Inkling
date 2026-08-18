import { getDb } from '../db'
import { now } from './dates'
import { ftsDelete, ftsUpsert } from './search'
import { getSetting } from './settings'
import { RATINGS, schedule } from '@shared/fsrs'
import type { Card, Deck, ReviewGrade } from '@shared/types'

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

export function addCard(deckId: number, front: string, back: string): Card {
  const info = getDb()
    .prepare(`INSERT INTO flashcards (deck_id, front, back, next_review_date) VALUES (?, ?, ?, ?)`)
    .run(deckId, front, back, now())
  return getDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(info.lastInsertRowid) as Card
}

export function updateCard(id: number, front: string, back: string): void {
  getDb().prepare(`UPDATE flashcards SET front = ?, back = ? WHERE id = ?`).run(front, back, id)
}

export function removeCard(id: number): void {
  getDb().prepare(`DELETE FROM flashcards WHERE id = ?`).run(id)
}

/** Desired retention, as a fraction. Settable in Settings; FSRS solves each interval for it. */
export function desiredRetention(): number {
  const raw = Number(getSetting('desired_retention') ?? '0.9')
  return Number.isFinite(raw) ? Math.min(0.99, Math.max(0.7, raw)) : 0.9
}

/**
 * Review one card with FSRS-4.5 (replaced SM-2 in v0.4.0) and append to the review log.
 *
 * The scheduling maths lives in `@shared/fsrs` and is pure; this function only reads the
 * card's memory state, writes the new one, and records what happened. The legacy SM-2
 * columns are kept roughly in step so a downgrade — or anything still reading them —
 * doesn't see nonsense.
 */
export function reviewCard(cardId: number, grade: ReviewGrade): Card {
  const db = getDb()
  const card = db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card | undefined
  if (!card) throw new Error(`card ${cardId} not found`)

  // Deliberately not the module-level `now()`: FSRS needs a Date to measure elapsed
  // days from, and the two columns below need that same instant as a string. Reading
  // the clock once and deriving both keeps the schedule and the log exactly in step.
  const reviewedAt = new Date()
  const result = schedule(
    { state: card.state ?? 'new', stability: card.stability, difficulty: card.difficulty, lastReview: card.last_review },
    RATINGS[grade],
    reviewedAt,
    desiredRetention()
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
      // The state the card was in *when asked* — that's what "true retention" measures
      // against (a brand-new card's first answer isn't a memory test) and what FSRS
      // parameter fitting expects. Stability/difficulty below are the resulting values.
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
