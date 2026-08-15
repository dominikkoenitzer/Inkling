/**
 * FSRS-4.5 — the Free Spaced Repetition Scheduler.
 *
 * Replaces the SM-2 implementation Inkling shipped through v0.3.x. SM-2 tracks one
 * number per card (an "ease factor") and multiplies the interval by it; FSRS models
 * two: **stability** (how many days until recall probability falls to 90%) and
 * **difficulty** (1–10, how much a review moves that needle). Because it knows both,
 * it can schedule a card for an explicit *desired retention* instead of an arbitrary
 * multiplier — you say "I want to remember 90% of what's due" and it solves for the
 * interval.
 *
 * Everything here is pure: no dates from the environment, no database, no I/O. The
 * caller passes `now` and `elapsedDays`. That is what makes it unit-testable, and
 * every formula below is covered in test/fsrs.test.ts.
 *
 * Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki
 */

/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. Matches the review UI's keys 1–4. */
export type Rating = 1 | 2 | 3 | 4
export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export const RATINGS: Record<ReviewGradeName, Rating> = { again: 1, hard: 2, good: 3, easy: 4 }
export type ReviewGradeName = 'again' | 'hard' | 'good' | 'easy'

/**
 * The forgetting curve is a power function, not an exponential: R(t) = (1 + F·t/S)^D.
 * DECAY/FACTOR are fixed for FSRS-4.5 and chosen so that R(S) = 0.9 exactly.
 */
export const DECAY = -0.5
export const FACTOR = 19 / 81

/** Published FSRS-4.5 default weights, used until a card history is large enough to fit your own. */
export const DEFAULT_PARAMS: readonly number[] = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975,
  2.2042, 0.2407, 2.9466, 0.5034, 0.6567
]

export const MIN_STABILITY = 0.1
/** 100 years. Nothing useful is scheduled past this, and it keeps the arithmetic finite. */
export const MAX_INTERVAL_DAYS = 36500
/** A lapsed card comes back inside the same session rather than tomorrow. */
export const RELEARN_MINUTES = 10

export interface MemoryState {
  stability: number
  difficulty: number
}

export interface SchedulableCard {
  state: CardState
  stability: number | null
  difficulty: number | null
  /** ISO timestamp of the previous review, or null for a card that has never been seen. */
  lastReview: string | null
}

export interface ScheduleResult {
  state: CardState
  stability: number
  difficulty: number
  /** Days since the previous review — recorded in the review log so parameters can be fitted later. */
  elapsedDays: number
  /** Whole days until the next review; 0 for a lapse, which comes back in RELEARN_MINUTES. */
  scheduledDays: number
  /** ISO timestamp the card next becomes due. */
  due: string
  /** Recall probability at review time — 1 for a card being seen for the first time. */
  retrievability: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Probability of recalling a card `elapsedDays` after its last review, given stability.
 * R(0) = 1, and R(stability) = 0.9 by construction.
 */
export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY)
}

/**
 * Days until recall probability decays to `desiredRetention`. The inverse of
 * `retrievability`, which is why FSRS can target a retention rate directly.
 */
export function intervalForRetention(desiredRetention: number, stability: number): number {
  const r = clamp(desiredRetention, 0.7, 0.99)
  return (stability / FACTOR) * (Math.pow(r, 1 / DECAY) - 1)
}

/** Stability of a card answered `rating` the very first time it was seen. */
export function initialStability(rating: Rating, w: readonly number[] = DEFAULT_PARAMS): number {
  return clamp(w[rating - 1], MIN_STABILITY, MAX_INTERVAL_DAYS)
}

/** Difficulty of a card answered `rating` the very first time it was seen. */
export function initialDifficulty(rating: Rating, w: readonly number[] = DEFAULT_PARAMS): number {
  return clamp(w[4] - w[5] * (rating - 3), 1, 10)
}

/**
 * Difficulty drifts down on Easy and up on Again, then reverts slightly toward the
 * difficulty of a card first answered Easy — so one bad day can't permanently brand
 * a card as hard.
 */
export function nextDifficulty(difficulty: number, rating: Rating, w: readonly number[] = DEFAULT_PARAMS): number {
  const next = difficulty - w[6] * (rating - 3)
  const reverted = w[7] * initialDifficulty(4, w) + (1 - w[7]) * next
  return clamp(reverted, 1, 10)
}

/**
 * Stability after a *successful* recall. The gain shrinks as stability and difficulty
 * grow, and — crucially — grows the longer you waited: recalling something you nearly
 * forgot is worth far more than recalling it twice in a row.
 */
export function nextRecallStability(
  difficulty: number,
  stability: number,
  r: number,
  rating: Rating,
  w: readonly number[] = DEFAULT_PARAMS
): number {
  const hardPenalty = rating === 2 ? w[15] : 1
  const easyBonus = rating === 4 ? w[16] : 1
  const gain =
    Math.exp(w[8]) *
    (11 - difficulty) *
    Math.pow(stability, -w[9]) *
    (Math.exp((1 - r) * w[10]) - 1) *
    hardPenalty *
    easyBonus
  return clamp(stability * (1 + gain), MIN_STABILITY, MAX_INTERVAL_DAYS)
}

/** Stability after a lapse. Never allowed to exceed the stability the card already had. */
export function nextForgetStability(
  difficulty: number,
  stability: number,
  r: number,
  w: readonly number[] = DEFAULT_PARAMS
): number {
  const s = w[11] * Math.pow(difficulty, -w[12]) * (Math.pow(stability + 1, w[13]) - 1) * Math.exp((1 - r) * w[14])
  // Forgetting must not make a card *more* stable, however the weights fall out.
  return clamp(Math.min(s, stability), MIN_STABILITY, MAX_INTERVAL_DAYS)
}

export function daysBetween(fromIso: string, to: Date): number {
  const from = Date.parse(fromIso)
  if (Number.isNaN(from)) return 0
  return Math.max(0, (to.getTime() - from) / 86_400_000)
}

/**
 * Schedule one review. The single entry point the repository layer calls.
 *
 * A card seen for the first time gets its memory state initialised from the rating.
 * Otherwise both stability and difficulty are updated from how long it had been since
 * the last review. `Again` always sends the card back inside the session; anything
 * else schedules it for the number of days that lands on `desiredRetention`.
 */
export function schedule(
  card: SchedulableCard,
  rating: Rating,
  now: Date,
  desiredRetention = 0.9,
  w: readonly number[] = DEFAULT_PARAMS
): ScheduleResult {
  const isNew = card.state === 'new' || card.stability === null || card.difficulty === null
  const elapsedDays = isNew || !card.lastReview ? 0 : daysBetween(card.lastReview, now)

  let stability: number
  let difficulty: number
  let r: number

  if (isNew) {
    r = 1
    stability = initialStability(rating, w)
    difficulty = initialDifficulty(rating, w)
  } else {
    r = retrievability(elapsedDays, card.stability as number)
    difficulty = nextDifficulty(card.difficulty as number, rating, w)
    stability =
      rating === 1
        ? nextForgetStability(card.difficulty as number, card.stability as number, r, w)
        : nextRecallStability(card.difficulty as number, card.stability as number, r, rating, w)
  }

  if (rating === 1) {
    // Lapses stay in the session: back in ten minutes, in a (re)learning state.
    const state: CardState = isNew || card.state === 'learning' ? 'learning' : 'relearning'
    return {
      state,
      stability,
      difficulty,
      elapsedDays,
      scheduledDays: 0,
      due: new Date(now.getTime() + RELEARN_MINUTES * 60_000).toISOString(),
      retrievability: r
    }
  }

  const scheduledDays = clamp(Math.round(intervalForRetention(desiredRetention, stability)), 1, MAX_INTERVAL_DAYS)
  return {
    state: 'review',
    stability,
    difficulty,
    elapsedDays,
    scheduledDays,
    due: new Date(now.getTime() + scheduledDays * 86_400_000).toISOString(),
    retrievability: r
  }
}

/**
 * What each button would schedule, without committing anything — used to print
 * "1d / 3d / 10d / 21d" under the review buttons so the choice is informed.
 */
export function previewIntervals(
  card: SchedulableCard,
  now: Date,
  desiredRetention = 0.9,
  w: readonly number[] = DEFAULT_PARAMS
): Record<Rating, number> {
  const out = {} as Record<Rating, number>
  for (const rating of [1, 2, 3, 4] as Rating[]) {
    out[rating] = schedule(card, rating, now, desiredRetention, w).scheduledDays
  }
  return out
}

/**
 * Convert an SM-2 card (ease factor + interval) to an FSRS memory state, for the
 * one-time migration of decks reviewed before v0.4.0. Ease factor runs 1.3 (hardest)
 * to ~2.5+ (easiest); difficulty runs the other way, 10 (hardest) to 1.
 */
export function fromSm2(easeFactor: number, intervalDays: number): MemoryState {
  const ef = clamp(easeFactor, 1.3, 2.5)
  return {
    stability: clamp(intervalDays, MIN_STABILITY, MAX_INTERVAL_DAYS),
    difficulty: clamp(10 - ((ef - 1.3) * 9) / 1.2, 1, 10)
  }
}

/** Human-readable interval, e.g. 1 → "1d", 45 → "1.5mo", 400 → "1.1y". */
export function formatInterval(days: number): string {
  if (days < 1) return '<1d'
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${(days / 30).toFixed(days < 90 ? 1 : 0)}mo`
  return `${(days / 365).toFixed(1)}y`
}
