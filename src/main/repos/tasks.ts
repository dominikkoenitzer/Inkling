import { getDb } from '../db'
import { now } from './dates'
import { getNote } from './notes'
import { ftsDelete, ftsUpsert } from './search'
import type { NoteTaskItem, Task } from '@shared/types'

export function listTasks(notebookId: number): Task[] {
  return getDb()
    .prepare(
      `SELECT * FROM tasks WHERE notebook_id = ?
       ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, due_date IS NULL, due_date, id DESC`
    )
    .all(notebookId) as Task[]
}

export function smartTasks(view: 'today' | 'week'): Task[] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + (view === 'today' ? 1 : 7))
  return getDb()
    .prepare(
      `SELECT * FROM tasks WHERE status != 'done' AND due_date IS NOT NULL AND due_date < ?
       ORDER BY due_date, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`
    )
    .all(end.toISOString()) as Task[]
}

export function tasksForNote(noteId: number): Task[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE note_id = ? ORDER BY id`).all(noteId) as Task[]
}

export function getTask(id: number): Task | null {
  return (getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined) ?? null
}

export function createTask(input: {
  notebook_id: number
  title: string
  status?: string
  priority?: string
  due_date?: string | null
  parent_task_id?: number | null
  note_id?: number | null
}): Task {
  const info = getDb()
    .prepare(
      `INSERT INTO tasks (notebook_id, note_id, title, status, priority, due_date, parent_task_id, created_at)
       VALUES (@notebook_id, @note_id, @title, @status, @priority, @due_date, @parent_task_id, @ts)`
    )
    .run({
      notebook_id: input.notebook_id,
      note_id: input.note_id ?? null,
      title: input.title,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      due_date: input.due_date ?? null,
      parent_task_id: input.parent_task_id ?? null,
      ts: now()
    })
  const task = getTask(Number(info.lastInsertRowid))!
  ftsUpsert('task', task.id, task.title, '')
  return task
}

export function updateTask(id: number, patch: Record<string, unknown>): Task {
  const before = getTask(id)
  const allowed = ['title', 'status', 'priority', 'due_date', 'notebook_id', 'parent_task_id'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run({ ...patch, id })
  }
  if ('status' in patch && before) {
    const done = patch.status === 'done'
    getDb().prepare(`UPDATE tasks SET completed_at = ? WHERE id = ?`).run(done ? now() : null, id)
    if (before.note_id !== null) updateNoteCheckbox(before.note_id, id, done)
  }
  const task = getTask(id)!
  if ('title' in patch) ftsUpsert('task', id, task.title, '')
  return task
}

export function removeTask(id: number): void {
  const subs = getDb().prepare(`SELECT id FROM tasks WHERE parent_task_id = ?`).all(id) as Array<{ id: number }>
  getDb().prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
  ftsDelete('task', id)
  for (const s of subs) ftsDelete('task', s.id)
}

/* ----------------------------- Note ↔ task bridge ------------------------- */

/**
 * Bidirectional note↔task linking: given the checklist items currently present in a
 * note's content, create/update matching task rows and prune tasks whose checkbox
 * was deleted from the note. Returns task ids in the same order as `items`.
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
        let status = current.status
        if (item.checked && status !== 'done') status = 'done'
        if (!item.checked && status === 'done') status = 'todo'
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
            `INSERT INTO tasks (notebook_id, note_id, title, status, priority, created_at, completed_at)
             VALUES (?, ?, ?, ?, 'medium', ?, ?)`
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

/** Reflect a task status change back into its source note's checkbox (if linked). */
function updateNoteCheckbox(noteId: number, taskId: number, checked: boolean): void {
  const note = getNote(noteId)
  if (!note) return
  try {
    const doc = JSON.parse(note.content)
    let changed = false
    const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): void => {
      if (n.type === 'taskItem' && n.attrs && Number(n.attrs.taskId) === taskId) {
        if (n.attrs.checked !== checked) {
          n.attrs.checked = checked
          changed = true
        }
      }
      if (Array.isArray(n.content)) n.content.forEach((c) => walk(c as never))
    }
    walk(doc)
    if (changed) {
      getDb().prepare(`UPDATE notes SET content = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(doc), now(), noteId)
    }
  } catch {
    /* malformed content — skip */
  }
}
