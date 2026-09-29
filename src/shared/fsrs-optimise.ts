/**
 * Fits the 21 FSRS-6 parameters to a review log. Every card's history is replayed with
 * the scheduler's own model (`nextMemoryState`); at each review a day or more after the
 * previous one, the predicted recall chance is scored against what happened (Again =
 * forgotten, anything else = recalled) with log-loss. Adam lowers the mean loss.
 *
 * Follows the reference optimiser's recipe (py-fsrs, MIT, Open Spaced Repetition):
 * first 64 reviews per card, mini-batches of 512 scored reviews, 5 epochs, learning rate
 * 0.04 with cosine annealing, parameters clamped to their bounds after every step, and
 * the best parameters seen kept. Gradients are central differences of the same model,
 * so the optimiser can never drift from the scheduler it tunes.
 *
 * Deterministic: cards are shuffled per epoch by a seeded generator, so the same log
 * always gives the same parameters. The work is bounded by capping the scored reviews.
 */
import { DEFAULT_PARAMS, PARAM_BOUNDS, clampParams, nextMemoryState, retrievability, type MemoryState, type Rating } from './fsrs'

/** Below this many scored reviews the defaults are kept: too little data to beat them. */
export const MIN_REVIEWS_TO_OPTIMISE = 400
/** Only a card's first 64 reviews are used, as in the reference optimiser. */
export const MAX_REVIEWS_PER_CARD = 64
/** Keeps a run to a few seconds. The newest cards are kept when a log is bigger than this. */
export const MAX_TRAINING_REVIEWS = 20_000

const EPOCHS = 5
const BATCH_SIZE = 512
const LEARNING_RATE = 0.04
const BETA1 = 0.9
const BETA2 = 0.999
const EPSILON = 1e-8
const SEED = 42

/** One answer, in review order. `at` is the review time in milliseconds. */
export interface ReviewEvent {
  rating: Rating
  at: number
}

/** A card's reviews ready for replay: `elapsed[i]` is days since review i-1 (0 for the first). */
export interface TrainingSequence {
  ratings: Rating[]
  elapsed: number[]
}

export interface OptimiseResult {
  params: number[]
  /** Mean log-loss with the parameters the run started from, and with the ones it returns. */
  lossBefore: number
  lossAfter: number
  /** Scored reviews: those a day or more after the card's previous review. */
  reviews: number
}

/** A scored review is one at least a day after the previous; same-day repeats only shape state. */
const scored = (seq: TrainingSequence, i: number): boolean => i > 0 && seq.elapsed[i] >= 1

export function countScoredReviews(seqs: readonly TrainingSequence[]): number {
  let n = 0
  for (const seq of seqs) for (let i = 1; i < seq.ratings.length; i++) if (scored(seq, i)) n++
  return n
}

/**
 * Turns complete card histories (each starting at the card's first ever review) into
 * training sequences: sorted, capped at 64 reviews, cards with a single review dropped,
 * and, past MAX_TRAINING_REVIEWS scored reviews, only the most recently started cards kept.
 */
export function toTrainingSequences(histories: ReadonlyArray<readonly ReviewEvent[]>): TrainingSequence[] {
  const seqs = histories
    .map((h) => [...h].sort((a, b) => a.at - b.at).slice(0, MAX_REVIEWS_PER_CARD))
    .filter((h) => h.length > 1)
    .sort((a, b) => a[0].at - b[0].at)
    .map((h) => ({
      ratings: h.map((e) => e.rating),
      elapsed: h.map((e, i) => (i === 0 ? 0 : Math.max(0, (e.at - h[i - 1].at) / 86_400_000)))
    }))
  let total = 0
  let start = seqs.length
  while (start > 0) {
    const n = countScoredReviews([seqs[start - 1]])
    if (total + n > MAX_TRAINING_REVIEWS && total > 0) break
    total += n
    start--
  }
  return seqs.slice(start)
}

/** Replays one card's reviews and returns its memory state after the last one. */
export function replayMemoryState(seq: TrainingSequence, w: readonly number[]): MemoryState | null {
  let state: MemoryState | null = null
  for (let i = 0; i < seq.ratings.length; i++) {
    const next = nextMemoryState(state, seq.elapsed[i], seq.ratings[i], w)
    state = { stability: next.stability, difficulty: next.difficulty }
  }
  return state
}

/** Summed log-loss and the number of scored reviews over `seqs`. */
function lossSum(seqs: readonly TrainingSequence[], w: readonly number[]): { sum: number; count: number } {
  let sum = 0
  let count = 0
  for (const seq of seqs) {
    let state: MemoryState | null = null
    for (let i = 0; i < seq.ratings.length; i++) {
      if (state && scored(seq, i)) {
        const p = Math.min(1 - 1e-7, Math.max(1e-7, retrievability(seq.elapsed[i], state.stability, w)))
        sum -= seq.ratings[i] > 1 ? Math.log(p) : Math.log(1 - p)
        count++
      }
      const next = nextMemoryState(state, seq.elapsed[i], seq.ratings[i], w)
      state = { stability: next.stability, difficulty: next.difficulty }
    }
  }
  return { sum, count }
}

/** Mean log-loss of the recall predictions `w` makes on `seqs`. Lower is better. */
export function logLoss(seqs: readonly TrainingSequence[], w: readonly number[]): number {
  const { sum, count } = lossSum(seqs, w)
  return count > 0 ? sum / count : 0
}

/** Gradient of the mean loss over a batch, by central differences. */
function gradient(batch: readonly TrainingSequence[], w: readonly number[], count: number): number[] {
  const g = new Array<number>(w.length).fill(0)
  const probe = [...w]
  for (let i = 0; i < w.length; i++) {
    const h = 1e-5 * Math.max(1, Math.abs(w[i]))
    probe[i] = w[i] + h
    const up = lossSum(batch, probe).sum
    probe[i] = w[i] - h
    const down = lossSum(batch, probe).sum
    probe[i] = w[i]
    g[i] = (up - down) / (2 * h * count)
  }
  return g
}

/** Small seeded generator (mulberry32), so a run is repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mini-batches of whole cards, each holding at least BATCH_SIZE scored reviews (bar the last). */
function batches(seqs: readonly TrainingSequence[]): Array<{ seqs: TrainingSequence[]; count: number }> {
  const out: Array<{ seqs: TrainingSequence[]; count: number }> = []
  let current: TrainingSequence[] = []
  let count = 0
  for (const seq of seqs) {
    current.push(seq)
    count += countScoredReviews([seq])
    if (count >= BATCH_SIZE) {
      out.push({ seqs: current, count })
      current = []
      count = 0
    }
  }
  if (count > 0) out.push({ seqs: current, count })
  return out
}

/**
 * The optimiser as a generator: it yields after every Adam step, so a caller can spread
 * the work over several ticks, and returns the result when done. `optimise` runs it
 * straight through.
 */
export function* optimiseSteps(
  seqs: readonly TrainingSequence[],
  start: readonly number[] = DEFAULT_PARAMS
): Generator<void, OptimiseResult, void> {
  const initial = clampParams(start)
  const reviews = countScoredReviews(seqs)
  const lossBefore = logLoss(seqs, initial)
  if (reviews < MIN_REVIEWS_TO_OPTIMISE) return { params: initial, lossBefore, lossAfter: lossBefore, reviews }

  const random = seeded(SEED)
  const order = [...seqs]
  const stepsPerEpoch = batches(order).length
  const totalSteps = stepsPerEpoch * EPOCHS
  const w = [...initial]
  const m = new Array<number>(w.length).fill(0)
  const v = new Array<number>(w.length).fill(0)
  let best = { params: [...initial], loss: lossBefore }
  let step = 0

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    // Fisher-Yates with the seeded generator.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const batch of batches(order)) {
      const g = gradient(batch.seqs, w, batch.count)
      step++
      const lr = 0.5 * LEARNING_RATE * (1 + Math.cos((Math.PI * (step - 1)) / totalSteps))
      for (let i = 0; i < w.length; i++) {
        m[i] = BETA1 * m[i] + (1 - BETA1) * g[i]
        v[i] = BETA2 * v[i] + (1 - BETA2) * g[i] * g[i]
        const mHat = m[i] / (1 - Math.pow(BETA1, step))
        const vHat = v[i] / (1 - Math.pow(BETA2, step))
        w[i] = Math.min(PARAM_BOUNDS[i][1], Math.max(PARAM_BOUNDS[i][0], w[i] - (lr * mHat) / (Math.sqrt(vHat) + EPSILON)))
      }
      yield
    }
    const loss = logLoss(seqs, w)
    if (loss < best.loss) best = { params: [...w], loss }
  }
  return { params: best.params, lossBefore, lossAfter: best.loss, reviews }
}

/** Runs the optimiser to the end in one go. */
export function optimise(seqs: readonly TrainingSequence[], start: readonly number[] = DEFAULT_PARAMS): OptimiseResult {
  const run = optimiseSteps(seqs, start)
  for (;;) {
    const next = run.next()
    if (next.done) return next.value
  }
}
