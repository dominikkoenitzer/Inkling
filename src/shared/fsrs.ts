/**
 * FSRS-6. Tracks stability (days until recall drops to 90%) and difficulty (1-10) per
 * card, and solves for the interval that lands on a target retention. Compared with
 * FSRS-4.5 it adds same-day review terms (w17-w19) and makes the forgetting curve's
 * decay a trainable parameter (w20), so 21 parameters in all.
 *
 * The formulas, default parameters and parameter bounds follow ts-fsrs (MIT, Open Spaced
 * Repetition, https://github.com/open-spaced-repetition/ts-fsrs), checked against py-fsrs.
 * Written from the published algorithm, not copied.
 *
 * Pure: the caller passes `now`. Formulas are covered in test/fsrs.test.ts.
 * https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 */

/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. Matches the review UI's keys 1–4. */
export type Rating = 1 | 2 | 3 | 4
export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export const RATINGS: Record<ReviewGradeName, Rating> = { again: 1, hard: 2, good: 3, easy: 4 }
export type ReviewGradeName = 'again' | 'hard' | 'good' | 'easy'

/** Published FSRS-6 default parameters, used until the review log is large enough to fit your own. */
export const DEFAULT_PARAMS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
  1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
]
export const PARAM_COUNT = 21

/** Lower and upper bound of each parameter, as in the reference implementations. */
export const PARAM_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0.001, 100], // w0-w3: first-review stability for Again, Hard, Good, Easy
  [0.001, 100],
  [0.001, 100],
  [0.001, 100],
  [1, 10], // w4: first-review difficulty for Again
  [0.001, 4], // w5: how steeply the first rating moves difficulty
  [0.001, 4], // w6: difficulty change per rating
  [0.001, 0.75], // w7: mean reversion of difficulty
  [0, 4.5], // w8-w10: stability gain on recall
  [0, 0.8],
  [0.001, 3.5],
  [0.001, 5], // w11-w14: stability after a lapse
  [0.001, 0.25],
  [0.001, 0.9],
  [0, 4],
  [0, 1], // w15: Hard penalty
  [1, 6], // w16: Easy bonus
  [0, 2], // w17-w19: same-day reviews
  [0, 2],
  [0.01, 0.8],
  [0.1, 0.8] // w20: forgetting-curve decay
]

export const MIN_STABILITY = 0.001
/** 100 years. Nothing useful is scheduled past this, and it keeps the arithmetic finite. */
export const MAX_INTERVAL_DAYS = 36500
/** A lapsed card comes back inside the same session rather than tomorrow. */
export const RELEARN_MINUTES = 10

/** Desired retention: the recall chance a card is scheduled for. */
export const DEFAULT_RETENTION = 0.9
export const MIN_RETENTION = 0.7
export const MAX_RETENTION = 0.97

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
  /** Days since the previous review, recorded in the review log so parameters can be fitted later. */
  elapsedDays: number
  /** Whole days until the next review; 0 for a lapse, which comes back in RELEARN_MINUTES. */
  scheduledDays: number
  /** ISO timestamp the card next becomes due. */
  due: string
  /** Recall probability at review time, and 1 for a card being seen for the first time. */
  retrievability: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Clamps every parameter into its bounds. Anything that is not 21 finite numbers gives the defaults. */
export function clampParams(w: readonly number[]): number[] {
  if (w.length !== PARAM_COUNT || !w.every((v) => Number.isFinite(v))) return [...DEFAULT_PARAMS]
  return w.map((v, i) => clamp(v, PARAM_BOUNDS[i][0], PARAM_BOUNDS[i][1]))
}

/** Reads parameters stored as a JSON array, falling back to the defaults for anything unusable. */
export function parseParams(json: string | null | undefined): number[] {
  if (!json) return [...DEFAULT_PARAMS]
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? clampParams(value.map(Number)) : [...DEFAULT_PARAMS]
  } catch {
    return [...DEFAULT_PARAMS]
  }
}

/** Reads a stored desired retention, clamped into the supported band. */
export function parseRetention(value: string | null | undefined): number {
  const r = Number(value)
  return value && Number.isFinite(r) ? clamp(r, MIN_RETENTION, MAX_RETENTION) : DEFAULT_RETENTION
}

/** The curve's exponent, -w20. FSRS-4.5 fixed it at -0.5. */
export function decayOf(w: readonly number[] = DEFAULT_PARAMS): number {
  return -w[20]
}

/** Chosen so that R(S) = 0.9 exactly, whatever the decay. */
export function factorOf(w: readonly number[] = DEFAULT_PARAMS): number {
  return Math.pow(0.9, 1 / decayOf(w)) - 1
}

/** Recall probability `elapsedDays` after the last review: R(t) = (1 + F·t/S)^-w20, so R(0) = 1, R(S) = 0.9. */
export function retrievability(elapsedDays: number, stability: number, w: readonly number[] = DEFAULT_PARAMS): number {
  if (stability <= 0) return 0
  return Math.pow(1 + (factorOf(w) * Math.max(0, elapsedDays)) / stability, decayOf(w))
}

/** Days until recall decays to `desiredRetention`. The inverse of `retrievability`. */
export function intervalForRetention(desiredRetention: number, stability: number, w: readonly number[] = DEFAULT_PARAMS): number {
  const r = clamp(desiredRetention, MIN_RETENTION, MAX_RETENTION)
  return (stability / factorOf(w)) * (Math.pow(r, 1 / decayOf(w)) - 1)
}

/** Stability of a card answered `rating` the very first time it was seen. */
export function initialStability(rating: Rating, w: readonly number[] = DEFAULT_PARAMS): number {
  return clamp(w[rating - 1], MIN_STABILITY, MAX_INTERVAL_DAYS)
}

/** D0(G) = w4 - e^(w5·(G-1)) + 1, unclamped. Used as the mean-reversion target with G = Easy. */
function rawInitialDifficulty(rating: Rating, w: readonly number[]): number {
  return w[4] - Math.exp(w[5] * (rating - 1)) + 1
}

/** Difficulty of a card answered `rating` the very first time it was seen. */
export function initialDifficulty(rating: Rating, w: readonly number[] = DEFAULT_PARAMS): number {
  return clamp(rawInitialDifficulty(rating, w), 1, 10)
}

/**
 * Difficulty moves down on Easy and up on Again, by less the closer it already is to 10
 * (linear damping), then reverts slightly toward the difficulty of a card first answered
 * Easy, so one bad day can't permanently brand a card as hard.
 */
export function nextDifficulty(difficulty: number, rating: Rating, w: readonly number[] = DEFAULT_PARAMS): number {
  const delta = -w[6] * (rating - 3)
  const next = difficulty + (delta * (10 - difficulty)) / 9
  const reverted = w[7] * rawInitialDifficulty(4, w) + (1 - w[7]) * next
  return clamp(reverted, 1, 10)
}

/**
 * Stability after a *successful* recall. The gain shrinks as stability and difficulty
 * grow, and, crucially, grows the longer you waited: recalling something you nearly
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

/**
 * Stability after a lapse. Capped at S / e^(w17·w18), so forgetting never leaves a card
 * *more* stable than a same-day Again would.
 */
export function nextForgetStability(
  difficulty: number,
  stability: number,
  r: number,
  w: readonly number[] = DEFAULT_PARAMS
): number {
  const longTerm =
    w[11] * Math.pow(difficulty, -w[12]) * (Math.pow(stability + 1, w[13]) - 1) * Math.exp((1 - r) * w[14])
  const cap = stability / Math.exp(w[17] * w[18])
  return clamp(Math.min(longTerm, cap), MIN_STABILITY, MAX_INTERVAL_DAYS)
}

/**
 * Stability after a review less than a day after the previous one: S · e^(w17·(G-3+w18)) · S^-w19.
 * Hard, Good and Easy never lower it; big stabilities gain the least from a same-day repeat.
 */
export function nextShortTermStability(stability: number, rating: Rating, w: readonly number[] = DEFAULT_PARAMS): number {
  const increase = Math.pow(stability, -w[19]) * Math.exp(w[17] * (rating - 3 + w[18]))
  const masked = rating >= 2 ? Math.max(increase, 1) : increase
  return clamp(stability * masked, MIN_STABILITY, MAX_INTERVAL_DAYS)
}

/**
 * The memory state after one review: initialised from the rating for a first review, the
 * same-day terms for a review less than a day after the last, the long-term ones otherwise.
 * Shared by the scheduler and the optimiser, so both always run the same model.
 */
export function nextMemoryState(
  previous: MemoryState | null,
  elapsedDays: number,
  rating: Rating,
  w: readonly number[] = DEFAULT_PARAMS
): MemoryState & { retrievability: number } {
  if (!previous) {
    return { stability: initialStability(rating, w), difficulty: initialDifficulty(rating, w), retrievability: 1 }
  }
  const { stability: s, difficulty: d } = previous
  const r = retrievability(elapsedDays, s, w)
  const stability =
    elapsedDays < 1
      ? nextShortTermStability(s, rating, w)
      : rating === 1
        ? nextForgetStability(d, s, r, w)
        : nextRecallStability(d, s, r, rating, w)
  return { stability, difficulty: nextDifficulty(d, rating, w), retrievability: r }
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
  desiredRetention = DEFAULT_RETENTION,
  w: readonly number[] = DEFAULT_PARAMS
): ScheduleResult {
  const isNew = card.state === 'new' || card.stability === null || card.difficulty === null
  const elapsedDays = isNew || !card.lastReview ? 0 : daysBetween(card.lastReview, now)
  const next = nextMemoryState(
    isNew ? null : { stability: card.stability as number, difficulty: card.difficulty as number },
    elapsedDays,
    rating,
    w
  )
  const { stability, difficulty } = next
  const r = next.retrievability

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

  const scheduledDays = clamp(Math.round(intervalForRetention(desiredRetention, stability, w)), 1, MAX_INTERVAL_DAYS)
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
 * What each button would schedule, without committing anything, used to print
 * "1d / 3d / 10d / 21d" under the review buttons so the choice is informed.
 */
export function previewIntervals(
  card: SchedulableCard,
  now: Date,
  desiredRetention = DEFAULT_RETENTION,
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
