import { describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openSqlite } from './sqlite'

// The migration runs in Electron against better-sqlite3; here against Node's own SQLite.
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('better-sqlite3', () => ({ default: class {} }))

const { migrate } = await import('../src/main/db')

const open = openSqlite

const columns = (raw: DatabaseSync, table: string): string[] =>
  (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)

const version = (raw: DatabaseSync): number => (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

/** The flashcard tables as a v10 database has them, before notes could own a deck. */
const V10 = `
CREATE TABLE notebooks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE notes (id INTEGER PRIMARY KEY, notebook_id INTEGER, title TEXT, content TEXT NOT NULL, deleted_at DATETIME);
CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT);
CREATE TABLE grades (id INTEGER PRIMARY KEY, title TEXT NOT NULL, system TEXT NOT NULL DEFAULT 'percent');
CREATE TABLE flashcard_decks (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE flashcards (
  id INTEGER PRIMARY KEY,
  deck_id INTEGER REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  ease_factor REAL DEFAULT 2.5,
  interval_days INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  stability REAL,
  difficulty REAL,
  state TEXT NOT NULL DEFAULT 'new',
  last_review DATETIME
);
CREATE TABLE review_log (
  id INTEGER PRIMARY KEY,
  card_id INTEGER REFERENCES flashcards(id) ON DELETE SET NULL,
  deck_id INTEGER,
  rating INTEGER NOT NULL,
  state TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  reviewed_at DATETIME NOT NULL
);
PRAGMA user_version = 10;
`

describe('migrate to v11', () => {
  it('links decks to notes and cards to note lines without touching existing cards', () => {
    const { raw, db } = open()
    raw.exec(V10)
    raw.exec(`INSERT INTO notebooks (id, name, color) VALUES (1, 'Biology', 'teal')`)
    raw.exec(`INSERT INTO flashcard_decks (id, notebook_id, name) VALUES (1, 1, 'Cells')`)
    raw.exec(`INSERT INTO flashcards (id, deck_id, front, back, stability, difficulty, state, last_review)
              VALUES (1, 1, 'Osmosis', 'water across a membrane', 12.5, 4.2, 'review', '2026-09-01T10:00:00.000Z')`)
    raw.exec(`INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, reviewed_at)
              VALUES (1, 1, 3, 'review', 12.5, 4.2, '2026-09-01T10:00:00.000Z')`)

    migrate(db)

    expect(version(raw)).toBe(11)
    expect(columns(raw, 'flashcard_decks')).toContain('note_id')
    expect(columns(raw, 'flashcards')).toEqual(expect.arrayContaining(['source_line', 'cloze']))
    expect(raw.prepare(`SELECT * FROM flashcards WHERE id = 1`).get()).toMatchObject({
      front: 'Osmosis',
      stability: 12.5,
      difficulty: 4.2,
      state: 'review',
      source_line: null,
      cloze: 0
    })
    expect(raw.prepare(`SELECT note_id FROM flashcard_decks WHERE id = 1`).get()).toEqual({ note_id: null })
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE card_id = 1`).get()).toEqual({ n: 1 })
  })

  it('unlinks a deck when its note is purged, and keeps the deck', () => {
    const { raw, db } = open()
    raw.exec(V10)
    migrate(db)
    raw.exec(`INSERT INTO notes (id, notebook_id, content) VALUES (7, 1, '{}')`)
    raw.exec(`INSERT INTO flashcard_decks (id, name, note_id) VALUES (1, 'Cells', 7)`)
    raw.exec(`DELETE FROM notes WHERE id = 7`)
    expect(raw.prepare(`SELECT id, note_id FROM flashcard_decks`).all()).toEqual([{ id: 1, note_id: null }])
  })

  it('creates a fresh database in the same shape the upgrade produces', () => {
    const upgraded = open()
    upgraded.raw.exec(V10)
    migrate(upgraded.db)

    const fresh = open()
    migrate(fresh.db)

    expect(version(fresh.raw)).toBe(11)
    for (const table of ['flashcard_decks', 'flashcards']) {
      expect(columns(fresh.raw, table)).toEqual(columns(upgraded.raw, table))
    }
  })

  it('is a no-op on a database that is already current', () => {
    const { raw, db } = open()
    migrate(db)
    migrate(db)
    expect(version(raw)).toBe(11)
  })
})
