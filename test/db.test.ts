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
CREATE VIRTUAL TABLE search_index USING fts5(title, content_text, source_type UNINDEXED, source_id UNINDEXED);
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

    expect(version(raw)).toBe(13)
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

    expect(version(fresh.raw)).toBe(13)
    for (const table of ['flashcard_decks', 'flashcards']) {
      expect(columns(fresh.raw, table)).toEqual(columns(upgraded.raw, table))
    }
  })

  it('is a no-op on a database that is already current', () => {
    const { raw, db } = open()
    migrate(db)
    migrate(db)
    expect(version(raw)).toBe(13)
  })
})

describe('migrate to v12', () => {
  it('adds the import key to cards and keeps their data', () => {
    const { raw, db } = open()
    raw.exec(V10)
    raw.exec(`INSERT INTO notebooks (id, name, color) VALUES (1, 'Biology', 'teal')`)
    raw.exec(`INSERT INTO flashcard_decks (id, notebook_id, name) VALUES (1, 1, 'Cells')`)
    raw.exec(`INSERT INTO flashcards (id, deck_id, front, back, stability, difficulty, state, last_review)
              VALUES (1, 1, 'Osmosis', 'water across a membrane', 12.5, 4.2, 'review', '2026-09-01T10:00:00.000Z')`)
    raw.exec(`INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, reviewed_at)
              VALUES (1, 1, 3, 'review', 12.5, 4.2, '2026-09-01T10:00:00.000Z')`)
    migrate(db)
    raw.exec(`PRAGMA user_version = 11`)
    raw.exec(`DROP INDEX idx_cards_external`)
    raw.exec(`ALTER TABLE flashcards DROP COLUMN external_id`)

    migrate(db)

    expect(version(raw)).toBe(13)
    expect(columns(raw, 'flashcards')).toContain('external_id')
    expect(raw.prepare(`SELECT * FROM flashcards WHERE id = 1`).get()).toMatchObject({
      front: 'Osmosis',
      stability: 12.5,
      difficulty: 4.2,
      state: 'review',
      external_id: null
    })
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE card_id = 1`).get()).toEqual({ n: 1 })
  })

  it('lets many cards have no import key but never two cards the same one', () => {
    const { raw, db } = open()
    migrate(db)
    raw.exec(`INSERT INTO flashcard_decks (id, name) VALUES (1, 'Cells')`)
    raw.exec(`INSERT INTO flashcards (deck_id, front, back) VALUES (1, 'a', 'b'), (1, 'c', 'd')`)
    raw.exec(`INSERT INTO flashcards (deck_id, front, back, external_id) VALUES (1, 'e', 'f', 'anki:x:0')`)
    expect(() => raw.exec(`INSERT INTO flashcards (deck_id, front, back, external_id) VALUES (1, 'g', 'h', 'anki:x:0')`)).toThrow()
  })
})

describe('migrate to v13', () => {
  const photosynthesis = JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Photo', marks: [{ type: 'bold' }] }, { type: 'text', text: 'synthesis' }] }]
  })
  const indexed = (raw: DatabaseSync): unknown[] =>
    raw.prepare(`SELECT title, content_text, source_type, source_id FROM search_index ORDER BY source_type, source_id`).all()

  /** A v12 database whose search rows were written with a space between text nodes. */
  function v12(): ReturnType<typeof open> {
    const opened = open()
    opened.raw.exec(V10)
    migrate(opened.db)
    opened.raw.exec(`PRAGMA user_version = 12`)
    opened.raw.exec(`INSERT INTO notes (id, notebook_id, title, content) VALUES (1, 1, 'Plants', '${photosynthesis}')`)
    opened.raw.exec(`INSERT INTO notes (id, notebook_id, title, content, deleted_at) VALUES (2, 1, 'Old', '${photosynthesis}', '2026-09-01')`)
    opened.raw.exec(`INSERT INTO search_index (title, content_text, source_type, source_id) VALUES
                     ('Plants', 'Photo synthesis', 'note', '1'), ('Water the plants', '', 'task', '5')`)
    return opened
  }

  it('re-indexes live notes so a partly formatted word is found', () => {
    const { raw, db } = v12()

    migrate(db)

    expect(version(raw)).toBe(13)
    expect(raw.prepare(`SELECT source_id FROM search_index WHERE search_index MATCH '"photosynthesis"*'`).all()).toEqual([{ source_id: '1' }])
    expect(indexed(raw)).toEqual([
      { title: 'Plants', content_text: 'Photosynthesis', source_type: 'note', source_id: '1' },
      { title: 'Water the plants', content_text: '', source_type: 'task', source_id: '5' }
    ])
  })

  it('gives the same index when it runs again', () => {
    const { raw, db } = v12()
    migrate(db)
    const once = indexed(raw)

    raw.exec(`PRAGMA user_version = 12`)
    migrate(db)

    expect(version(raw)).toBe(13)
    expect(indexed(raw)).toEqual(once)
  })
})
