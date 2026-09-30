import { getDb } from '../db'
import { readAnkiPackage } from '../import/anki'
import { now } from './dates'
import { schedulerSettings } from './flashcards'
import { ftsUpsert } from './search'
import { planImport, type ImportPlan } from '@shared/ankiMap'
import type { ImportSummary } from '@shared/types'

/**
 * Writes an import plan into `notebookId` in one transaction: decks, their search
 * entries, cards and review history land together or not at all. A card whose
 * `external_id` is here already is skipped with its reviews, so importing the same
 * package twice adds only what is new. Cards go into the notebook's deck of the same
 * name when there is one (not a note's deck), else into a new deck.
 */
export function writeImport(notebookId: number, plan: ImportPlan): ImportSummary {
  const db = getDb()
  const summary: ImportSummary = { decks: 0, cards: 0, reviews: 0, deckId: null, skipped: { ...plan.skipped, duplicates: 0 } }
  db.transaction(() => {
    const exists = db.prepare(`SELECT 1 FROM flashcards WHERE external_id = ?`)
    const seen = new Set<string>()
    const fresh = plan.cards.filter((c) => {
      if (seen.has(c.externalId) || exists.get(c.externalId)) {
        summary.skipped.duplicates++
        return false
      }
      seen.add(c.externalId)
      return true
    })

    const findDeck = db.prepare(`SELECT id FROM flashcard_decks WHERE notebook_id = ? AND name = ? AND note_id IS NULL ORDER BY id LIMIT 1`)
    const insertDeck = db.prepare(`INSERT INTO flashcard_decks (notebook_id, name, created_at) VALUES (?, ?, ?)`)
    const deckIds = new Map<number, number>()
    for (const d of plan.decks) {
      if (!fresh.some((c) => c.deck === d.id)) continue
      const existing = findDeck.get(notebookId, d.name) as { id: number } | undefined
      let id = existing?.id
      if (id === undefined) {
        id = Number(insertDeck.run(notebookId, d.name, now()).lastInsertRowid)
        ftsUpsert('deck', id, d.name, '')
        summary.decks++
      }
      deckIds.set(d.id, id)
      summary.deckId ??= id
    }

    const insertCard = db.prepare(
      `INSERT INTO flashcards (deck_id, front, back, ease_factor, interval_days, repetitions, next_review_date,
                               stability, difficulty, state, last_review, cloze, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertReview = db.prepare(
      `INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const c of fresh) {
      const deckId = deckIds.get(c.deck)!
      const cardId = Number(
        insertCard.run(
          deckId,
          c.front,
          c.back,
          c.easeFactor,
          c.intervalDays,
          c.repetitions,
          c.due,
          c.stability,
          c.difficulty,
          c.state,
          c.lastReview,
          c.cloze,
          c.externalId
        ).lastInsertRowid
      )
      summary.cards++
      for (const r of c.reviews) {
        insertReview.run(cardId, deckId, r.rating, r.state, r.stability, r.difficulty, r.elapsedDays, r.scheduledDays, r.reviewedAt)
        summary.reviews++
      }
    }
  })()
  return summary
}

/** Reads an Anki package, maps it with the FSRS parameters in use and writes it into `notebookId`. */
export async function importAnkiFile(notebookId: number, file: string): Promise<ImportSummary> {
  const rows = await readAnkiPackage(file)
  return writeImport(notebookId, planImport(rows, new Date(), schedulerSettings().params))
}
