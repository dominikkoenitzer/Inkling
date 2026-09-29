import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, PARAM_BOUNDS, intervalForRetention, nextMemoryState, type MemoryState, type Rating } from '../src/shared/fsrs'
import {
  MAX_REVIEWS_PER_CARD,
  MIN_REVIEWS_TO_OPTIMISE,
  countScoredReviews,
  logLoss,
  optimise,
  replayMemoryState,
  toTrainingSequences,
  type ReviewEvent
} from '../src/shared/fsrs-optimise'

const DAY = 86_400_000
const START = Date.parse('2026-01-01T08:00:00.000Z')

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
function syntheticLog(truth: readonly number[], cards: number, reviewsPerCard: number, seed = 7): ReviewEvent[][] {
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
const TRUTH = DEFAULT_PARAMS.map((v, i) => ({ 0: 0.1, 1: 0.6, 2: 1.2, 3: 4, 8: 1.4, 20: 0.45 })[i as 0] ?? v)

describe('toTrainingSequences', () => {
  it('sorts each history, measures the gaps in days and drops single reviews', () => {
    const seqs = toTrainingSequences([
      [
        { rating: 3, at: START + 3 * DAY },
        { rating: 3, at: START },
        { rating: 1, at: START + 10 * DAY }
      ],
      [{ rating: 3, at: START }]
    ])
    expect(seqs).toEqual([{ ratings: [3, 3, 1], elapsed: [0, 3, 7] }])
  })

  it('keeps only the first 64 reviews of a card', () => {
    const long = Array.from({ length: 100 }, (_, i) => ({ rating: 3 as Rating, at: START + i * DAY }))
    expect(toTrainingSequences([long])[0].ratings).toHaveLength(MAX_REVIEWS_PER_CARD)
  })
})

describe('replayMemoryState', () => {
  it('ends where reviewing the card one answer at a time ends', () => {
    const seq = { ratings: [3, 1, 3, 4] as Rating[], elapsed: [0, 4, 0.01, 6] }
    let state: MemoryState | null = null
    for (let i = 0; i < 4; i++) state = nextMemoryState(state, seq.elapsed[i], seq.ratings[i], DEFAULT_PARAMS)
    expect(replayMemoryState(seq, DEFAULT_PARAMS)).toEqual({ stability: state!.stability, difficulty: state!.difficulty })
  })
})

describe('logLoss', () => {
  it('scores only reviews a day or more after the previous one', () => {
    const seqs = toTrainingSequences(syntheticLog(TRUTH, 5, 6))
    const sameDay = seqs.reduce((n, s) => n + s.elapsed.filter((e, i) => i > 0 && e < 1).length, 0)
    const total = seqs.reduce((n, s) => n + s.ratings.length - 1, 0)
    expect(sameDay).toBeGreaterThan(0)
    expect(countScoredReviews(seqs)).toBe(total - sameDay)
  })

  it('is lower for the parameters that generated the log', () => {
    const seqs = toTrainingSequences(syntheticLog(TRUTH, 200, 10))
    expect(logLoss(seqs, TRUTH)).toBeLessThan(logLoss(seqs, DEFAULT_PARAMS))
  })
})

describe('optimise', () => {
  it('keeps the defaults below the review threshold', () => {
    const seqs = toTrainingSequences(syntheticLog(TRUTH, 20, 5))
    expect(countScoredReviews(seqs)).toBeLessThan(MIN_REVIEWS_TO_OPTIMISE)
    const result = optimise(seqs)
    expect(result.params).toEqual(DEFAULT_PARAMS)
    expect(result.lossAfter).toBe(result.lossBefore)
  })

  const seqs = toTrainingSequences(syntheticLog(TRUTH, 300, 10))
  const result = optimise(seqs)

  it('lowers the log-loss on a synthetic log', () => {
    expect(result.reviews).toBeGreaterThanOrEqual(MIN_REVIEWS_TO_OPTIMISE)
    expect(result.lossBefore).toBeCloseTo(logLoss(seqs, DEFAULT_PARAMS), 12)
    expect(result.lossAfter).toBeCloseTo(logLoss(seqs, result.params), 12)
    expect(result.lossAfter).toBeLessThan(result.lossBefore - 0.005)
  })

  it('moves the parameters toward the ones that generated the log', () => {
    // The true curve decays much more steeply than the default, and early stability is lower.
    expect(result.params[20]).toBeGreaterThan(DEFAULT_PARAMS[20])
    expect(result.params[2]).toBeLessThan(DEFAULT_PARAMS[2])
  })

  it('keeps every parameter inside its bounds', () => {
    result.params.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(PARAM_BOUNDS[i][0])
      expect(v).toBeLessThanOrEqual(PARAM_BOUNDS[i][1])
    })
  })

  it('is deterministic', () => {
    expect(optimise(seqs)).toEqual(result)
  })
})
