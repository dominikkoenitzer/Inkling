import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'

let raw: DatabaseSync
let db: Database.Database

vi.mock('../src/main/db', () => ({ getDb: () => db }))

const { createNote } = await import('../src/main/repos/notes')
const { removeTask, syncNoteTasks, tasksForNote, updateTask } = await import('../src/main/repos/tasks')
const { searchQuery } = await import('../src/main/repos/search')

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string }

const item = (taskId: number | null, text: string, ...children: Node[]): Node => ({
  type: 'taskItem',
  attrs: { checked: false, taskId },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...children]
})
const list = (...items: Node[]): Node => ({ type: 'taskList', content: items })
const docOf = (...blocks: Node[]): string => JSON.stringify({ type: 'doc', content: blocks })

/** What the editor sends on its next save: every checklist item, in document order. */
const itemsOf = (content: string): Array<{ taskId: number | null; checked: boolean; title: string }> => {
  const out: Array<{ taskId: number | null; checked: boolean; title: string }> = []
  const text = (n: Node): string =>
    (n.text ?? '') + (n.content ?? []).filter((c) => c.type !== 'taskList' && c.type !== 'taskItem').map(text).join('')
  const walk = (n: Node): void => {
    if (n.type === 'taskItem') out.push({ taskId: (n.attrs?.taskId as number) ?? null, checked: !!n.attrs?.checked, title: text(n) })
    n.content?.forEach(walk)
  }
  walk(JSON.parse(content))
  return out
}

const content = (noteId: number): string =>
  (raw.prepare(`SELECT content FROM notes WHERE id = ?`).get(noteId) as { content: string }).content

/** A note with two linked checklist items, as the editor leaves it after its first sync. */
function linkedNote(): { noteId: number; ids: number[] } {
  const note = createNote({ notebook_id: 1, title: 'Lab', content: docOf(list(item(null, 'Buy agar'), item(null, 'Book the lab'))) })
  const ids = syncNoteTasks(note.id, 1, itemsOf(note.content))
  raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(item(ids[0], 'Buy agar'), item(ids[1], 'Book the lab'))), note.id)
  return { noteId: note.id, ids }
}

beforeEach(() => {
  ;({ raw, db } = openSqlite())
  raw.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, notebook_id INTEGER, title TEXT, content TEXT NOT NULL,
      created_at DATETIME, updated_at DATETIME, deleted_at DATETIME
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY, notebook_id INTEGER, note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
      title TEXT NOT NULL, status TEXT CHECK(status IN ('todo','done')) DEFAULT 'todo',
      due_date DATETIME, created_at DATETIME, completed_at DATETIME
    );
    CREATE VIRTUAL TABLE search_index USING fts5(title, content_text, source_type UNINDEXED, source_id UNINDEXED);
  `)
})

describe('a note-linked task edited in Tasks', () => {
  it('keeps its new title through the next note sync', () => {
    const { noteId, ids } = linkedNote()

    updateTask(ids[0], { title: 'Buy nutrient agar' })
    syncNoteTasks(noteId, 1, itemsOf(content(noteId)))

    expect(tasksForNote(noteId).map((t) => t.title)).toEqual(['Buy nutrient agar', 'Book the lab'])
    expect(searchQuery('nutrient').map((r) => [r.source_type, r.source_id])).toEqual(
      expect.arrayContaining([
        ['task', ids[0]],
        ['note', noteId]
      ])
    )
  })

  it('stays deleted through the next note sync', () => {
    const { noteId, ids } = linkedNote()

    removeTask(ids[0])
    syncNoteTasks(noteId, 1, itemsOf(content(noteId)))

    expect(tasksForNote(noteId).map((t) => t.title)).toEqual(['Book the lab'])
    expect(JSON.parse(content(noteId))).toEqual({ type: 'doc', content: [list(item(ids[1], 'Book the lab'))] })
    expect(searchQuery('agar')).toEqual([])
  })

  it('leaves a valid document when the last item of the only list goes', () => {
    const note = createNote({ notebook_id: 1, title: 'Lab', content: docOf(list(item(null, 'Buy agar'))) })
    const [id] = syncNoteTasks(note.id, 1, itemsOf(note.content))
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(item(id, 'Buy agar'))), note.id)

    removeTask(id)

    expect(JSON.parse(content(note.id))).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(tasksForNote(note.id)).toEqual([])
  })

  it('keeps the sub-items of a deleted item as tasks of their own', () => {
    const note = createNote({ notebook_id: 1, title: 'Lab', content: docOf(list(item(null, 'Prepare', list(item(null, 'Buy agar'))))) })
    const [parent, child] = syncNoteTasks(note.id, 1, itemsOf(note.content))
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(item(parent, 'Prepare', list(item(child, 'Buy agar'))))), note.id)

    removeTask(parent)
    syncNoteTasks(note.id, 1, itemsOf(content(note.id)))

    expect(JSON.parse(content(note.id))).toEqual({ type: 'doc', content: [list(item(child, 'Buy agar'))] })
    expect(tasksForNote(note.id).map((t) => t.id)).toEqual([child])
  })

  it('does not rewrite the item when only the status changes', () => {
    const { noteId, ids } = linkedNote()
    const bold = docOf(
      list(
        { ...item(ids[0], ''), content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Buy ', marks: [{ type: 'bold' }] } as Node, { type: 'text', text: 'agar' }] }] },
        item(ids[1], 'Book the lab')
      )
    )
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(bold, noteId)

    updateTask(ids[0], { title: 'Buy agar', status: 'done' })

    const after = JSON.parse(content(noteId))
    expect(after.content[0].content[0].content[0].content).toEqual(JSON.parse(bold).content[0].content[0].content[0].content)
    expect(after.content[0].content[0].attrs.checked).toBe(true)
  })
})
