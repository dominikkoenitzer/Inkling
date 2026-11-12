import Database from 'better-sqlite3'
import { join } from 'path'
import fs from 'fs'
import { tiptapToText } from './repos/text'
import { extractNoteTaskItems } from '@shared/noteTasks'
import { dayStamp, storedTime } from '@shared/day'
import { backupsOldestFirst, nextBackupName, stampDayOnly } from './backupNames'

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
  deleted_at DATETIME,
  edit_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL
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
  last_review DATETIME,
  source_line INTEGER,
  cloze INTEGER NOT NULL DEFAULT 0,
  external_id TEXT
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
CREATE INDEX idx_decks_note ON flashcard_decks(note_id);
CREATE UNIQUE INDEX idx_cards_external ON flashcards(external_id) WHERE external_id IS NOT NULL;
`
// The calendar module's `events` table is not created any more. Existing databases keep
// their rows; fresh ones have no reason to carry it.

/** Opens the database in `dir` (the userData folder), backs it up and migrates it. */
export function openDb(dir: string): Database.Database {
  fs.mkdirSync(dir, { recursive: true })
  const file = join(dir, 'inkling.db')
  const d = new Database(file)
  // Data from a newer Inkling stays exactly as it is: no journal switch, no backup, no write.
  if ((d.pragma('user_version', { simple: true }) as number) > CURRENT_VERSION) {
    d.close()
    throw new NewerDataError()
  }
  db = d
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Back up first, so a migration that goes wrong still leaves the file as it was.
  let backedUp = true
  try {
    backup(db, dir)
  } catch (err) {
    backedUp = false
    console.error('backup failed', err)
  }
  // Schema 15 drops the times for good, so it waits for a start whose backup holds them.
  migrate(db, { dropTimes: backedUp })
  if ((db.pragma('user_version', { simple: true }) as number) < CURRENT_VERSION) {
    db.close()
    db = null
    throw new NoBackupError()
  }
  compactIfMoved(db)
  // Only a default for upgraders: if the write fails (the MCP server may hold the lock),
  // the app starts anyway and tries again next time.
  try {
    settleTheme(db)
  } catch (err) {
    console.error('settling the theme failed', err)
  }
  return db
}

/** The data on disk was written by a newer Inkling than this one. */
class NewerDataError extends Error {
  constructor() {
    super('Your Inkling data is newer than this copy of Inkling. Update Inkling, then try again.')
  }
}

/** The backup before a move that cannot be undone failed, so the data stays as it was. */
class NoBackupError extends Error {
  constructor() {
    super('Inkling could not make a backup before updating your data, so it left the data as it was.')
  }
}

/** What the start dialog says when `openDb` throws. */
export function startFailure(err: unknown): string {
  return err instanceof NewerDataError || err instanceof NoBackupError ? err.message : 'Inkling could not open its data.'
}

/** When 0.8.0 shipped (UTC). It reads a missing theme as light; 0.7 read it as dark. */
const V080_RELEASED = '2026-10-10 18:13:06'

/**
 * Stores the theme once in a database that has none, so an upgrade keeps the look it had:
 * dark for data from before 0.8.0, light otherwise. Fresh databases get light on creation.
 */
export function settleTheme(d: Database.Database): void {
  if (d.prepare(`SELECT 1 FROM settings WHERE key = 'theme'`).get()) return
  // 0.7 and 0.8 share schema 13, so the age of the oldest row is what tells them apart.
  const oldest = d
    .prepare(
      `SELECT MIN(t) AS t FROM (
         SELECT MIN(datetime(created_at)) AS t FROM notebooks
         UNION ALL SELECT MIN(datetime(created_at)) FROM notes
         UNION ALL SELECT MIN(datetime(created_at)) FROM tasks
         UNION ALL SELECT MIN(datetime(reviewed_at)) FROM review_log
       )`
    )
    .get() as { t: string | null }
  const theme = oldest.t !== null && oldest.t < V080_RELEASED ? 'dark' : 'light'
  d.prepare(`INSERT INTO settings (key, value) VALUES ('theme', ?)`).run(theme)
}

/**
 * Opens the database for the MCP server, which runs next to the app. It never creates,
 * backs up or migrates: the app does that, and two processes must not migrate at once.
 * Throws unless the schema is exactly the one this build knows.
 */
export function attachDb(dir: string): Database.Database {
  const file = join(dir, 'inkling.db')
  if (!fs.existsSync(file)) throw new Error('Inkling has no data on this computer yet. Open Inkling once, then try again.')
  const d = new Database(file, { fileMustExist: true, timeout: 5000 })
  try {
    checkVersion(d)
    d.pragma('journal_mode = WAL')
    d.pragma('foreign_keys = ON')
  } catch (err) {
    d.close()
    throw err
  }
  db = d
  return d
}

/** Throws a readable error when the schema on disk is not the one this build expects. */
export function checkVersion(d: Database.Database): void {
  const version = d.pragma('user_version', { simple: true }) as number
  if (version < CURRENT_VERSION) {
    throw new Error('Inkling has to update its data first. Open Inkling once, then try again.')
  }
  if (version > CURRENT_VERSION) throw new NewerDataError()
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
const CURRENT_VERSION = 15

/**
 * Exported for the migration tests; `openDb` is the only caller in the app. Without
 * `dropTimes` it stops at schema 14, before the step that keeps the day only.
 */
export function migrate(d: Database.Database, { dropTimes = true }: { dropTimes?: boolean } = {}): void {
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
      d.exec(`INSERT INTO settings (key, value) VALUES ('theme', 'light')`)
      d.pragma(`user_version = ${CURRENT_VERSION}`)
    })()
    return
  }

  // Everything below upgrades a database written by an older version of Inkling.
  // Its MCP server may still write, so each step in a transaction takes the write lock before it reads.
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
             last_review = strftime('%Y-%m-%dT%H:%M:%fZ', next_review_date, '-' || CAST(MAX(interval_days, 0) AS TEXT) || ' days')
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
      d.pragma('user_version = 10')
    }).immediate()
  }
  if (version < 11) {
    // Cards made from a note stay linked to it. The deck points at its note, and each card
    // at the note line it came from (`source_line`, shared by every card of that line), so
    // syncing again updates cards in place instead of copying the note into a new deck.
    // `cloze` is the cloze number a card asks, 0 for a plain front/back card. Additive:
    // existing decks and cards keep their rows, scheduling and review history.
    const has = (table: string, column: string): boolean =>
      (d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column)
    d.transaction(() => {
      if (!has('flashcard_decks', 'note_id')) {
        d.exec(`ALTER TABLE flashcard_decks ADD COLUMN note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL`)
      }
      if (!has('flashcards', 'source_line')) d.exec(`ALTER TABLE flashcards ADD COLUMN source_line INTEGER`)
      if (!has('flashcards', 'cloze')) d.exec(`ALTER TABLE flashcards ADD COLUMN cloze INTEGER NOT NULL DEFAULT 0`)
      d.exec(`CREATE INDEX IF NOT EXISTS idx_decks_note ON flashcard_decks(note_id)`)
      d.pragma('user_version = 11')
    }).immediate()
  }
  if (version < 12) {
    // `external_id` marked cards from the removed deck import; null for everything else. Additive.
    const has = (table: string, column: string): boolean =>
      (d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column)
    d.transaction(() => {
      if (!has('flashcards', 'external_id')) d.exec(`ALTER TABLE flashcards ADD COLUMN external_id TEXT`)
      d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_external ON flashcards(external_id) WHERE external_id IS NOT NULL`)
      d.pragma('user_version = 12')
    }).immediate()
  }
  if (version < 13) {
    // Note search text used to put a space between text nodes, so a word with part of it
    // formatted (**Photo**synthesis) was indexed as two. Re-index every live note with
    // `tiptapToText` as it is now; trashed notes stay out of search.
    d.transaction(() => {
      const notes = d.prepare(`SELECT id, title, content FROM notes WHERE deleted_at IS NULL`).all() as Array<{
        id: number
        title: string | null
        content: string
      }>
      const drop = d.prepare(`DELETE FROM search_index WHERE source_type = 'note' AND source_id = ?`)
      const add = d.prepare(`INSERT INTO search_index (title, content_text, source_type, source_id) VALUES (?, ?, 'note', ?)`)
      for (const n of notes) {
        drop.run(String(n.id))
        add.run(n.title ?? 'Untitled', tiptapToText(n.content), String(n.id))
      }
      d.pragma('user_version = 13')
    }).immediate()
  }
  if (version < 14) {
    // Task ids are never handed out twice from here on, so a line cut and pasted back
    // cannot meet a new line that took its id in the meantime.
    taskIdsAutoincrement(d)
  }
  if (version < 15 && dropTimes) {
    // Only the day of an action is kept from here on.
    keepDaysOnly(d)
  }
}

/**
 * Rebuilds `tasks` with AUTOINCREMENT, keeping every row, id, index and trigger, then sets
 * schema 14. Foreign keys are off for the swap, or dropping the old table would clear
 * `focus_sessions.task_id`. Safe to run again.
 */
function taskIdsAutoincrement(d: Database.Database): void {
  const enforced = d.pragma('foreign_keys', { simple: true }) === 1
  d.pragma('foreign_keys = OFF')
  if (d.pragma('foreign_keys', { simple: true }) !== 0) throw new Error('could not turn foreign keys off to rebuild tasks')
  try {
    d.transaction(() => {
      const table = d.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`).get() as
        | { sql: string }
        | undefined
      const sql = table?.sql ?? ''
      const head = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"tasks"|`tasks`|\[tasks\]|tasks)\s*\(/i
      const idColumn = /\bid\s+INTEGER\s+PRIMARY\s+KEY\b/i
      if (head.test(sql) && idColumn.test(sql) && !/\bAUTOINCREMENT\b/i.test(sql)) {
        // Made from the table's own definition, so every column and constraint comes along.
        const extras = d
          .prepare(`SELECT sql FROM sqlite_master WHERE tbl_name = 'tasks' AND type IN ('index', 'trigger') AND sql IS NOT NULL`)
          .all() as Array<{ sql: string }>
        const cols = (d.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>).map((c) => `"${c.name}"`).join(', ')
        const rows = (): string => JSON.stringify(d.prepare(`SELECT COUNT(*) AS n, TOTAL(id) AS sum, MAX(id) AS top FROM tasks`).get())
        const before = rows()
        d.exec(`DROP TABLE IF EXISTS tasks_v14`)
        d.exec(sql.replace(head, 'CREATE TABLE tasks_v14 (').replace(idColumn, 'id INTEGER PRIMARY KEY AUTOINCREMENT'))
        d.exec(`INSERT INTO tasks_v14 (${cols}) SELECT ${cols} FROM tasks`)
        d.exec(`DROP TABLE tasks`)
        d.exec(`ALTER TABLE tasks_v14 RENAME TO tasks`)
        for (const e of extras) d.exec(e.sql)
        if (rows() !== before) throw new Error('rebuilding tasks changed its rows')
      }
      // A note can still carry the id of a row deleted before this, so new ids start above it.
      let top = (d.prepare(`SELECT COALESCE(MAX(id), 0) AS top FROM tasks`).get() as { top: number }).top
      for (const n of d.prepare(`SELECT content FROM notes`).all() as Array<{ content: string }>) {
        try {
          for (const { taskId } of extractNoteTaskItems(JSON.parse(n.content) as Record<string, unknown>)) {
            if (taskId !== null && Number.isSafeInteger(taskId) && taskId > top) top = taskId
          }
        } catch {
          // malformed content holds no lines
        }
      }
      const sequence = d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`).get()
      if (sequence && top > 0) {
        const raised = d.prepare(`UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'tasks'`).run(top)
        if (raised.changes === 0) d.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('tasks', ?)`).run(top)
      }
      d.pragma('user_version = 14')
    }).immediate()
  } finally {
    if (enforced) d.pragma('foreign_keys = ON')
  }
}

/** Every column that records when something was done. A task's due date is picked, so it stays. */
const DAY_COLUMNS: Array<[string, string]> = [
  ['notebooks', 'created_at'],
  ['notes', 'created_at'],
  ['notes', 'updated_at'],
  ['notes', 'deleted_at'],
  ['tasks', 'created_at'],
  ['tasks', 'completed_at'],
  ['flashcard_decks', 'created_at'],
  ['flashcards', 'next_review_date'],
  ['flashcards', 'last_review'],
  ['review_log', 'reviewed_at'],
  ['grades', 'created_at'],
  ['focus_sessions', 'started_at']
]

/** Numbers every note by its last edit, oldest first and unreadable times lowest, ties by id. */
function rankEdits(d: Database.Database, hasEditTime: boolean): void {
  d.exec(`ALTER TABLE notes ADD COLUMN edit_seq INTEGER NOT NULL DEFAULT 0`)
  if (!hasEditTime) return
  const notes = d.prepare(`SELECT id, updated_at FROM notes`).all() as Array<{ id: number; updated_at: string | null }>
  const at = (v: string | null): number => {
    const t = v === null ? Number.NaN : storedTime(v)
    return Number.isNaN(t) ? -Infinity : t
  }
  notes.sort((a, b) => at(a.updated_at) - at(b.updated_at) || a.id - b.id)
  const seq = d.prepare(`UPDATE notes SET edit_seq = ? WHERE id = ?`)
  notes.forEach((n, i) => seq.run(i + 1, n.id))
}

/**
 * Schema 15 keeps the day of each action and no time: every stored time becomes local midnight
 * of its day, and notes get `edit_seq` so the newest edit still comes first. The theme is
 * settled first, while the times it reads are still there. The start-up backup holds the
 * times as they were.
 */
function keepDaysOnly(d: Database.Database): void {
  d.transaction(() => {
    const has = (table: string, col: string): boolean =>
      (d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col)
    // Every real database has these by now; only a partial one lacks them, and has no theme to keep.
    const themeReads: Array<[string, string]> = [['settings', 'key'], ['notebooks', 'created_at'], ['notes', 'created_at'], ['tasks', 'created_at'], ['review_log', 'reviewed_at']]
    if (themeReads.every(([table, col]) => has(table, col))) settleTheme(d)
    // Ranked once, when the column comes in; a second run must not undo the order edits gave it.
    if (has('notes', 'id') && !has('notes', 'edit_seq')) rankEdits(d, has('notes', 'updated_at'))
    for (const [table, col] of DAY_COLUMNS) {
      if (!has(table, col)) continue
      const set = d.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`)
      for (const row of d.prepare(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`).all() as Array<{ id: number; v: unknown }>) {
        const t = storedTime(String(row.v))
        // An unreadable value stays as it is; it never was a time to keep.
        if (!Number.isNaN(t)) set.run(dayStamp(new Date(t)), row.id)
      }
    }
    // The old values stay in the file's free space until it is rewritten; see compactIfMoved.
    if (has('settings', 'key')) d.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')`).run(COMPACT_KEY)
    d.pragma('user_version = 15')
  }).immediate()
}

/** Set by the move to schema 15 until the file is rewritten without the times it held. */
const COMPACT_KEY = 'compact_pending'

/**
 * Rewrites the file after the move to schema 15, so the times it dropped are not left in its
 * free space or its write-ahead log. While the assistant holds the file this cannot finish;
 * the mark stays and the next start tries again.
 */
function compactIfMoved(d: Database.Database): void {
  try {
    if (!d.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(COMPACT_KEY)) return
    d.exec('VACUUM')
    const log = d.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }
    if (log.busy !== 0) return
    d.prepare(`DELETE FROM settings WHERE key = ?`).run(COMPACT_KEY)
    d.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
  } catch (err) {
    console.error('rewriting the data file failed', err)
  }
}

/**
 * Rolling local backups: keep the last 5. SQLite writes the copy from one read snapshot, WAL
 * included, so it stays whole while the MCP server reads or writes. A copy only gets its
 * `.db` name once complete, so a failed one never counts among the five.
 */
function backup(d: Database.Database, dir: string): void {
  const backupsDir = join(dir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  for (const f of fs.readdirSync(backupsDir)) {
    if (!f.endsWith('.partial')) continue
    try {
      fs.rmSync(join(backupsDir, f), { force: true })
    } catch {
      // an assistant's copy still being written; the next start removes it if it is left
    }
  }
  const target = join(backupsDir, nextBackupName(fs.readdirSync(backupsDir), 'inkling'))
  const partial = `${target}.partial`
  try {
    d.prepare('VACUUM INTO ?').run(partial)
    // SQLite does not flush the copy; a power cut must not leave a torn one under a `.db` name.
    const fd = fs.openSync(partial, 'r+')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(partial, target)
  } catch (err) {
    fs.rmSync(partial, { force: true })
    throw err
  }
  const files = backupsOldestFirst(fs.readdirSync(backupsDir), 'inkling')
  while (files.length > 5) {
    const oldest = files.shift()!
    // One copy that cannot be removed must not stop the pruning, or every start would add one.
    try {
      fs.unlinkSync(join(backupsDir, oldest))
    } catch (err) {
      console.error('removing an old backup failed', err)
    }
  }
  // Last, as every copy, rename and removal above moves the folder's time. One child sets both
  // creation times on Windows, and the start never waits on it.
  void stampDayOnly(target, backupsDir)
}
