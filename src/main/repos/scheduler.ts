import { getDb } from '../db'
import { getSetting, setSetting } from './settings'
import { parseParams, type Rating } from '@shared/fsrs'
import {
  MIN_REVIEWS_TO_OPTIMISE,
  logLoss,
  optimiseSteps,
  replayMemoryState,
  toSequence,
  toTrainingSequences,
  type OptimiseResult,
  type ReviewEvent
} from '@shared/fsrs-optimise'
import type { OptimiseOutcome } from '@shared/types'

/** How long the optimiser may hold the main process before it lets other work through. */
const SLICE_MS = 30

/**
 * Every card's review history from the log, but only complete ones: a card whose first
 * logged answer was not as a new card (reviewed under SM-2 before the log existed) has
 * no known starting state, so it is left out. Deleted cards lose their id and drop out too.
 */
export function reviewHistories(): Map<number, ReviewEvent[]> {
  const rows = getDb()
    .prepare(
      `SELECT card_id, rating, state, reviewed_at FROM review_log
        WHERE card_id IS NOT NULL ORDER BY card_id, reviewed_at, id`
    )
    .all() as Array<{ card_id: number; rating: number; state: string; reviewed_at: string }>
  const histories = new Map<number, ReviewEvent[]>()
  const incomplete = new Set<number>()
  for (const row of rows) {
    if (incomplete.has(row.card_id)) continue
    const events = histories.get(row.card_id)
    if (!events && row.state !== 'new') {
      incomplete.add(row.card_id)
      continue
    }
    const at = Date.parse(row.reviewed_at)
    if (Number.isNaN(at) || row.rating < 1 || row.rating > 4) continue
    const event = { rating: row.rating as Rating, at }
    if (events) events.push(event)
    else histories.set(row.card_id, [event])
  }
  return histories
}

let running: Promise<OptimiseOutcome> | null = null

/**
 * "Optimise from my reviews": fits the FSRS parameters to the review log and keeps them
 * when they predict the log better than the ones in use. The run yields every few
 * milliseconds so the window stays responsive, and a second click joins the first run.
 * With new parameters saved, every card with a complete history gets its stability and
 * difficulty recomputed under them; due dates are left as they are.
 */
export function optimiseParams(): Promise<OptimiseOutcome> {
  running ??= run().finally(() => {
    running = null
  })
  return running
}

async function run(): Promise<OptimiseOutcome> {
  const seqs = toTrainingSequences([...reviewHistories().values()])
  const steps = optimiseSteps(seqs)
  let result: OptimiseResult
  let sliceStart = Date.now()
  for (;;) {
    const next = steps.next()
    if (next.done) {
      result = next.value
      break
    }
    if (Date.now() - sliceStart > SLICE_MS) {
      await new Promise((resolve) => setImmediate(resolve))
      sliceStart = Date.now()
    }
  }

  const base = { reviews: result.reviews, needed: MIN_REVIEWS_TO_OPTIMISE }
  const current = parseParams(getSetting('fsrs_params'))
  const lossBefore = logLoss(seqs, current)
  if (result.reviews < MIN_REVIEWS_TO_OPTIMISE) return { status: 'too-few', ...base, lossBefore, lossAfter: lossBefore }
  if (result.lossAfter >= lossBefore) return { status: 'no-better', ...base, lossBefore, lossAfter: lossBefore }

  const db = getDb()
  db.transaction(() => {
    setSetting('fsrs_params', JSON.stringify(result.params))
    // Read again: cards reviewed while the optimiser ran must be replayed with that review.
    const update = db.prepare(`UPDATE flashcards SET stability = ?, difficulty = ? WHERE id = ?`)
    for (const [cardId, events] of reviewHistories()) {
      const state = replayMemoryState(toSequence(events), result.params)
      if (state) update.run(state.stability, state.difficulty, cardId)
    }
  })()
  return { status: 'fitted', ...base, lossBefore, lossAfter: result.lossAfter, params: result.params }
}
