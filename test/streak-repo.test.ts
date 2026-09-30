import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'

let raw: DatabaseSync
let db: Database.Database

vi.mock('../src/main/db', () => ({ getDb: () => db }))

const { bumpStreak, getStreak } = await import('../src/main/repos/streak')

const setting = (key: string): string | undefined =>
  (raw.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value

/** A counter written by a version from before the streak was read off the history. */
const legacy = (count: number, lastDay: string): void => {
  raw.prepare(`INSERT INTO settings (key, value) VALUES ('streak_count', ?), ('streak_last_day', ?)`).run(String(count), lastDay)
}

/** One answered card at local noon on `day`, then the call a finished session makes. */
const reviewOn = (day: string): ReturnType<typeof bumpStreak> => {
  vi.setSystemTime(new Date(`${day}T12:00:00`))
  raw.prepare(`INSERT INTO review_log (reviewed_at) VALUES (?)`).run(new Date(`${day}T12:00:00`).toISOString())
  return bumpStreak(day)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  ;({ raw, db } = openSqlite())
  raw.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE review_log (id INTEGER PRIMARY KEY, reviewed_at DATETIME NOT NULL);
    CREATE TABLE focus_sessions (id INTEGER PRIMARY KEY, started_at DATETIME, duration_minutes INTEGER, completed BOOLEAN DEFAULT 0);
  `)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a streak carried over from the legacy counter', () => {
  it('grows by one with the first review after it', () => {
    legacy(30, '2026-09-29')

    expect(reviewOn('2026-09-30')).toEqual({ count: 31, last_day: '2026-09-30' })
    expect(setting('streak_count')).toBe('31')
    expect(getStreak().count).toBe(31)
  })

  it('keeps growing on the days after that', () => {
    legacy(30, '2026-09-29')
    reviewOn('2026-09-30')

    expect(reviewOn('2026-10-01').count).toBe(32)
    expect(reviewOn('2026-10-02').count).toBe(33)
  })

  it('does not count a second review on the same day twice', () => {
    legacy(30, '2026-09-29')
    reviewOn('2026-09-30')

    expect(reviewOn('2026-09-30').count).toBe(31)
  })

  it('is dropped once it has lapsed', () => {
    legacy(30, '2026-09-27')

    expect(reviewOn('2026-09-30').count).toBe(1)
  })
})
