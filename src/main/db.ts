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
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  recurrence_rule TEXT,
  linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  color TEXT
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
  next_review_date DATETIME DEFAULT CURRENT_TIMESTAMP
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
CREATE INDEX idx_events_start ON events(start_time);
CREATE INDEX idx_cards_deck ON flashcards(deck_id);
`

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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grades_notebook ON grades(notebook_id);
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
