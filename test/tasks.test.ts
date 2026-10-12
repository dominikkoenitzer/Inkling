import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import type { Task } from '../src/shared/types'

let raw: DatabaseSync
let db: Database.Database

vi.mock('../src/main/db', () => ({ getDb: () => db }))

const { createNote } = await import('../src/main/repos/notes')
const { adoptLooseTasks, dropBlankTasks, openTasks, setTaskDone, syncNoteTasks } = await import('../src/main/repos/tasks')
const { searchQuery } = await import('../src/main/repos/search')

const tasksForNote = (noteId: number): Task[] => db.prepare(`SELECT * FROM tasks WHERE note_id = ? ORDER BY id`).all(noteId) as Task[]

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
    CREATE TABLE notebooks (id INTEGER PRIMARY KEY, name TEXT, color TEXT, sort_order INTEGER DEFAULT 0, created_at DATETIME);
    INSERT INTO notebooks (id, name, color) VALUES (1, 'Notes', 'teal'), (2, 'Maths', 'teal');
    CREATE TABLE flashcard_decks (id INTEGER PRIMARY KEY, notebook_id INTEGER, name TEXT, note_id INTEGER);
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

describe('ticking a task outside the editor', () => {
  it('writes the tick into the note and keeps it through the next sync', () => {
    const { noteId, ids } = linkedNote()

    setTaskDone(ids[0], true)
    syncNoteTasks(noteId, 1, itemsOf(content(noteId)))

    expect(tasksForNote(noteId).map((t) => [t.title, t.status])).toEqual([
      ['Buy agar', 'done'],
      ['Book the lab', 'todo']
    ])
    expect(JSON.parse(content(noteId)).content[0].content[0].attrs.checked).toBe(true)
  })

  it('leaves the item text and its marks alone', () => {
    const { noteId, ids } = linkedNote()
    const bold = docOf(
      list(
        { ...item(ids[0], ''), content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Buy ', marks: [{ type: 'bold' }] } as Node, { type: 'text', text: 'agar' }] }] },
        item(ids[1], 'Book the lab')
      )
    )
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(bold, noteId)

    setTaskDone(ids[0], true)

    const after = JSON.parse(content(noteId))
    expect(after.content[0].content[0].content[0].content).toEqual(JSON.parse(bold).content[0].content[0].content[0].content)
    expect(after.content[0].content[0].attrs.checked).toBe(true)
    expect(searchQuery('agar').map((r) => r.source_type)).toEqual(expect.arrayContaining(['task', 'note']))
  })
})

describe('openTasks', () => {
  it('lists open checkboxes of live notes with the note title', () => {
    const { noteId, ids } = linkedNote()
    setTaskDone(ids[1], true)

    expect(openTasks().map((t) => [t.title, t.note_title])).toEqual([['Buy agar', 'Lab']])

    raw.prepare(`UPDATE notes SET deleted_at = '2026-01-01' WHERE id = ?`).run(noteId)
    expect(openTasks()).toEqual([])
  })
})

describe('an empty checkbox line', () => {
  it('gets no task and stays off Today', () => {
    const note = createNote({ notebook_id: 1, title: 'Lab', content: docOf(list(item(null, 'Buy agar'), item(null, '  '))) })

    const ids = syncNoteTasks(note.id, 1, itemsOf(note.content))

    expect(ids[1]).toBe(0)
    expect(tasksForNote(note.id).map((t) => t.title)).toEqual(['Buy agar'])
    expect(openTasks().map((t) => t.title)).toEqual(['Buy agar'])
  })

  it('drops the row an older build made for it', () => {
    const { noteId, ids } = linkedNote()
    raw.exec(`INSERT INTO tasks (notebook_id, note_id, title, status) VALUES (1, ${noteId}, 'Untitled task', 'todo')`)
    const blank = (raw.prepare(`SELECT MAX(id) AS id FROM tasks`).get() as { id: number }).id
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(item(ids[0], 'Buy agar'), item(blank, ''), item(ids[1], 'Book the lab'))), noteId)

    expect(dropBlankTasks()).toBe(1)

    expect(openTasks().map((t) => t.title)).toEqual(['Buy agar', 'Book the lab'])
  })

  it('keeps a to-do someone named "Untitled task"', () => {
    const note = createNote({ notebook_id: 1, title: 'Lab', content: docOf(list(item(null, 'Untitled task'))) })
    syncNoteTasks(note.id, 1, itemsOf(note.content))

    expect(dropBlankTasks()).toBe(0)
    expect(openTasks().map((t) => t.title)).toEqual(['Untitled task'])
  })
})

describe('adoptLooseTasks', () => {
  it('gives tasks without a note a "Tasks" note per notebook', () => {
    raw.exec(`INSERT INTO tasks (notebook_id, note_id, title, status) VALUES (1, NULL, 'Call Anna', 'todo'), (1, NULL, 'Pay rent', 'done'), (2, NULL, 'Read', 'todo')`)

    expect(adoptLooseTasks()).toBe(3)

    const notes = raw.prepare(`SELECT id, notebook_id, title, content FROM notes ORDER BY id`).all() as Array<{ id: number; notebook_id: number; title: string; content: string }>
    expect(notes.map((n) => [n.notebook_id, n.title])).toEqual([
      [1, 'Tasks'],
      [2, 'Tasks']
    ])
    expect(itemsOf(notes[0].content).map((i) => [i.title, i.checked])).toEqual([
      ['Call Anna', false],
      ['Pay rent', true]
    ])
    // The next editor sync matches the same rows instead of making new ones.
    const ids = tasksForNote(notes[0].id).map((t) => t.id)
    expect(syncNoteTasks(notes[0].id, 1, itemsOf(notes[0].content))).toEqual(ids)
    expect(adoptLooseTasks()).toBe(0)
  })

  it('gives the tasks of a purged note and of a vanished notebook a note too', () => {
    const { noteId, ids } = linkedNote()
    // Foreign keys set note_id to NULL when a note is deleted for good, as older versions did.
    raw.prepare(`DELETE FROM notes WHERE id = ?`).run(noteId)
    raw.exec(`PRAGMA foreign_keys = OFF; INSERT INTO tasks (notebook_id, note_id, title, status) VALUES (9, NULL, 'Orphan', 'todo'); PRAGMA foreign_keys = ON;`)

    expect(adoptLooseTasks()).toBe(3)

    const kept = raw.prepare(`SELECT id, notebook_id, note_id FROM tasks ORDER BY id`).all() as Array<{ id: number; notebook_id: number; note_id: number }>
    expect(kept.map((t) => t.id).slice(0, 2)).toEqual(ids)
    expect(kept.every((t) => t.note_id !== null)).toBe(true)
    expect(kept.every((t) => t.notebook_id === 1)).toBe(true)
  })
})

describe('search with a trashed note full of to-dos', () => {
  it('still finds the live note', () => {
    const trashed = createNote({ notebook_id: 1, title: 'Old', content: docOf(list(...Array.from({ length: 25 }, (_, i) => item(null, `alpha ${i}`)))) })
    syncNoteTasks(trashed.id, 1, itemsOf(trashed.content))
    raw.prepare(`UPDATE notes SET deleted_at = '2026-01-01' WHERE id = ?`).run(trashed.id)
    raw.prepare(`DELETE FROM search_index WHERE source_type = 'note' AND source_id = ?`).run(String(trashed.id))
    const live = createNote({ notebook_id: 1, title: 'Alpha notes', content: docOf() })

    expect(searchQuery('alpha').map((r) => [r.source_type, r.note_id])).toEqual([['note', live.id]])
  })
})

describe('setTaskDone with a pasted copy of a line', () => {
  it('ticks only the first line that carries the id', () => {
    const { noteId, ids } = linkedNote()
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(item(ids[0], 'Buy agar'), item(ids[0], 'Buy agar'), item(ids[1], 'Book the lab'))), noteId)

    setTaskDone(ids[0], true)

    const checked = JSON.parse(content(noteId)).content[0].content.map((i: Node) => i.attrs?.checked)
    expect(checked).toEqual([true, false, false])
  })
})
