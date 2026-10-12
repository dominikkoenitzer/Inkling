import { getDb } from '../db'
import { now } from './dates'
import { homeNotebookId } from './notebooks'
import { createNote, getNote } from './notes'
import { ftsDelete, ftsUpsert, tiptapToText } from './search'
import { extractNoteTaskItems } from '@shared/noteTasks'
import type { NoteTaskItem, OpenTask, Task } from '@shared/types'

// A task is a checkbox line in a note. The rows here mirror those lines for Today and search.

/** Open checkboxes from live notes: dated ones first, then the most recently edited notes. */
export function openTasks(): OpenTask[] {
  return getDb()
    .prepare(
      `SELECT t.*, n.title AS note_title FROM tasks t
       JOIN notes n ON n.id = t.note_id
       WHERE t.status != 'done' AND n.deleted_at IS NULL
       ORDER BY t.due_date IS NULL, t.due_date, n.updated_at DESC, t.id`
    )
    .all() as OpenTask[]
}

export function getTask(id: number): Task | null {
  return (getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined) ?? null
}

/** Ticks or unticks a task and writes the same state into its note. */
export function setTaskDone(id: number, done: boolean): Task | null {
  const db = getDb()
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`).run(done ? 'done' : 'todo', done ? now() : null, id)
    const task = getTask(id)
    if (task?.note_id != null) checkNoteItem(task.note_id, id, done)
  })()
  return getTask(id)
}

/** Rows a sync deleted in this session, so a line that comes back gets its row back. */
const removedTasks = new Map<number, Task>()

/** Whether a note's stored content still has a checkbox line linked to `taskId`. */
function noteHasTask(noteId: number | null, taskId: number): boolean {
  const note = noteId !== null ? getNote(noteId) : null
  if (!note) return false
  try {
    return extractNoteTaskItems(JSON.parse(note.content) as Record<string, unknown>).some((i) => i.taskId === taskId)
  } catch {
    return false // malformed content holds no lines
  }
}

/**
 * Create or update a task row per checklist item in a note, and prune tasks whose checkbox
 * was deleted. Returns ids in the same order as `items`, for stamping back into the doc.
 */
export function syncNoteTasks(noteId: number, notebookId: number, items: NoteTaskItem[]): number[] {
  const db = getDb()
  const ids: number[] = []
  const tx = db.transaction(() => {
    const existing = db.prepare(`SELECT * FROM tasks WHERE note_id = ?`).all(noteId) as Task[]
    const byId = new Map(existing.map((t) => [t.id, t]))
    for (const item of items) {
      const title = item.title.trim()
      // An empty line is not a to-do yet: no row, and 0 so nothing is stamped on it.
      if (!title) {
        ids.push(0)
        continue
      }
      const known = item.taskId !== null ? getTask(item.taskId) : null
      let current = item.taskId !== null ? byId.get(item.taskId) : undefined
      if (!current && known && known.note_id !== noteId && !noteHasTask(known.note_id, known.id)) {
        // The line moved here from another note: its row comes along, due date and all.
        db.prepare(`UPDATE tasks SET note_id = ?, notebook_id = ? WHERE id = ?`).run(noteId, notebookId, known.id)
        current = known
      }
      if (current) {
        const status = item.checked ? 'done' : 'todo'
        db.prepare(`UPDATE tasks SET title = ?, status = ?, completed_at = ? WHERE id = ?`).run(
          title,
          status,
          status === 'done' ? (current.completed_at ?? now()) : null,
          current.id
        )
        ftsUpsert('task', current.id, title, '')
        ids.push(current.id)
        byId.delete(current.id)
      } else {
        // A line back after its row was deleted (undo, or cut and pasted) gets the row back
        // under its old id; a copy of a line gets a row of its own. Both keep the due date.
        const gone = item.taskId !== null ? removedTasks.get(item.taskId) : undefined
        const info = db
          .prepare(
            `INSERT INTO tasks (id, notebook_id, note_id, title, status, due_date, created_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            gone && !known ? gone.id : null,
            notebookId,
            noteId,
            title,
            item.checked ? 'done' : 'todo',
            gone?.due_date ?? known?.due_date ?? null,
            gone?.created_at ?? now(),
            item.checked ? (gone?.completed_at ?? now()) : null
          )
        const newId = Number(info.lastInsertRowid)
        if (gone) removedTasks.delete(gone.id)
        removedTasks.delete(newId) // an id used again belongs to the new row now
        ftsUpsert('task', newId, title, '')
        ids.push(newId)
      }
    }
    for (const orphan of byId.values()) {
      db.prepare(`DELETE FROM tasks WHERE id = ?`).run(orphan.id)
      ftsDelete('task', orphan.id)
      removedTasks.set(orphan.id, orphan)
    }
  })
  // Reads before it writes: take the write lock first, so a commit from the MCP server
  // in between cannot fail it.
  tx.immediate()
  return ids
}

/**
 * Older builds made a row titled "Untitled task" for an empty checkbox line, and it showed on
 * Today. Drops the rows whose line is still empty. Safe to run on every start.
 */
export function dropBlankTasks(): number {
  const db = getDb()
  let dropped = 0
  db.transaction(() => {
    const rows = db
      .prepare(`SELECT t.id, n.content FROM tasks t JOIN notes n ON n.id = t.note_id WHERE t.title = 'Untitled task'`)
      .all() as Array<{ id: number; content: string }>
    for (const row of rows) {
      let doc: Record<string, unknown>
      try {
        doc = JSON.parse(row.content) as Record<string, unknown>
      } catch {
        continue // malformed content, skip
      }
      const line = extractNoteTaskItems(doc).find((i) => i.taskId === row.id)
      if (!line || line.title) continue
      db.prepare(`DELETE FROM tasks WHERE id = ?`).run(row.id)
      ftsDelete('task', row.id)
      dropped++
    }
  })()
  return dropped
}

/**
 * Tasks made before checkboxes were the only kind have no note, and older versions left the
 * tasks of a purged note without one too. They all become one "Tasks" note with a checklist
 * in the home notebook, so nothing disappears. Safe to run on every start.
 */
export function adoptLooseTasks(): number {
  const db = getDb()
  let adopted = 0
  db.transaction(() => {
    // A task pointing at a note that no longer exists counts as loose too.
    db.prepare(`UPDATE tasks SET note_id = NULL WHERE note_id IS NOT NULL AND note_id NOT IN (SELECT id FROM notes)`).run()
    const tasks = db.prepare(`SELECT * FROM tasks WHERE note_id IS NULL ORDER BY notebook_id, id`).all() as Task[]
    if (tasks.length === 0) return
    // Notebooks are hidden, so one note in the home notebook rather than one per notebook.
    const notebookId = homeNotebookId()
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: tasks.map((t) => ({
            type: 'taskItem',
            attrs: { checked: t.status === 'done', taskId: t.id },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: t.title || 'Untitled task' }] }]
          }))
        }
      ]
    }
    const note = createNote({ notebook_id: notebookId, title: 'Tasks', content: JSON.stringify(doc) })
    const link = db.prepare(`UPDATE tasks SET note_id = ?, notebook_id = ? WHERE id = ?`)
    for (const t of tasks) link.run(note.id, notebookId, t.id)
    adopted = tasks.length
  })()
  return adopted
}

/* ------------------------ Writing back into the note ----------------------- */

type DocNode = { type?: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string }

/** Sets the checkbox linked to `taskId` in a note and saves the note, search row included. */
function checkNoteItem(noteId: number, taskId: number, checked: boolean): void {
  const note = getNote(noteId)
  if (!note) return
  let doc: DocNode
  try {
    doc = JSON.parse(note.content) as DocNode
  } catch {
    return // malformed content, skip
  }
  let changed = false
  let found = false
  const walk = (n: DocNode | null): void => {
    if (!n || typeof n !== 'object' || !Array.isArray(n.content)) return
    for (const child of n.content) {
      if (found) return
      if (child && child.type === 'taskItem' && Number(child.attrs?.taskId) === taskId && child.attrs) {
        // Only the first line with this id: a pasted copy gets its own task on the next sync.
        found = true
        if (child.attrs.checked !== checked) {
          child.attrs.checked = checked
          changed = true
        }
        return
      }
      walk(child)
    }
  }
  walk(doc)
  if (!changed) return
  const content = JSON.stringify(doc)
  getDb().prepare(`UPDATE notes SET content = ?, updated_at = ? WHERE id = ?`).run(content, now(), noteId)
  if (note.deleted_at === null) ftsUpsert('note', noteId, note.title ?? 'Untitled', tiptapToText(content))
}
