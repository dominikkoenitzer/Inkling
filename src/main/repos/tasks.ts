import { getDb } from '../db'
import { now } from './dates'
import { homeNotebookId } from './notebooks'
import { createNote, getNote } from './notes'
import { ftsDelete, ftsUpsert, tiptapToText } from './search'
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
      const title = item.title.trim() || 'Untitled task'
      const current = item.taskId !== null ? byId.get(item.taskId) : undefined
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
        const info = db
          .prepare(
            `INSERT INTO tasks (notebook_id, note_id, title, status, created_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(notebookId, noteId, title, item.checked ? 'done' : 'todo', now(), item.checked ? now() : null)
        const newId = Number(info.lastInsertRowid)
        ftsUpsert('task', newId, title, '')
        ids.push(newId)
      }
    }
    for (const orphan of byId.values()) {
      db.prepare(`DELETE FROM tasks WHERE id = ?`).run(orphan.id)
      ftsDelete('task', orphan.id)
    }
  })
  tx()
  return ids
}

/**
 * Tasks made before checkboxes were the only kind have no note, and older versions left the
 * tasks of a purged note without one too. Each notebook's loose tasks become one "Tasks" note
 * with a checklist, so nothing disappears. Safe to run on every start.
 */
export function adoptLooseTasks(): number {
  const db = getDb()
  let adopted = 0
  db.transaction(() => {
    const loose = db.prepare(`SELECT * FROM tasks WHERE note_id IS NULL ORDER BY notebook_id, id`).all() as Task[]
    if (loose.length === 0) return
    const notebooks = new Set((db.prepare(`SELECT id FROM notebooks`).all() as Array<{ id: number }>).map((n) => n.id))
    const byNotebook = new Map<number, Task[]>()
    for (const t of loose) {
      // A task whose notebook is gone goes to the home notebook rather than nowhere.
      const nb = notebooks.has(t.notebook_id) ? t.notebook_id : homeNotebookId()
      const list = byNotebook.get(nb)
      if (list) list.push(t)
      else byNotebook.set(nb, [t])
    }
    const link = db.prepare(`UPDATE tasks SET note_id = ?, notebook_id = ? WHERE id = ?`)
    for (const [notebookId, tasks] of byNotebook) {
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
      for (const t of tasks) link.run(note.id, notebookId, t.id)
      adopted += tasks.length
    }
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
