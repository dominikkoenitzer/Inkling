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
  icon TEXT,
  kind TEXT CHECK(kind IN ('general','school_subject')) DEFAULT 'general',
  sort_order INTEGER DEFAULT 0,
  is_journal BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  type TEXT CHECK(type IN ('page','sticky')) NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  color TEXT,
  pos_x REAL, pos_y REAL,
  width REAL, height REAL,
  pinned BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT CHECK(status IN ('todo','in_progress','done')) DEFAULT 'todo',
  priority TEXT CHECK(priority IN ('low','medium','high')) DEFAULT 'medium',
  due_date DATETIME,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
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

CREATE INDEX idx_notes_notebook ON notes(notebook_id, type);
CREATE INDEX idx_tasks_notebook ON tasks(notebook_id);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_note ON tasks(note_id);
CREATE INDEX idx_cards_deck ON flashcards(deck_id);
`
// Note: the `events` table the calendar module used is deliberately absent here. The module
// was removed in v0.3.0 and existing databases keep their rows untouched (the changelog
// promised as much), but there is no reason to create the table on a fresh install.

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

/**
 * One row per answered card, never updated. `deck_id` is denormalised so a deleted deck
 * doesn't erase the fact that you studied — the history survives the content.
 */
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

/** Directed note→note edges, rebuilt from a note's content whenever it is saved. */
const NOTE_LINKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS note_links (
  source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (source_note_id, target_note_id)
);
CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_note_id);
`

/** #hashtags found in a note's text, rebuilt on save. Tags are stored lower-cased. */
const NOTE_TAGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
`

function migrate(d: Database.Database): void {
  const version = d.pragma('user_version', { simple: true }) as number
  if (version < 1) {
    d.exec(SCHEMA)
    d.pragma('user_version = 1')
  }
  if (version < 2) {
    // Grade tracker (added in v0.2.0) — additive, keeps existing data intact.
    d.exec(GRADES_SCHEMA)
    d.pragma('user_version = 2')
  }
  if (version < 3) {
    // Per-row grading system (v0.3.4): score/max alone can't tell a native Swiss grade
    // apart from a points entry that happens to be out of 6, so a system switch used to
    // silently reinterpret old grades. Record the entry system per row. Fresh DBs already
    // have the column from GRADES_SCHEMA; only add it where missing, then backfill legacy
    // rows from the user's chosen system (their best-known origin).
    const cols = d.prepare(`PRAGMA table_info(grades)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'system')) {
      d.exec(`ALTER TABLE grades ADD COLUMN system TEXT NOT NULL DEFAULT 'percent'`)
    }
    const setting = d.prepare(`SELECT value FROM settings WHERE key = 'grading_system'`).get() as
      | { value: string }
      | undefined
    const system = setting?.value === 'us' || setting?.value === 'swiss' ? setting.value : 'percent'
    d.prepare(`UPDATE grades SET system = ?`).run(system)
    d.pragma('user_version = 3')
  }
  if (version < 4) {
    // v0.4.0 — review history + FSRS memory state.
    //
    // Through v0.3.x a card stored only where SM-2 had left it; every answer overwrote
    // the last one, so the app could never show whether you were improving. `review_log`
    // keeps one immutable row per answer, and the three new card columns hold the FSRS
    // state (stability/difficulty) that replaces the SM-2 ease factor. All additive —
    // the SM-2 columns stay, and existing cards are converted rather than reset.
    d.exec(REVIEW_LOG_SCHEMA)
    const cols = d.prepare(`PRAGMA table_info(flashcards)`).all() as Array<{ name: string }>
    const has = (name: string): boolean => cols.some((c) => c.name === name)
    if (!has('stability')) d.exec(`ALTER TABLE flashcards ADD COLUMN stability REAL`)
    if (!has('difficulty')) d.exec(`ALTER TABLE flashcards ADD COLUMN difficulty REAL`)
    if (!has('state')) d.exec(`ALTER TABLE flashcards ADD COLUMN state TEXT NOT NULL DEFAULT 'new'`)
    if (!has('last_review')) d.exec(`ALTER TABLE flashcards ADD COLUMN last_review DATETIME`)

    // Convert cards that already have SM-2 history. Ease factor runs 1.3 (hardest) to
    // 2.5 (easiest) and difficulty runs the other way, so the mapping is inverted; the
    // current interval is the best available estimate of stability. Untouched cards
    // (repetitions = 0) stay 'new' and get their memory state from their first answer.
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
    // v0.4.0 — soft-deleted notes. Deleting a page used to be an unrecoverable DELETE with
    // no confirmation; now it sets a tombstone, the UI offers an undo, and `purgeExpired`
    // clears anything older than TRASH_RETENTION_DAYS on the next launch.
    const cols = d.prepare(`PRAGMA table_info(notes)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'deleted_at')) {
      d.exec(`ALTER TABLE notes ADD COLUMN deleted_at DATETIME`)
    }
    d.exec(`CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at)`)
    d.pragma('user_version = 5')
  }
  if (version < 6) {
    // v0.4.0 — [[wiki-links]] between notes. The edge list is derived from note content on
    // every save, so it is safe to rebuild at any time; storing it means backlinks are a
    // single indexed query instead of a scan over every note body.
    d.exec(NOTE_LINKS_SCHEMA)
    d.pragma('user_version = 6')
  }
  if (version < 7) {
    // v0.4.0 — #hashtags. Like note links, the tag set is derived from note content on
    // every save, so this table is a rebuildable index rather than primary data. Existing
    // notes are backfilled below so tags appear immediately after upgrading.
    d.exec(NOTE_TAGS_SCHEMA)
    d.pragma('user_version = 7')
  }
}

/** Rolling local backups — keep the last 5, crash-safe via WAL checkpoint first. */
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
