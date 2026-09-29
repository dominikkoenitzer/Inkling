/** A synthetic review log for the optimiser tests, from a learner with known parameters. */
import { DEFAULT_PARAMS, intervalForRetention, nextMemoryState, type MemoryState, type Rating } from '../src/shared/fsrs'
import type { ReviewEvent } from '../src/shared/fsrs-optimise'

export const DAY = 86_400_000
export const START = Date.parse('2026-01-01T08:00:00.000Z')

/** Seeded generator for the synthetic log, independent of the optimiser's own. */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

/**
 * A synthetic review log from a learner whose memory follows `truth`: each card is
 * reviewed when the true model says recall has fallen to about 85%, recalled with the
 * true probability, and a lapse is relearned ten minutes later.
 */
export function syntheticLog(truth: readonly number[], cards: number, reviewsPerCard: number, seed = 7): ReviewEvent[][] {
  const random = rng(seed)
  const log: ReviewEvent[][] = []
  for (let c = 0; c < cards; c++) {
    const events: ReviewEvent[] = []
    let at = START + c * 3_600_000
    let state: MemoryState | null = null
    let elapsed = 0
    for (let i = 0; i < reviewsPerCard; i++) {
      let rating: Rating
      if (!state) {
        rating = ([1, 2, 3, 3, 3, 4] as Rating[])[Math.floor(random() * 6)]
      } else {
        const recalled = random() < nextMemoryState(state, elapsed, 3, truth).retrievability
        rating = recalled ? (random() < 0.15 ? 2 : random() < 0.1 ? 4 : 3) : 1
      }
      events.push({ rating, at })
      state = nextMemoryState(state, elapsed, rating, truth)
      if (rating === 1) {
        // Relearned in the same session, which only the same-day terms see.
        at += 10 * 60_000
        events.push({ rating: 3, at })
        state = nextMemoryState(state, 10 / 1440, 3, truth)
      }
      elapsed = Math.max(1, Math.round(intervalForRetention(0.85, state.stability, truth) * (0.7 + random() * 0.8)))
      at += elapsed * DAY
    }
    log.push(events)
  }
  return log
}

// A learner who forgets faster early on and more steeply than the defaults assume.
export const TRUTH = DEFAULT_PARAMS.map((v, i) => ({ 0: 0.1, 1: 0.6, 2: 1.2, 3: 4, 8: 1.4, 20: 0.45 })[i as 0] ?? v)
