import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import fs, { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSqlite } from './sqlite'
import { dayStamp, storedTime } from '../src/shared/day'

// The migration runs in Electron against better-sqlite3; here against Node's own SQLite.
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
const opening = vi.hoisted(() => ({ db: {} as object }))
// `new Database(file)` in openDb hands back the database a test put in `opening`.
vi.mock('better-sqlite3', () => ({
  default: class {
    constructor() {
      return opening.db
    }
  }
}))

const { migrate, openDb, settleTheme, startFailure } = await import('../src/main/db')

const open = openSqlite

const columns = (raw: DatabaseSync, table: string): string[] =>
  (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)

/** The local-midnight stamp schema 15 keeps for a stored time. */
const day = (v: string): string => dayStamp(new Date(storedTime(v)))

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

describe('migrate to v4', () => {
  /** The tables a v3 database has, as far as the later steps read them. */
  const V3 = `
CREATE TABLE notebooks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE notes (id INTEGER PRIMARY KEY, notebook_id INTEGER, title TEXT, content TEXT NOT NULL, type TEXT DEFAULT 'page');
CREATE VIRTUAL TABLE search_index USING fts5(title, content_text, source_type UNINDEXED, source_id UNINDEXED);
CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT);
CREATE TABLE grades (id INTEGER PRIMARY KEY, title TEXT NOT NULL, system TEXT NOT NULL DEFAULT 'percent');
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE flashcard_decks (id INTEGER PRIMARY KEY, notebook_id INTEGER, name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE flashcards (
  id INTEGER PRIMARY KEY,
  deck_id INTEGER REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  ease_factor REAL DEFAULT 2.5,
  interval_days INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review_date DATETIME DEFAULT CURRENT_TIMESTAMP
);
PRAGMA user_version = 3;
`

  it('stores the last review of a carried over card in the form the app writes', () => {
    const { raw, db } = open()
    raw.exec(V3)
    raw.exec(`INSERT INTO flashcard_decks (id, name) VALUES (1, 'Cells')`)
    raw.exec(`INSERT INTO flashcards (id, deck_id, front, back, interval_days, repetitions, next_review_date) VALUES
              (1, 1, 'Osmosis', 'water', 3, 2, '2026-10-25T12:00:00.000Z'),
              (2, 1, 'Cell', 'unit', 5, 1, '2026-10-25 12:00:00'),
              (3, 1, 'Wall', 'plants', 0, 0, '2026-10-25 12:00:00')`)

    migrate(db)

    expect(version(raw)).toBe(15)
    expect(raw.prepare(`SELECT id, state, last_review, next_review_date FROM flashcards ORDER BY id`).all()).toEqual([
      // Schema 15 then keeps only the day of each.
      { id: 1, state: 'review', last_review: day('2026-10-22T12:00:00.000Z'), next_review_date: day('2026-10-25T12:00:00.000Z') },
      { id: 2, state: 'review', last_review: day('2026-10-20T12:00:00.000Z'), next_review_date: day('2026-10-25 12:00:00') },
      { id: 3, state: 'new', last_review: null, next_review_date: day('2026-10-25 12:00:00') }
    ])
  })
})

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

    expect(version(raw)).toBe(15)
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

    expect(version(fresh.raw)).toBe(15)
    for (const table of ['flashcard_decks', 'flashcards']) {
      expect(columns(fresh.raw, table)).toEqual(columns(upgraded.raw, table))
    }
  })

  it('is a no-op on a database that is already current', () => {
    const { raw, db } = open()
    migrate(db)
    migrate(db)
    expect(version(raw)).toBe(15)
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

    expect(version(raw)).toBe(15)
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
    raw.exec(`INSERT INTO flashcards (deck_id, front, back, external_id) VALUES (1, 'e', 'f', 'pkg:x:0')`)
    expect(() => raw.exec(`INSERT INTO flashcards (deck_id, front, back, external_id) VALUES (1, 'g', 'h', 'pkg:x:0')`)).toThrow()
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

    expect(version(raw)).toBe(15)
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

    expect(version(raw)).toBe(15)
    expect(indexed(raw)).toEqual(once)
  })
})

describe('migrate to v14', () => {
  /** A database exactly as Inkling 0.8.1 creates it at schema 13. */
  const V13 = `
CREATE TABLE notebooks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT CHECK(status IN ('todo','done')) DEFAULT 'todo',
  due_date DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
CREATE TABLE flashcard_decks (id INTEGER PRIMARY KEY, notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL);
CREATE TABLE flashcards (id INTEGER PRIMARY KEY, deck_id INTEGER REFERENCES flashcard_decks(id) ON DELETE CASCADE, front TEXT NOT NULL, back TEXT NOT NULL, ease_factor REAL DEFAULT 2.5, interval_days INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0, next_review_date DATETIME DEFAULT CURRENT_TIMESTAMP, stability REAL, difficulty REAL, state TEXT NOT NULL DEFAULT 'new', last_review DATETIME, source_line INTEGER, cloze INTEGER NOT NULL DEFAULT 0, external_id TEXT);
CREATE TABLE focus_sessions (id INTEGER PRIMARY KEY, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL, deck_id INTEGER REFERENCES flashcard_decks(id) ON DELETE SET NULL, duration_minutes INTEGER, started_at DATETIME, completed BOOLEAN DEFAULT 0);
CREATE VIRTUAL TABLE search_index USING fts5(title, content_text, source_type UNINDEXED, source_id UNINDEXED);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX idx_notes_notebook ON notes(notebook_id);
CREATE INDEX idx_tasks_notebook ON tasks(notebook_id);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_note ON tasks(note_id);
CREATE INDEX idx_cards_deck ON flashcards(deck_id);
CREATE INDEX idx_decks_note ON flashcard_decks(note_id);
CREATE UNIQUE INDEX idx_cards_external ON flashcards(external_id) WHERE external_id IS NOT NULL;
CREATE TABLE grades (id INTEGER PRIMARY KEY, notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE, title TEXT NOT NULL, score REAL NOT NULL, max REAL NOT NULL DEFAULT 100, weight REAL NOT NULL DEFAULT 1, system TEXT NOT NULL DEFAULT 'percent', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_grades_notebook ON grades(notebook_id);
CREATE TABLE review_log (id INTEGER PRIMARY KEY, card_id INTEGER REFERENCES flashcards(id) ON DELETE SET NULL, deck_id INTEGER, rating INTEGER NOT NULL, state TEXT NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL, elapsed_days REAL NOT NULL DEFAULT 0, scheduled_days REAL NOT NULL DEFAULT 0, reviewed_at DATETIME NOT NULL);
CREATE INDEX idx_review_log_time ON review_log(reviewed_at);
CREATE INDEX idx_review_log_card ON review_log(card_id);
CREATE INDEX idx_review_log_deck ON review_log(deck_id);
CREATE INDEX idx_notes_deleted ON notes(deleted_at);
INSERT INTO settings (key, value) VALUES ('theme', 'light');
PRAGMA user_version = 13;
`
  const lines = (...ids: number[]): string =>
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'taskList', content: ids.map((taskId) => ({ type: 'taskItem', attrs: { checked: false, taskId }, content: [] })) }]
    })

  /** Schema 13 with to-dos in two notebooks, gaps where rows were deleted, and a focus session. */
  function v13(): ReturnType<typeof open> {
    const opened = open()
    opened.raw.exec(V13)
    opened.raw.exec(`
      INSERT INTO notebooks (id, name, color) VALUES (1, 'Home', 'teal'), (2, 'Maths', 'teal');
      INSERT INTO notes (id, notebook_id, title, content) VALUES (1, 1, 'Week', '${lines(1, 2, 5)}'), (2, 2, 'Exam', '${lines(7)}');
      INSERT INTO notes (id, notebook_id, title, content, deleted_at) VALUES (3, 1, 'Old', '${lines(9)}', '2026-10-12 13:02:00');
      INSERT INTO tasks (id, notebook_id, note_id, title, status, due_date, created_at, completed_at) VALUES
        (1, 1, 1, 'Buy agar', 'todo', '2026-10-20', '2026-10-01 08:00:00', NULL),
        (2, 1, 1, 'Book the lab', 'done', NULL, '2026-10-02 08:00:00', '2026-10-03 09:00:00'),
        (5, 1, 1, '', 'todo', NULL, '2026-10-04 08:00:00', NULL),
        (7, 2, 2, 'Learn the proofs', 'todo', '2026-11-02', '2026-10-05 08:00:00', NULL);
      INSERT INTO focus_sessions (id, task_id, duration_minutes, started_at, completed) VALUES (1, 7, 25, '2026-10-06 10:00:00', 1);
      INSERT INTO search_index (title, content_text, source_type, source_id) VALUES ('Buy agar', '', 'task', '1');
    `)
    return opened
  }
  const tasks = (raw: DatabaseSync): unknown[] => raw.prepare(`SELECT * FROM tasks ORDER BY id`).all()
  const tasksSql = (raw: DatabaseSync): string => (raw.prepare(`SELECT sql FROM sqlite_master WHERE name = 'tasks'`).get() as { sql: string }).sql
  const indexes = (raw: DatabaseSync): unknown[] =>
    raw.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' ORDER BY name`).all()
  const links = (raw: DatabaseSync, table: string): unknown[] => raw.prepare(`SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('${table}') ORDER BY "from"`).all()
  const foreignKeys = (raw: DatabaseSync): unknown => (raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys
  const add = (raw: DatabaseSync, title: string): number =>
    Number(raw.prepare(`INSERT INTO tasks (notebook_id, note_id, title) VALUES (1, 1, ?)`).run(title).lastInsertRowid)

  it('rebuilds tasks with AUTOINCREMENT and keeps every row, id, link and index', () => {
    const { raw, db } = v13()
    const rows = tasks(raw)
    const taskLinks = links(raw, 'tasks')
    const sessionLinks = links(raw, 'focus_sessions')
    const named = indexes(raw)

    migrate(db)

    expect(version(raw)).toBe(15)
    expect(tasksSql(raw)).toMatch(/id INTEGER PRIMARY KEY AUTOINCREMENT/)
    // Schema 15 then keeps only the day of each time.
    const asDays = (r: Record<string, unknown>): Record<string, unknown> => ({
      ...r,
      created_at: r.created_at === null ? null : day(String(r.created_at)),
      completed_at: r.completed_at === null ? null : day(String(r.completed_at))
    })
    expect(tasks(raw)).toEqual((rows as Array<Record<string, unknown>>).map(asDays))
    expect(links(raw, 'tasks')).toEqual(taskLinks)
    expect(links(raw, 'focus_sessions')).toEqual(sessionLinks)
    expect(indexes(raw)).toEqual(named)
    expect(raw.prepare(`SELECT task_id FROM focus_sessions`).all()).toEqual([{ task_id: 7 }])
    expect(raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'tasks_v14'`).all()).toEqual([])
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(foreignKeys(raw)).toBe(1)
  })

  it('never hands a deleted id to a new task', () => {
    const { raw, db } = v13()
    migrate(db)

    // 9 is stamped in a trashed note although its row is gone, so new ids start above it.
    const first = add(raw, 'Call Anna')
    expect(first).toBe(10)
    raw.exec(`DELETE FROM tasks WHERE id = ${first}`)
    const second = add(raw, 'Pay rent')
    expect(second).toBe(11)
    raw.exec(`DELETE FROM tasks WHERE id IN (7, ${second})`)
    expect(add(raw, 'Water the plants')).toBe(12)

    // A line pasted back still gets its own id again.
    raw.exec(`INSERT INTO tasks (id, notebook_id, note_id, title) VALUES (${first}, 1, 1, 'Call Anna')`)
    expect(raw.prepare(`SELECT id FROM tasks ORDER BY id`).all().map((r) => (r as { id: number }).id)).toEqual([1, 2, 5, 10, 12])
  })

  it('starts above the highest row when no note carries a higher id', () => {
    const { raw, db } = v13()
    raw.exec(`UPDATE notes SET content = '{"type":"doc"}' WHERE id = 3`)
    raw.exec(`UPDATE notes SET content = 'not json' WHERE id = 2`)
    migrate(db)
    expect(add(raw, 'Call Anna')).toBe(8)
  })

  it('keeps the foreign keys working on the new table', () => {
    const { raw, db } = v13()
    migrate(db)

    raw.exec(`DELETE FROM tasks WHERE id = 7`)
    expect(raw.prepare(`SELECT task_id FROM focus_sessions`).all()).toEqual([{ task_id: null }])
    raw.exec(`DELETE FROM notes WHERE id = 1`)
    expect(raw.prepare(`SELECT id, note_id FROM tasks ORDER BY id`).all()).toEqual([
      { id: 1, note_id: null },
      { id: 2, note_id: null },
      { id: 5, note_id: null }
    ])
    raw.exec(`DELETE FROM notebooks WHERE id = 1`)
    expect(tasks(raw)).toEqual([])
    expect(() => raw.exec(`INSERT INTO tasks (notebook_id, title) VALUES (99, 'Nowhere')`)).toThrow()
  })

  it('gives the same table when it runs again', () => {
    const { raw, db } = v13()
    migrate(db)
    // Stamped with its day, as the app writes it.
    raw.prepare(`UPDATE tasks SET created_at = ? WHERE id = ?`).run(dayStamp(), add(raw, 'Call Anna'))
    const once = { rows: tasks(raw), sql: tasksSql(raw), named: indexes(raw), seq: raw.prepare(`SELECT * FROM sqlite_sequence`).all() }

    raw.exec(`PRAGMA user_version = 13`)
    migrate(db)

    expect(version(raw)).toBe(15)
    expect({ rows: tasks(raw), sql: tasksSql(raw), named: indexes(raw), seq: raw.prepare(`SELECT * FROM sqlite_sequence`).all() }).toEqual(once)
    expect(foreignKeys(raw)).toBe(1)
  })

  it('leaves the database at schema 13 when the rebuild fails', () => {
    const { raw, db } = v13()
    const rows = tasks(raw)
    const sql = tasksSql(raw)
    // A view in the way makes the rebuild throw halfway.
    raw.exec(`CREATE VIEW tasks_v14 AS SELECT 1`)

    expect(() => migrate(db)).toThrow()

    expect(version(raw)).toBe(13)
    expect(tasksSql(raw)).toBe(sql)
    expect(tasks(raw)).toEqual(rows)
    expect(raw.prepare(`SELECT task_id FROM focus_sessions`).all()).toEqual([{ task_id: 7 }])
    expect(foreignKeys(raw)).toBe(1)
  })

  it('creates a fresh database with the same tasks table the upgrade makes', () => {
    const upgraded = v13()
    migrate(upgraded.db)
    const fresh = open()
    migrate(fresh.db)

    expect(tasksSql(fresh.raw)).toMatch(/id INTEGER PRIMARY KEY AUTOINCREMENT/)
    expect(columns(fresh.raw, 'tasks')).toEqual(columns(upgraded.raw, 'tasks'))
    expect(links(fresh.raw, 'tasks')).toEqual(links(upgraded.raw, 'tasks'))
    expect(indexes(fresh.raw)).toEqual(indexes(upgraded.raw))
  })
})

describe('an upgrade while the assistant writes', () => {
  type Outcome = 'wrote' | 'refused'

  /** A file in WAL mode at schema `from`, with an MCP server from the older build still attached to it. */
  function attached(from: number): { raw: DatabaseSync; db: ReturnType<typeof open>['db']; assistant: DatabaseSync; close: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'inkling-upgrade-'))
    const file = join(dir, 'inkling.db')
    const { raw, db } = open(file)
    raw.exec('PRAGMA journal_mode = WAL')
    raw.exec(V10)
    raw.exec(`
      INSERT INTO notebooks (id, name, color) VALUES (1, 'Biology', 'teal');
      INSERT INTO notes (id, notebook_id, title, content) VALUES (1, 1, 'Plants', '{"type":"doc","content":[]}');
      INSERT INTO tasks (id, title, status) VALUES (1, 'Buy agar', 'todo');
      PRAGMA user_version = ${from};
    `)
    const assistant = new DatabaseSync(file)
    const close = (): void => {
      assistant.close()
      raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
    return { raw, db, assistant, close }
  }

  /** One write by the assistant. Node's SQLite does not wait for a lock, so a held one refuses it. */
  const assistantWrites = (assistant: DatabaseSync): void =>
    void assistant.prepare(`INSERT INTO notebooks (name, color) VALUES ('Probe', 'teal')`).run()

  /** Runs `fn` and has the assistant try a write before each statement the app runs inside a transaction. */
  function whileAssistantWrites(raw: DatabaseSync, assistant: DatabaseSync, fn: () => void): Outcome[] {
    const prepare = raw.prepare.bind(raw)
    const exec = raw.exec.bind(raw)
    const outcomes: Outcome[] = []
    const attempt = (): void => {
      if (!raw.isTransaction) return
      try {
        assistantWrites(assistant)
        outcomes.push('wrote')
      } catch (err) {
        if (!/locked|busy/i.test(String(err))) throw err
        outcomes.push('refused')
      }
    }
    raw.prepare = ((sql: string) => {
      const stmt = prepare(sql)
      for (const m of ['run', 'get', 'all'] as const) {
        const call = stmt[m].bind(stmt) as (...args: unknown[]) => unknown
        Object.assign(stmt, {
          [m]: (...args: unknown[]) => {
            attempt()
            return call(...args)
          }
        })
      }
      return stmt as StatementSync
    }) as typeof raw.prepare
    raw.exec = ((sql: string) => {
      attempt()
      exec(sql)
    }) as typeof raw.exec
    try {
      fn()
      return outcomes
    } finally {
      raw.prepare = prepare
      raw.exec = exec
    }
  }

  it.each([9, 10, 11, 12, 13])('from schema %i holds the write lock before its first statement', (from) => {
    const { raw, db, assistant, close } = attached(from)
    try {
      const outcomes = whileAssistantWrites(raw, assistant, () => migrate(db))

      expect(version(raw)).toBe(15)
      expect(outcomes.length).toBeGreaterThan(1)
      expect(outcomes).not.toContain('wrote')
      // The write that waited lands once the upgrade is done.
      assistantWrites(assistant)
    } finally {
      close()
    }
  })
})

describe('migrate to v15', () => {
  /** A current database put back to schema 14, before notes counted their edits. */
  function v14(file?: string): ReturnType<typeof open> {
    const opened = open(file)
    if (file) opened.raw.exec('PRAGMA journal_mode = WAL')
    migrate(opened.db)
    opened.raw.exec(`
      ALTER TABLE notes DROP COLUMN edit_seq;
      DELETE FROM settings WHERE key = 'theme';
      INSERT INTO notebooks (id, name, color, created_at) VALUES (1, 'Home', 'teal', '2026-10-10 18:30:00');
      INSERT INTO notes (id, notebook_id, title, content, created_at, updated_at, deleted_at) VALUES
        (1, 1, 'Late', '{}', '2026-10-10 18:30:00', '2026-11-02T15:20:00.000Z', NULL),
        (2, 1, 'Early', '{}', '2026-10-11 08:00:00', '2026-11-01 09:10:00', NULL),
        (3, 1, 'Same', '{}', '2026-10-11 08:00:00', '2026-11-01 09:10:00', '2026-11-03 07:45:10'),
        (4, 1, 'Odd', '{}', 'not a date', 'not a date', NULL);
      INSERT INTO tasks (id, notebook_id, note_id, title, status, due_date, created_at, completed_at) VALUES
        (1, 1, 1, 'Buy agar', 'done', '2026-11-20', '2026-10-12 13:02:00', '2026-11-04T20:59:59.999Z');
      INSERT INTO flashcard_decks (id, notebook_id, name, created_at) VALUES (1, 1, 'Cells', '2026-10-13 10:00:00');
      INSERT INTO flashcards (id, deck_id, front, back, next_review_date, last_review) VALUES
        (1, 1, 'front', 'back', '2026-11-12T14:00:00.000Z', '2026-11-02 23:30:00');
      INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, reviewed_at) VALUES
        (1, 1, 3, 'review', 2, 5, '2026-11-02 23:30:00');
      PRAGMA user_version = 14;
    `)
    return opened
  }
  const stamps = (raw: DatabaseSync): unknown[] =>
    raw.prepare(`
      SELECT 'notebooks' AS t, id, created_at AS a, NULL AS b, NULL AS c FROM notebooks
      UNION ALL SELECT 'notes', id, created_at, updated_at, deleted_at FROM notes
      UNION ALL SELECT 'tasks', id, created_at, completed_at, due_date FROM tasks
      UNION ALL SELECT 'decks', id, created_at, NULL, NULL FROM flashcard_decks
      UNION ALL SELECT 'cards', id, next_review_date, last_review, NULL FROM flashcards
      UNION ALL SELECT 'log', id, reviewed_at, NULL, NULL FROM review_log
      ORDER BY 1, 2`).all()
  const inZurich = (run: () => void): void => {
    const zone = process.env.TZ
    process.env.TZ = 'Europe/Zurich'
    try {
      run()
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  }

  it('keeps the day of every stored time and drops the time', () =>
    inZurich(() => {
      const { raw, db } = v14()
      migrate(db)
      expect(version(raw)).toBe(15)
      expect(stamps(raw)).toEqual([
        { t: 'cards', id: 1, a: day('2026-11-12T14:00:00.000Z'), b: day('2026-11-02 23:30:00'), c: null },
        { t: 'decks', id: 1, a: day('2026-10-13 10:00:00'), b: null, c: null },
        { t: 'log', id: 1, a: day('2026-11-02 23:30:00'), b: null, c: null },
        { t: 'notebooks', id: 1, a: day('2026-10-10 18:30:00'), b: null, c: null },
        { t: 'notes', id: 1, a: day('2026-10-10 18:30:00'), b: day('2026-11-02T15:20:00.000Z'), c: null },
        { t: 'notes', id: 2, a: day('2026-10-11 08:00:00'), b: day('2026-11-01 09:10:00'), c: null },
        { t: 'notes', id: 3, a: day('2026-10-11 08:00:00'), b: day('2026-11-01 09:10:00'), c: day('2026-11-03 07:45:10') },
        // Unreadable values never were a time, so they stay as they are.
        { t: 'notes', id: 4, a: 'not a date', b: 'not a date', c: null },
        // A due date is picked, not done, so it keeps its form.
        { t: 'tasks', id: 1, a: day('2026-10-12 13:02:00'), b: day('2026-11-04T20:59:59.999Z'), c: '2026-11-20' }
      ])
      // Late in the day in UTC is the next morning here.
      expect(day('2026-11-02 23:30:00')).toBe(new Date(2026, 10, 3).toISOString())
    }))

  it('orders notes by their last edit, oldest edit lowest, ties by id', () =>
    inZurich(() => {
      const { raw, db } = v14()
      migrate(db)
      expect(raw.prepare(`SELECT id, edit_seq FROM notes ORDER BY id`).all()).toEqual([
        { id: 1, edit_seq: 4 },
        { id: 2, edit_seq: 2 },
        { id: 3, edit_seq: 3 },
        { id: 4, edit_seq: 1 }
      ])
    }))

  it('settles the theme from the times before they become days', () =>
    inZurich(() => {
      // Made after 0.8.0 shipped, though its day began before it: the look stays light.
      const { raw, db } = v14()
      migrate(db)
      expect(raw.prepare(`SELECT value FROM settings WHERE key = 'theme'`).get()).toEqual({ value: 'light' })
    }))

  it('gives the same rows when it runs again', () =>
    inZurich(() => {
      const { raw, db } = v14()
      migrate(db)
      const once = { rows: stamps(raw), seq: raw.prepare(`SELECT id, edit_seq FROM notes ORDER BY id`).all() }
      raw.exec(`PRAGMA user_version = 14`)
      migrate(db)
      expect({ rows: stamps(raw), seq: raw.prepare(`SELECT id, edit_seq FROM notes ORDER BY id`).all() }).toEqual(once)
    }))

  /** A schema 14 store on disk with many clock times, and the times it holds. */
  function v14OnDisk(): { dir: string; file: string; raw: DatabaseSync; db: ReturnType<typeof open>['db']; times: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'inkling-move-'))
    const file = join(dir, 'inkling.db')
    const { raw, db } = v14(file)
    const add = raw.prepare(`INSERT INTO notes (notebook_id, title, content, created_at, updated_at) VALUES (1, ?, '{}', ?, ?)`)
    const times: string[] = []
    for (let i = 0; i < 200; i++) {
      const made = new Date(Date.UTC(2026, 9, 1, 6, 0, i * 7)).toISOString().replace('T', ' ').slice(0, 19)
      const edited = new Date(Date.UTC(2026, 10, 1, 7, 3, i * 11)).toISOString()
      add.run(`Note ${i}`, made, edited)
      times.push(made, edited)
    }
    for (const r of stamps(raw) as Array<Record<string, unknown>>) {
      for (const v of [r.a, r.b, r.c]) if (typeof v === 'string' && /\d\d:\d\d/.test(v)) times.push(v)
    }
    raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    return { dir, file, raw, db, times }
  }

  /** The clock times among `times` still found in the database file or its log. */
  const leftIn = (file: string, times: string[]): string[] => {
    const bytes = [file, `${file}-wal`].filter((f) => fs.existsSync(f)).map((f) => readFileSync(f).toString('latin1')).join('')
    return times.filter((t) => bytes.includes(t))
  }

  it('leaves none of the old times in the file once the app has moved it', () =>
    inZurich(() => {
      const { dir, file, raw, db, times } = v14OnDisk()
      expect(leftIn(file, times).length).toBe(times.length)
      opening.db = db
      try {
        openDb(dir)
        expect(version(raw)).toBe(15)
        raw.close()
        expect(leftIn(file, times)).toEqual([])
      } finally {
        if (raw.isOpen) raw.close()
        rmSync(dir, { recursive: true, force: true })
      }
    }))

  it('clears the old times at the next start when the assistant held the file', () =>
    inZurich(() => {
      const { dir, file, raw, db, times } = v14OnDisk()
      const exec = raw.exec.bind(raw)
      let locked = true
      opening.db = Object.assign(db, {
        exec: (sql: string) => {
          if (locked && sql.trim().toUpperCase() === 'VACUUM') throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
          return exec(sql)
        }
      })
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        openDb(dir)
        expect(version(raw)).toBe(15)
        locked = false
        openDb(dir)
        raw.close()
        expect(leftIn(file, times)).toEqual([])
      } finally {
        quiet.mockRestore()
        if (raw.isOpen) raw.close()
        rmSync(dir, { recursive: true, force: true })
      }
    }))

  it('stays at schema 14 with every time kept when the backup before the move fails', () =>
    inZurich(() => {
      const { dir, raw, db } = v14OnDisk()
      // A file where the backups folder should be: the copy cannot be made.
      writeFileSync(join(dir, 'backups'), 'in the way')
      const before = stamps(raw)
      opening.db = db
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        let thrown: unknown
        try {
          openDb(dir)
        } catch (err) {
          thrown = err
        }
        expect(thrown).toBeInstanceOf(Error)
        expect(startFailure(thrown)).toBe('Inkling could not make a backup before updating your data, so it left the data as it was.')
        expect(version(raw)).toBe(14)
        expect(stamps(raw)).toEqual(before)
      } finally {
        quiet.mockRestore()
        if (raw.isOpen) raw.close()
        rmSync(dir, { recursive: true, force: true })
      }
    }))
})

describe('the theme of a database without one', () => {
  const theme = (raw: DatabaseSync): unknown => (raw.prepare(`SELECT value FROM settings WHERE key = 'theme'`).get() as { value: string } | undefined)?.value

  it('is light in a database made fresh', () => {
    const { raw, db } = open()
    migrate(db)
    expect(theme(raw)).toBe('light')
  })

  it('stays dark for data from before 0.8.0, which read a missing theme as dark', () => {
    const { raw, db } = open()
    migrate(db)
    raw.exec(`DELETE FROM settings`)
    raw.exec(`INSERT INTO notebooks (name, color, created_at) VALUES ('My Notebook', 'teal', '2026-09-20 08:00:00')`)
    raw.exec(`INSERT INTO notes (notebook_id, content, created_at) VALUES (1, '{}', '2026-09-21T08:00:00.000Z')`)

    settleTheme(db)

    expect(theme(raw)).toBe('dark')
  })

  it('is light for data 0.8 made, and a chosen theme is never changed', () => {
    const { raw, db } = open()
    migrate(db)
    raw.exec(`DELETE FROM settings`)
    raw.exec(`INSERT INTO notebooks (name, color, created_at) VALUES ('Notes', 'teal', '2026-10-11 08:00:00')`)
    settleTheme(db)
    expect(theme(raw)).toBe('light')

    raw.exec(`UPDATE notebooks SET created_at = '2026-09-20 08:00:00'`)
    raw.exec(`UPDATE settings SET value = 'light' WHERE key = 'theme'`)
    settleTheme(db)
    expect(theme(raw)).toBe('light')
  })

  it('does not stop the app from starting when it cannot be written', () => {
    const { raw, db } = open()
    migrate(db)
    raw.exec(`DELETE FROM settings`)
    // The MCP server holds the write lock.
    const prepare = raw.prepare.bind(raw)
    opening.db = Object.assign(db, {
      prepare: (sql: string) => {
        if (sql.startsWith('INSERT INTO settings')) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
        return prepare(sql)
      }
    })
    const dir = mkdtempSync(join(tmpdir(), 'inkling-db-'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(openDb(dir)).toBe(db)
      expect(quiet).toHaveBeenCalledWith('settling the theme failed', expect.any(Error))
      expect(theme(raw)).toBeUndefined()
    } finally {
      quiet.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the startup backup', () => {
  const kept = (dir: string): string[] => readdirSync(join(dir, 'backups')).sort()
  const earlier = [1, 2, 3, 4, 5].map((day) => `inkling-2026-10-0${day}T08-00-00.db`)

  /** A database file in a fresh folder, with five earlier backups when asked. */
  function folder(withEarlier: boolean): { dir: string; raw: DatabaseSync; db: ReturnType<typeof open>['db'] } {
    const dir = mkdtempSync(join(tmpdir(), 'inkling-backup-'))
    const { raw, db } = open(join(dir, 'inkling.db'))
    raw.exec('PRAGMA journal_mode = WAL')
    migrate(db)
    mkdirSync(join(dir, 'backups'))
    if (withEarlier) for (const f of earlier) writeFileSync(join(dir, 'backups', f), 'earlier')
    opening.db = db
    return { dir, raw, db }
  }

  it('holds what is still in the write-ahead log while another connection reads', () => {
    const { dir, raw } = folder(false)
    const reader = new DatabaseSync(join(dir, 'inkling.db'))
    let copy: DatabaseSync | undefined
    try {
      // The MCP server in the middle of a read.
      reader.exec('BEGIN')
      reader.prepare('SELECT COUNT(*) AS n FROM notes').get()
      raw.exec(`INSERT INTO notebooks (name, color) VALUES ('Biology', 'teal')`)

      openDb(dir)
      reader.exec('COMMIT')

      expect(kept(dir)).toHaveLength(1)
      copy = new DatabaseSync(join(dir, 'backups', kept(dir)[0]))
      expect(copy.prepare('SELECT name FROM notebooks').all()).toEqual([{ name: 'Biology' }])
    } finally {
      copy?.close()
      reader.close()
      raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the newest five', () => {
    const { dir, raw } = folder(true)
    try {
      openDb(dir)
      // The oldest time-named copy goes; the new one is numbered.
      expect(kept(dir)).toEqual(['inkling-1.db', ...earlier.slice(1)].sort())
    } finally {
      raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps pruning past an old copy it cannot remove', () => {
    const { dir, raw } = folder(true)
    // Oldest of all and cannot be unlinked, like a copy open in another program.
    const stuck = 'inkling-2026-01-01T00-00-00.db'
    mkdirSync(join(dir, 'backups', stuck))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      openDb(dir)
      expect(quiet).not.toHaveBeenCalledWith('backup failed', expect.anything())
      expect(quiet).toHaveBeenCalledWith('removing an old backup failed', expect.any(Error))
      expect(kept(dir)).toEqual(['inkling-1.db', stuck, ...earlier.slice(1)].sort())
    } finally {
      quiet.mockRestore()
      raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('has the copy on disk before it takes its place among the five', () => {
    const { dir, raw } = folder(false)
    const steps: string[] = []
    const flush = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => void steps.push('flush'))
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => void steps.push('rename'))
    try {
      openDb(dir)
      expect(steps).toEqual(['flush', 'rename'])
    } finally {
      flush.mockRestore()
      rename.mockRestore()
      raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never keeps a copy that failed halfway, so it cannot push out a good one', () => {
    const { dir, raw, db } = folder(true)
    writeFileSync(join(dir, 'backups', 'inkling-2026-10-06T08-00-00.db.partial'), 'left by a crash')
    // The disk fills up in the middle of the copy, whichever way the copy is made.
    const halfway = (target: string): never => {
      writeFileSync(target, 'half')
      throw new Error('ENOSPC: no space left on device')
    }
    const copyFile = vi.spyOn(fs, 'copyFileSync').mockImplementation((_from, to) => halfway(String(to)))
    const prepare = raw.prepare.bind(raw)
    opening.db = Object.assign(db, {
      prepare: (sql: string) => (sql.startsWith('VACUUM INTO') ? { run: (to: string) => halfway(to) } : prepare(sql))
    })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      openDb(dir)
      expect(quiet).toHaveBeenCalledWith('backup failed', expect.any(Error))
      expect(kept(dir)).toEqual(earlier)
    } finally {
      copyFile.mockRestore()
      quiet.mockRestore()
      raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still makes its copy while an assistant is writing one', () => {
    const { dir, raw } = folder(false)
    const busy = 'assistant-2026-10-06T08-00-00.db.4242.partial'
    writeFileSync(join(dir, 'backups', busy), 'half')
    // Windows refuses to delete a file the MCP server's SQLite still holds open.
    const rm = fs.rmSync.bind(fs)
    const remove = vi.spyOn(fs, 'rmSync').mockImplementation((path, opts) => {
      if (String(path).endsWith(busy)) throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${String(path)}'`), { code: 'EBUSY' })
      rm(path, opts)
    })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      openDb(dir)
      expect(quiet).not.toHaveBeenCalled()
      expect(kept(dir)).toEqual([busy, 'inkling-1.db'])
    } finally {
      remove.mockRestore()
      quiet.mockRestore()
      raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('data from a newer Inkling', () => {
  const NEWER = 'Your Inkling data is newer than this copy of Inkling. Update Inkling, then try again.'

  it('is left untouched and refused with the sentence the assistant path uses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkling-newer-'))
    const file = join(dir, 'inkling.db')
    const made = open(file)
    migrate(made.db)
    // Without a stored theme the start would write one, and five backups would lose the oldest.
    made.raw.exec(`DELETE FROM settings WHERE key = 'theme'`)
    made.raw.exec(`PRAGMA user_version = ${version(made.raw) + 1}`)
    made.raw.close()
    mkdirSync(join(dir, 'backups'))
    const earlier = [1, 2, 3, 4, 5].map((day) => `inkling-2026-10-0${day}T08-00-00.db`)
    for (const f of earlier) writeFileSync(join(dir, 'backups', f), 'earlier')
    const before = readFileSync(file)
    const { raw, db } = open(file)
    opening.db = db
    try {
      let thrown: unknown
      try {
        openDb(dir)
      } catch (err) {
        thrown = err
      }
      expect.soft(thrown).toBeInstanceOf(Error)
      expect.soft(startFailure(thrown)).toBe(NEWER)
      expect.soft(readFileSync(file).equals(before)).toBe(true)
      expect.soft(readdirSync(dir).sort()).toEqual(['backups', 'inkling.db'])
      expect.soft(readdirSync(join(dir, 'backups')).sort()).toEqual(earlier)
    } finally {
      if (raw.isOpen) raw.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves every other start failure to the general sentence', () => {
    expect(startFailure(new Error('SQLITE_CORRUPT: database disk image is malformed'))).toBe('Inkling could not open its data.')
    expect(startFailure('not an error')).toBe('Inkling could not open its data.')
  })
})
