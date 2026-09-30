import { getDb } from '../db'
import { now } from './dates'
import { getNote } from './notes'
import { ftsDelete, ftsUpsert, tiptapToText } from './search'
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
       ORDER BY due_date`
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
  due_date?: string | null
  note_id?: number | null
}): Task {
  const info = getDb()
    .prepare(
      `INSERT INTO tasks (notebook_id, note_id, title, status, due_date, created_at)
       VALUES (@notebook_id, @note_id, @title, @status, @due_date, @ts)`
    )
    .run({
      notebook_id: input.notebook_id,
      note_id: input.note_id ?? null,
      title: input.title,
      status: input.status ?? 'todo',
      due_date: input.due_date ?? null,
      ts: now()
    })
  const task = getTask(Number(info.lastInsertRowid))!
  ftsUpsert('task', task.id, task.title, '')
  return task
}

export function updateTask(id: number, patch: Record<string, unknown>): Task {
  const db = getDb()
  const before = getTask(id)
  const allowed = ['title', 'status', 'due_date', 'notebook_id'] as const
  const keys = allowed.filter((k) => k in patch)
  db.transaction(() => {
    if (keys.length > 0) {
      const sets = keys.map((k) => `${k} = @${k}`).join(', ')
      db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run({ ...patch, id })
    }
    if ('status' in patch && before) {
      db.prepare(`UPDATE tasks SET completed_at = ? WHERE id = ?`).run(patch.status === 'done' ? now() : null, id)
    }
    const task = getTask(id)
    if (task && 'title' in patch) ftsUpsert('task', id, task.title, '')
    // The note owns its checklist: the next sync reads every item's title and state back from it.
    if (task && before?.note_id != null && ('title' in patch || 'status' in patch)) {
      editNoteItem(before.note_id, id, (item) => {
        let changed = false
        if ('status' in patch) changed = setChecked(item, task.status === 'done')
        if ('title' in patch) changed = setItemTitle(item, task.title) || changed
        return changed
      })
    }
  })()
  return getTask(id)!
}

export function removeTask(id: number): void {
  const db = getDb()
  const before = getTask(id)
  db.transaction(() => {
    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
    ftsDelete('task', id)
    if (before?.note_id != null) editNoteItem(before.note_id, id, () => 'remove')
  })()
}

/* ----------------------------- Note ↔ task bridge ------------------------- */

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

/* ------------------------ Writing back into the note ----------------------- */

type DocNode = { type?: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string }

/**
 * Apply `edit` to the checklist item linked to `taskId` in a note's TipTap document and
 * save the note, search row included. `edit` says whether it changed the item, or 'remove'.
 */
function editNoteItem(noteId: number, taskId: number, edit: (item: DocNode) => boolean | 'remove'): void {
  const note = getNote(noteId)
  if (!note) return
  let doc: DocNode
  try {
    doc = JSON.parse(note.content) as DocNode
  } catch {
    return // malformed content, skip
  }
  let changed = false
  const walk = (n: DocNode): void => {
    if (!Array.isArray(n.content)) return
    const next: DocNode[] = []
    let removed = false
    for (const child of n.content) {
      const result = child.type === 'taskItem' && Number(child.attrs?.taskId) === taskId ? edit(child) : false
      if (result === 'remove') {
        // Its sub-items are tasks of their own, so they move up into its place.
        for (const c of child.content ?? []) if (c.type === 'taskList') next.push(...(c.content ?? []))
        changed = removed = true
        continue
      }
      if (result) changed = true
      walk(child)
      // A taskList must hold at least one item; one left empty goes too.
      if (child.type === 'taskList' && (child.content ?? []).length === 0) {
        removed = true
        continue
      }
      next.push(child)
    }
    if (!removed) return
    // Any other block must hold something: a doc left without its only list gets a paragraph.
    n.content = next.length > 0 || n.type === 'taskList' ? next : [{ type: 'paragraph' }]
  }
  walk(doc)
  if (!changed) return
  const content = JSON.stringify(doc)
  getDb().prepare(`UPDATE notes SET content = ?, updated_at = ? WHERE id = ?`).run(content, now(), noteId)
  if (note.deleted_at === null) ftsUpsert('note', noteId, note.title ?? 'Untitled', tiptapToText(content))
}

function setChecked(item: DocNode, checked: boolean): boolean {
  if (!item.attrs || item.attrs.checked === checked) return false
  item.attrs.checked = checked
  return true
}

/**
 * Write `title` into the item so `syncNoteTasks` reads it back unchanged: the text of the
 * item's own paragraphs, nested checklists excluded. A title that already matches keeps its marks.
 */
function setItemTitle(item: DocNode, title: string): boolean {
  const textOf = (n: DocNode): string =>
    (n.text ?? '') + (n.content ?? []).filter((c) => c.type !== 'taskList' && c.type !== 'taskItem').map(textOf).join('')
  if ((textOf(item).trim() || 'Untitled task') === title) return false
  const own = item.content ?? []
  const paragraph: DocNode = { ...(own.find((c) => c.type === 'paragraph') ?? { type: 'paragraph' }) }
  if (title) paragraph.content = [{ type: 'text', text: title }]
  else delete paragraph.content
  item.content = [paragraph, ...own.filter((c) => c.type === 'taskList')]
  return true
}
