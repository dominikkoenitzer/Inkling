import { describe, it, expect } from 'vitest'
import {
  DECAY,
  DEFAULT_PARAMS,
  FACTOR,
  MAX_INTERVAL_DAYS,
  MIN_STABILITY,
  RELEARN_MINUTES,
  daysBetween,
  formatInterval,
  fromSm2,
  initialDifficulty,
  initialStability,
  intervalForRetention,
  nextDifficulty,
  nextForgetStability,
  nextRecallStability,
  previewIntervals,
  retrievability,
  schedule,
  type SchedulableCard
} from '../src/shared/fsrs'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const reviewed = (stability: number, difficulty: number, elapsed: number): SchedulableCard => ({
  state: 'review',
  stability,
  difficulty,
  lastReview: daysAgo(elapsed)
})

const fresh: SchedulableCard = { state: 'new', stability: null, difficulty: null, lastReview: null }

describe('retrievability', () => {
  it('is 1 the moment a card is reviewed', () => {
    expect(retrievability(0, 10)).toBe(1)
  })

  it('is exactly 0.9 after one stability-worth of days — the definition of stability', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 6)
    expect(retrievability(1, 1)).toBeCloseTo(0.9, 6)
    expect(retrievability(365, 365)).toBeCloseTo(0.9, 6)
  })

  it('decays monotonically and never goes negative', () => {
    const points = [0, 1, 5, 20, 100, 5000].map((t) => retrievability(t, 10))
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeLessThan(points[i - 1])
    expect(points.at(-1)).toBeGreaterThan(0)
  })

  it('is defined by the FSRS power curve, not an exponential', () => {
    expect(retrievability(30, 10)).toBeCloseTo(Math.pow(1 + (FACTOR * 30) / 10, DECAY), 10)
  })

  it('treats a non-positive stability as fully forgotten', () => {
    expect(retrievability(1, 0)).toBe(0)
  })
})

describe('intervalForRetention', () => {
  it('inverts retrievability — scheduling at r gives back r', () => {
    for (const r of [0.8, 0.85, 0.9, 0.95]) {
      const days = intervalForRetention(r, 12)
      expect(retrievability(days, 12)).toBeCloseTo(r, 6)
    }
  })

  it('returns exactly stability at 90% retention', () => {
    expect(intervalForRetention(0.9, 42)).toBeCloseTo(42, 6)
  })

  it('asking for higher retention shortens the interval', () => {
    expect(intervalForRetention(0.95, 20)).toBeLessThan(intervalForRetention(0.85, 20))
  })

  it('clamps absurd retention targets into a sane band', () => {
    expect(intervalForRetention(0.1, 10)).toBeCloseTo(intervalForRetention(0.7, 10), 10)
    expect(intervalForRetention(1.5, 10)).toBeCloseTo(intervalForRetention(0.99, 10), 10)
  })
})

describe('initial memory state', () => {
  it('reads first-review stability straight off the first four weights', () => {
    for (const rating of [1, 2, 3, 4] as const) {
      expect(initialStability(rating)).toBeCloseTo(DEFAULT_PARAMS[rating - 1], 10)
    }
  })

  it('rates a better first answer as more stable', () => {
    expect(initialStability(1)).toBeLessThan(initialStability(2))
    expect(initialStability(2)).toBeLessThan(initialStability(3))
    expect(initialStability(3)).toBeLessThan(initialStability(4))
  })

  it('rates a better first answer as less difficult, within 1–10', () => {
    expect(initialDifficulty(1)).toBeGreaterThan(initialDifficulty(4))
    for (const rating of [1, 2, 3, 4] as const) {
      expect(initialDifficulty(rating)).toBeGreaterThanOrEqual(1)
      expect(initialDifficulty(rating)).toBeLessThanOrEqual(10)
    }
  })
})

describe('nextDifficulty', () => {
  it('Again pushes difficulty up, Easy pulls it down, Good barely moves it', () => {
    expect(nextDifficulty(5, 1)).toBeGreaterThan(5)
    expect(nextDifficulty(5, 4)).toBeLessThan(5)
    expect(nextDifficulty(5, 3)).toBeCloseTo(5, 1)
  })

  it('stays inside 1–10 even under repeated pressure', () => {
    let d = 5
    for (let i = 0; i < 50; i++) d = nextDifficulty(d, 1)
    expect(d).toBeLessThanOrEqual(10)
    for (let i = 0; i < 50; i++) d = nextDifficulty(d, 4)
    expect(d).toBeGreaterThanOrEqual(1)
  })

  it('reverts toward the mean, so one lapse does not brand a card forever', () => {
    // A maximally-difficult card answered Good drifts back down, not sideways.
    expect(nextDifficulty(10, 3)).toBeLessThan(10)
  })
})

describe('nextRecallStability', () => {
  it('always increases stability on a successful recall', () => {
    const r = retrievability(10, 10)
    for (const rating of [2, 3, 4] as const) {
      expect(nextRecallStability(5, 10, r, rating)).toBeGreaterThan(10)
    }
  })

  it('ranks Hard < Good < Easy', () => {
    const r = retrievability(10, 10)
    const hard = nextRecallStability(5, 10, r, 2)
    const good = nextRecallStability(5, 10, r, 3)
    const easy = nextRecallStability(5, 10, r, 4)
    expect(hard).toBeLessThan(good)
    expect(good).toBeLessThan(easy)
  })

  it('rewards recalling something you nearly forgot more than an easy re-hit', () => {
    const justReviewed = nextRecallStability(5, 10, retrievability(1, 10), 3)
    const nearlyForgotten = nextRecallStability(5, 10, retrievability(25, 10), 3)
    expect(nearlyForgotten).toBeGreaterThan(justReviewed)
  })

  it('gives a difficult card a smaller gain than an easy one', () => {
    const r = retrievability(10, 10)
    expect(nextRecallStability(9, 10, r, 3)).toBeLessThan(nextRecallStability(2, 10, r, 3))
  })
})

describe('nextForgetStability', () => {
  it('never makes a forgotten card more stable than it already was', () => {
    for (const s of [0.5, 5, 50, 500]) {
      expect(nextForgetStability(5, s, retrievability(s, s))).toBeLessThanOrEqual(s)
    }
  })

  it('stays at or above the stability floor', () => {
    expect(nextForgetStability(10, 0.1, 0.5)).toBeGreaterThanOrEqual(MIN_STABILITY)
  })
})

describe('schedule — a card seen for the first time', () => {
  it('initialises memory state from the rating and reports full retrievability', () => {
    const r = schedule(fresh, 3, NOW)
    expect(r.stability).toBeCloseTo(initialStability(3), 10)
    expect(r.difficulty).toBeCloseTo(initialDifficulty(3), 10)
    expect(r.retrievability).toBe(1)
    expect(r.elapsedDays).toBe(0)
  })

  it('sends Again back inside the session as a learning card', () => {
    const r = schedule(fresh, 1, NOW)
    expect(r.state).toBe('learning')
    expect(r.scheduledDays).toBe(0)
    expect(Date.parse(r.due) - NOW.getTime()).toBe(RELEARN_MINUTES * 60_000)
  })

  it('graduates anything else to review, at least a day out', () => {
    for (const rating of [2, 3, 4] as const) {
      const r = schedule(fresh, rating, NOW)
      expect(r.state).toBe('review')
      expect(r.scheduledDays).toBeGreaterThanOrEqual(1)
    }
  })

  it('schedules a better first answer further out', () => {
    const good = schedule(fresh, 3, NOW).scheduledDays
    const easy = schedule(fresh, 4, NOW).scheduledDays
    expect(easy).toBeGreaterThan(good)
  })
})

describe('schedule — a card with history', () => {
  it('measures elapsed time from the last review', () => {
    expect(schedule(reviewed(10, 5, 7), 3, NOW).elapsedDays).toBeCloseTo(7, 6)
  })

  it('lapses to relearning, keeping the card in the session', () => {
    const r = schedule(reviewed(30, 5, 30), 1, NOW)
    expect(r.state).toBe('relearning')
    expect(r.scheduledDays).toBe(0)
    expect(r.stability).toBeLessThanOrEqual(30)
  })

  it('a lapse shortens the next interval dramatically', () => {
    const before = reviewed(60, 5, 60)
    const after = schedule(before, 1, NOW)
    const next = schedule({ state: after.state, stability: after.stability, difficulty: after.difficulty, lastReview: NOW.toISOString() }, 3, NOW)
    expect(next.scheduledDays).toBeLessThan(60)
  })

  it('successful reviews grow the interval', () => {
    let card: SchedulableCard = fresh
    let at = NOW
    let previous = 0
    for (let i = 0; i < 6; i++) {
      const r = schedule(card, 3, at)
      expect(r.scheduledDays).toBeGreaterThanOrEqual(previous)
      previous = r.scheduledDays
      // The review happened at `at`; the *next* one happens when it comes due.
      card = { state: r.state, stability: r.stability, difficulty: r.difficulty, lastReview: at.toISOString() }
      at = new Date(Date.parse(r.due))
    }
    expect(previous).toBeGreaterThan(10) // six Goods should be well past the SM-2 6-day step
  })

  it('reviewing early barely moves stability, because almost nothing was forgotten', () => {
    const sameDay = schedule(reviewed(30, 5, 0.001), 3, NOW)
    expect(sameDay.stability).toBeGreaterThanOrEqual(30)
    expect(sameDay.stability).toBeLessThan(30 * 1.05)
  })

  it('honours a higher desired retention with shorter intervals', () => {
    const relaxed = schedule(reviewed(30, 5, 30), 3, NOW, 0.85).scheduledDays
    const strict = schedule(reviewed(30, 5, 30), 3, NOW, 0.95).scheduledDays
    expect(strict).toBeLessThan(relaxed)
  })

  it('keeps intervals inside the supported range', () => {
    const r = schedule(reviewed(MAX_INTERVAL_DAYS, 1, 1), 4, NOW)
    expect(r.scheduledDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
    expect(r.stability).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
  })

  it('treats a card missing its memory state as new rather than throwing', () => {
    const broken: SchedulableCard = { state: 'review', stability: null, difficulty: null, lastReview: null }
    const r = schedule(broken, 3, NOW)
    expect(r.stability).toBeCloseTo(initialStability(3), 10)
  })
})

describe('previewIntervals', () => {
  it('orders the four buttons Again ≤ Hard ≤ Good ≤ Easy', () => {
    const p = previewIntervals(reviewed(20, 5, 20), NOW)
    expect(p[1]).toBe(0)
    expect(p[2]).toBeLessThanOrEqual(p[3])
    expect(p[3]).toBeLessThanOrEqual(p[4])
  })

  it('does not mutate the card it previews', () => {
    const card = reviewed(20, 5, 20)
    const snapshot = { ...card }
    previewIntervals(card, NOW)
    expect(card).toEqual(snapshot)
  })
})

describe('fromSm2', () => {
  it('maps the ease-factor range onto the difficulty range, inverted', () => {
    expect(fromSm2(2.5, 10).difficulty).toBeCloseTo(1, 6)
    expect(fromSm2(1.3, 10).difficulty).toBeCloseTo(10, 6)
    expect(fromSm2(1.9, 10).difficulty).toBeGreaterThan(4)
    expect(fromSm2(1.9, 10).difficulty).toBeLessThan(7)
  })

  it('carries the SM-2 interval over as the stability estimate', () => {
    expect(fromSm2(2.5, 21).stability).toBe(21)
  })

  it('clamps out-of-range ease factors and never returns zero stability', () => {
    expect(fromSm2(9, 5).difficulty).toBeCloseTo(1, 6)
    expect(fromSm2(0.1, 5).difficulty).toBeCloseTo(10, 6)
    expect(fromSm2(2.5, 0).stability).toBe(MIN_STABILITY)
  })
})

describe('daysBetween', () => {
  it('measures fractional days forward in time', () => {
    expect(daysBetween(daysAgo(2.5), NOW)).toBeCloseTo(2.5, 6)
  })

  it('never returns a negative span, and survives an unparseable timestamp', () => {
    expect(daysBetween(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe(0)
    expect(daysBetween('not a date', NOW)).toBe(0)
  })
})

describe('formatInterval', () => {
  it('picks a readable unit', () => {
    expect(formatInterval(0.5)).toBe('<1d')
    expect(formatInterval(1)).toBe('1d')
    expect(formatInterval(29)).toBe('29d')
    expect(formatInterval(45)).toBe('1.5mo')
    expect(formatInterval(180)).toBe('6mo')
    expect(formatInterval(400)).toBe('1.1y')
  })
})
