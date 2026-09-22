import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

let db: Database.Database | null = null

const SCHEMA = `
CREATE TABLE notebooks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE focus_sessions (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  deck_id INTEGER REFERENCES flashcard_decks(id) ON DELETE SET NULL,
  duration_minutes INTEGER,
  started_at DATETIME,
  completed BOOLEAN DEFAULT 0
);

CREATE VIRTUAL TABLE search_index USING fts5(
  title, content_text, source_type UNINDEXED, source_id UNINDEXED
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_notes_notebook ON notes(notebook_id);
CREATE INDEX idx_tasks_notebook ON tasks(notebook_id);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_note ON tasks(note_id);
CREATE INDEX idx_cards_deck ON flashcards(deck_id);
`
// The calendar module's `events` table is not created any more. Existing databases keep
// their rows; fresh ones have no reason to carry it.

export function openDb(): Database.Database {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const file = join(dir, 'inkling.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  try {
    backup(db, file, dir)
  } catch (err) {
    console.error('backup failed', err)
  }
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('database not opened')
  return db
}

const GRADES_SCHEMA = `
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  score REAL NOT NULL,
  max REAL NOT NULL DEFAULT 100,
  weight REAL NOT NULL DEFAULT 1,
  system TEXT NOT NULL DEFAULT 'percent',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grades_notebook ON grades(notebook_id);
`

/** One row per answered card, never updated. `deck_id` is denormalised so history outlives the deck. */
const REVIEW_LOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY,
  card_id INTEGER REFERENCES flashcards(id) ON DELETE SET NULL,
  deck_id INTEGER,
  rating INTEGER NOT NULL,
  state TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  reviewed_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_log_time ON review_log(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id);
CREATE INDEX IF NOT EXISTS idx_review_log_deck ON review_log(deck_id);
`

/** The schema version the code in this build expects. */
const CURRENT_VERSION = 10

function migrate(d: Database.Database): void {
  const version = d.pragma('user_version', { simple: true }) as number

  if (version === 0) {
    // A new database is created in its current shape. Replaying the migrations instead
    // used to break a fresh install, because the old steps touch columns the schema no
    // longer has. Create and version bump must land together or not at all.
    d.transaction(() => {
      d.exec(SCHEMA)
      d.exec(GRADES_SCHEMA)
      d.exec(REVIEW_LOG_SCHEMA)
      d.exec(`CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at)`)
      d.pragma(`user_version = ${CURRENT_VERSION}`)
    })()
    return
  }

  // Everything below upgrades a database written by an older version of Inkling.
  if (version < 2) {
    // Grade tracker (added in v0.2.0): additive, keeps existing data intact.
    d.exec(GRADES_SCHEMA)
    d.pragma('user_version = 2')
  }
  if (version < 3) {
    // Per-row grading system: score/max cannot tell a Swiss grade from a six-point quiz,
    // so a system switch used to reinterpret old rows. Backfill from the chosen system,
    // which is the best guess available for rows entered before this existed.
    const cols = d.prepare(`PRAGMA table_info(grades)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'system')) {
      d.exec(`ALTER TABLE grades ADD COLUMN system TEXT NOT NULL DEFAULT 'percent'`)
    }
    const setting = d.prepare(`SELECT value FROM settings WHERE key = 'grading_system'`).get() as
      | { value: string }
      | undefined
    const system = setting?.value === 'swiss' ? 'swiss' : 'percent'
    d.prepare(`UPDATE grades SET system = ?`).run(system)
    d.pragma('user_version = 3')
  }
  if (version < 4) {
    // Review history and FSRS memory state. `review_log` keeps one row per answer; the
    // new card columns hold stability/difficulty. The SM-2 columns stay and existing
    // cards are converted rather than reset.
    d.exec(REVIEW_LOG_SCHEMA)
    const cols = d.prepare(`PRAGMA table_info(flashcards)`).all() as Array<{ name: string }>
    const has = (name: string): boolean => cols.some((c) => c.name === name)
    if (!has('stability')) d.exec(`ALTER TABLE flashcards ADD COLUMN stability REAL`)
    if (!has('difficulty')) d.exec(`ALTER TABLE flashcards ADD COLUMN difficulty REAL`)
    if (!has('state')) d.exec(`ALTER TABLE flashcards ADD COLUMN state TEXT NOT NULL DEFAULT 'new'`)
    if (!has('last_review')) d.exec(`ALTER TABLE flashcards ADD COLUMN last_review DATETIME`)

    // Ease factor runs 1.3 (hardest) to 2.5 (easiest) and difficulty runs the other way,
    // hence the inverted mapping. The current interval is the best estimate of stability.
    // Untouched cards stay 'new' and get their state from their first answer.
    d.exec(`
      UPDATE flashcards
         SET state      = 'review',
             stability  = MAX(interval_days, 0.1),
             difficulty = MAX(1.0, MIN(10.0, 10.0 - ((MIN(MAX(ease_factor, 1.3), 2.5) - 1.3) * 9.0 / 1.2))),
             last_review = datetime(next_review_date, '-' || CAST(MAX(interval_days, 0) AS TEXT) || ' days')
       WHERE repetitions > 0
    `)
    d.pragma('user_version = 4')
  }
  if (version < 5) {
    // Soft-deleted notes: a tombstone instead of a DELETE, so the toast can undo it.
    // `purgeExpiredNotes` clears anything past TRASH_RETENTION_DAYS on the next launch.
    const cols = d.prepare(`PRAGMA table_info(notes)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'deleted_at')) {
      d.exec(`ALTER TABLE notes ADD COLUMN deleted_at DATETIME`)
    }
    d.exec(`CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at)`)
    d.pragma('user_version = 5')
  }
  if (version < 8) {
    // #hashtags and the sticky board were removed. The tag index was derived data, so it
    // goes; stickies become ordinary pages so they stay reachable.
    d.exec(`DROP TABLE IF EXISTS note_tags`)
    d.exec(`UPDATE notes SET type = 'page' WHERE type = 'sticky'`)
    d.pragma('user_version = 8')
  }
  if (version < 9) {
    // [[wiki-links]] were removed. The edge list was derived from note content, so the
    // table goes; the labels stay as plain text in the notes that used them.
    d.exec(`DROP TABLE IF EXISTS note_links`)
    d.pragma('user_version = 9')
  }
  if (version < 10) {
    // Columns the removed features left behind. SQLite drops them in place; `notes.type`
    // needs its index rebuilt around it first. Guarded per column, so this is a no-op on
    // a database created from the current schema.
    const dropIfPresent = (table: string, column: string): void => {
      const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
    }
    d.transaction(() => {
      // Values the app can no longer produce, normalised to the ones that replaced them.
      // "Doing" behaved as an open task and a US-letter row was always points underneath.
      d.exec(`UPDATE tasks SET status = 'todo' WHERE status = 'in_progress'`)
      d.exec(`UPDATE grades SET system = 'percent' WHERE system = 'us'`)
      d.exec(`DROP INDEX IF EXISTS idx_notes_notebook`)
      for (const c of ['type', 'color', 'pos_x', 'pos_y', 'width', 'height', 'pinned']) dropIfPresent('notes', c)
      for (const c of ['priority', 'parent_task_id']) dropIfPresent('tasks', c)
      for (const c of ['icon', 'kind', 'is_journal']) dropIfPresent('notebooks', c)
      d.exec(`CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id)`)
      d.pragma(`user_version = ${CURRENT_VERSION}`)
    })()
  }
}

/** Rolling local backups: keep the last 5, crash-safe via WAL checkpoint first. */
function backup(d: Database.Database, file: string, dir: string): void {
  const backupsDir = join(dir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  d.pragma('wal_checkpoint(TRUNCATE)')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  fs.copyFileSync(file, join(backupsDir, `inkling-${stamp}.db`))
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith('inkling-') && f.endsWith('.db'))
    .sort()
  while (files.length > 5) {
    const oldest = files.shift()!
    fs.unlinkSync(join(backupsDir, oldest))
  }
}
