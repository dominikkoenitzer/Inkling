import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import { DAY, START, TRUTH, syntheticLog } from './synthetic'
import { DEFAULT_PARAMS, nextMemoryState, parseParams, type MemoryState } from '../src/shared/fsrs'
import { MIN_REVIEWS_TO_OPTIMISE } from '../src/shared/fsrs-optimise'
import type { ReviewEvent } from '../src/shared/fsrs-optimise'

let raw: DatabaseSync
let db: Database.Database

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }))

const { migrate } = await import('../src/main/db')
const { optimiseParams, reviewHistories } = await import('../src/main/repos/scheduler')

beforeEach(() => {
  ;({ raw, db } = openSqlite())
  migrate(db)
  raw.exec(`INSERT INTO notebooks (id, name, color) VALUES (1, 'Biology', 'teal')`)
  raw.exec(`INSERT INTO flashcard_decks (id, notebook_id, name) VALUES (1, 1, 'Cells')`)
})

/** Writes a card per history, with its log rows and the memory state the defaults gave it. */
function seed(histories: ReviewEvent[][], firstState = 'new'): void {
  const card = raw.prepare(
    `INSERT INTO flashcards (deck_id, front, back, stability, difficulty, state, next_review_date) VALUES (1, ?, 'b', ?, ?, 'review', '2030-01-01T00:00:00.000Z')`
  )
  const log = raw.prepare(
    `INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, reviewed_at) VALUES (?, 1, ?, ?, 0, 0, ?)`
  )
  histories.forEach((events, i) => {
    let state: MemoryState | null = null
    let previous = 0
    for (const e of events) {
      state = nextMemoryState(state, state ? (e.at - previous) / DAY : 0, e.rating, DEFAULT_PARAMS)
      previous = e.at
    }
    const id = Number(card.run(`card ${i}`, state!.stability, state!.difficulty).lastInsertRowid)
    events.forEach((e, j) => log.run(id, e.rating, j === 0 ? firstState : 'review', new Date(e.at).toISOString()))
  })
}

const setting = (key: string): string | undefined =>
  (raw.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value

describe('reviewHistories', () => {
  it('reads complete histories and skips cards first seen before the log', () => {
    seed([[{ rating: 3, at: START }, { rating: 3, at: START + DAY }]])
    seed([[{ rating: 3, at: START }, { rating: 1, at: START + 2 * DAY }]], 'review')
    const histories = [...reviewHistories().values()]
    expect(histories).toEqual([
      [
        { rating: 3, at: START },
        { rating: 3, at: START + DAY }
      ]
    ])
  })
})

describe('optimiseParams', () => {
  it('keeps the defaults and says so below the review threshold', async () => {
    seed(syntheticLog(TRUTH, 10, 5))
    const outcome = await optimiseParams()
    expect(outcome.status).toBe('too-few')
    expect(outcome.needed).toBe(MIN_REVIEWS_TO_OPTIMISE)
    expect(outcome.reviews).toBeLessThan(MIN_REVIEWS_TO_OPTIMISE)
    expect(setting('fsrs_params')).toBeUndefined()
  })

  it('saves better parameters and recomputes memory states, leaving due dates alone', async () => {
    const log = syntheticLog(TRUTH, 150, 8)
    seed(log)
    const before = raw.prepare(`SELECT id, stability, next_review_date FROM flashcards ORDER BY id`).all() as Array<{
      id: number
      stability: number
      next_review_date: string
    }>

    const outcome = await optimiseParams()
    expect(outcome.status).toBe('fitted')
    expect(outcome.lossAfter).toBeLessThan(outcome.lossBefore)
    const saved = parseParams(setting('fsrs_params'))
    expect(saved).toEqual(outcome.params)

    const after = raw.prepare(`SELECT id, stability, next_review_date FROM flashcards ORDER BY id`).all() as typeof before
    expect(after.map((c) => c.next_review_date)).toEqual(before.map((c) => c.next_review_date))
    expect(after.some((c, i) => c.stability !== before[i].stability)).toBe(true)

    // Run again: the saved parameters are now the ones to beat.
    const again = await optimiseParams()
    expect(again.status).toBe('no-better')
    expect(parseParams(setting('fsrs_params'))).toEqual(saved)
  })
})
