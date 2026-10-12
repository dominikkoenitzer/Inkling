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

describe('a dated to-do that moves', () => {
  const DUE = '2026-11-02T09:00:00.000Z'
  /** Note A with a dated to-do and note B, both live. */
  function dated(): { a: number; b: number; id: number } {
    const { noteId, ids } = linkedNote()
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run(DUE, ids[0])
    const b = createNote({ notebook_id: 1, title: 'Shop', content: docOf() })
    return { a: noteId, b: b.id, id: ids[0] }
  }
  const row = (id: number): Task => raw.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as Task

  it('takes its row along when the other note no longer has the line', () => {
    const { a, b, id } = dated()
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(item(tasksForNote(a)[1].id, 'Book the lab'))), a)

    expect(syncNoteTasks(b, 1, [{ taskId: id, title: 'Buy agar', checked: false }])).toEqual([id])

    expect(row(id)).toMatchObject({ note_id: b, due_date: DUE })
  })

  it('keeps the date when it is cut from one note and pasted into another', () => {
    const { a, b, id } = dated()
    const [, other] = tasksForNote(a)
    syncNoteTasks(a, 1, [{ taskId: other.id, title: 'Book the lab', checked: false }])

    const [moved] = syncNoteTasks(b, 1, [{ taskId: id, title: 'Buy agar', checked: false }])

    expect(row(moved)).toMatchObject({ note_id: b, title: 'Buy agar', due_date: DUE })
    expect(openTasks().map((t) => [t.title, t.due_date])).toEqual([
      ['Buy agar', DUE],
      ['Book the lab', null]
    ])
  })

  it('keeps the date when a deleted line comes back with undo', () => {
    const { a, id } = dated()
    const [, other] = tasksForNote(a)
    syncNoteTasks(a, 1, [{ taskId: other.id, title: 'Book the lab', checked: false }])

    const ids = syncNoteTasks(a, 1, [
      { taskId: id, title: 'Buy agar', checked: false },
      { taskId: other.id, title: 'Book the lab', checked: false }
    ])

    expect(ids).toEqual([id, other.id])
    expect(row(id)).toMatchObject({ note_id: a, due_date: DUE })
  })

  it('gives a pasted copy its own row and leaves the original where it is', () => {
    const { a, b, id } = dated()

    const [copy] = syncNoteTasks(b, 1, [{ taskId: id, title: 'Buy agar', checked: false }])

    expect(copy).not.toBe(id)
    expect(row(id)).toMatchObject({ note_id: a, due_date: DUE })
    expect(row(copy)).toMatchObject({ note_id: b, due_date: DUE })
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
  it('gives tasks without a note one "Tasks" note in the home notebook', () => {
    raw.exec(`INSERT INTO tasks (notebook_id, note_id, title, status) VALUES (1, NULL, 'Call Anna', 'todo'), (1, NULL, 'Pay rent', 'done'), (2, NULL, 'Read', 'todo')`)

    expect(adoptLooseTasks()).toBe(3)

    const notes = raw.prepare(`SELECT id, notebook_id, title, content FROM notes ORDER BY id`).all() as Array<{ id: number; notebook_id: number; title: string; content: string }>
    expect(notes.map((n) => [n.notebook_id, n.title])).toEqual([[1, 'Tasks']])
    expect(itemsOf(notes[0].content).map((i) => [i.title, i.checked])).toEqual([
      ['Call Anna', false],
      ['Pay rent', true],
      ['Read', false]
    ])
    expect(tasksForNote(notes[0].id).every((t) => t.notebook_id === 1)).toBe(true)
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

describe('an emptied line and a to-do made after it', () => {
  const DUE = '2026-11-02T09:00:00.000Z'
  type Item = { taskId: number | null; title: string; checked: boolean }
  const line = (taskId: number | null, title: string): Item => ({ taskId, title, checked: false })
  /** Syncs and stamps the ids back the way the editor does: 0 leaves the old id on the line. */
  const sync = (noteId: number, items: Item[]): Item[] => {
    const ids = syncNoteTasks(noteId, 1, items)
    return items.map((it, i) => ({ ...it, taskId: ids[i] > 0 ? ids[i] : it.taskId }))
  }
  const row = (id: number): Task => raw.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as Task
  const store = (noteId: number, items: Item[]): void => {
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(...items.map((i) => item(i.taskId, i.title)))), noteId)
  }

  it('keeps the row of an emptied line, out of Today and search', () => {
    const { noteId, ids } = linkedNote()

    sync(noteId, [line(ids[0], 'Buy agar'), line(ids[1], '')])

    expect(tasksForNote(noteId).map((t) => [t.id, t.title])).toEqual([
      [ids[0], 'Buy agar'],
      [ids[1], '']
    ])
    expect(openTasks().map((t) => t.title)).toEqual(['Buy agar'])
    expect(searchQuery('lab').filter((r) => r.source_type === 'task')).toEqual([])
  })

  it('does not hand its row to a new to-do in the same note', () => {
    const { noteId, ids } = linkedNote()
    let items = sync(noteId, [line(ids[0], 'Buy agar'), line(ids[1], '')])
    items = sync(noteId, [...items, line(null, 'Call Anna')])
    const anna = items[2].taskId!
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run(DUE, anna)

    items = sync(noteId, [line(ids[0], 'Buy agar'), line(items[1].taskId, 'Book the lab'), line(anna, 'Call Anna')])

    expect(items[2].taskId).toBe(anna)
    expect(items[1].taskId).not.toBe(anna)
    expect(row(anna)).toMatchObject({ title: 'Call Anna', due_date: DUE })
    expect(openTasks().map((t) => t.title)).toEqual(['Call Anna', 'Buy agar', 'Book the lab'])
  })

  /** Note A with two to-dos, note B whose only to-do was emptied, then a dated new to-do in A. */
  function emptiedInB(stampA: boolean): { a: number; b: number; rent: number } {
    const { noteId: a, ids } = linkedNote()
    const b = createNote({ notebook_id: 1, title: 'Shop', content: docOf() }).id
    let inB = sync(b, [line(null, 'Call Anna')])
    inB = sync(b, [line(inB[0].taskId, '')])
    store(b, inB)
    const inA = sync(a, [line(ids[0], 'Buy agar'), line(ids[1], 'Book the lab'), line(null, 'Pay rent')])
    if (stampA) store(a, inA)
    const rent = inA[2].taskId!
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run(DUE, rent)
    syncNoteTasks(b, 1, [line(inB[0].taskId, 'Call Anna')])
    return { a, b, rent }
  }

  it("does not copy another note's to-do when text is typed back", () => {
    const { a, b, rent } = emptiedInB(true)

    expect(row(rent)).toMatchObject({ note_id: a, title: 'Pay rent', due_date: DUE })
    expect(tasksForNote(b).map((t) => [t.title, t.due_date])).toEqual([['Call Anna', null]])
  })

  it("does not move another note's to-do when text is typed back", () => {
    const { a, b, rent } = emptiedInB(false)

    expect(row(rent)).toMatchObject({ note_id: a, title: 'Pay rent', due_date: DUE })
    expect(tasksForNote(b).map((t) => [t.title, t.due_date])).toEqual([['Call Anna', null]])
  })
})

describe('a deleted line whose id went to another to-do', () => {
  const DUE = '2026-11-02T09:00:00.000Z'
  const row = (id: number): Task => raw.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as Task

  /** Note B loses its only line, then note A gets a dated new to-do under the freed id. */
  function reused(stampA: boolean): { a: number; b: number; gone: number; plants: number } {
    const { noteId: a, ids } = linkedNote()
    const b = createNote({ notebook_id: 1, title: 'Shop', content: docOf() }).id
    const [gone] = syncNoteTasks(b, 1, [{ taskId: null, title: 'Phone the vet', checked: false }])
    syncNoteTasks(b, 1, [])
    const [, , plants] = syncNoteTasks(a, 1, [
      { taskId: ids[0], title: 'Buy agar', checked: false },
      { taskId: ids[1], title: 'Book the lab', checked: false },
      { taskId: null, title: 'Water the plants', checked: false }
    ])
    expect(plants).toBe(gone)
    const lines = list(item(ids[0], 'Buy agar'), item(ids[1], 'Book the lab'), item(plants, 'Water the plants'))
    if (stampA) raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(lines), a)
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run(DUE, plants)
    return { a, b, gone, plants }
  }

  it('gets a fresh row when it comes back, not a copy of the other one', () => {
    const { a, b, gone, plants } = reused(true)

    syncNoteTasks(b, 1, [{ taskId: gone, title: 'Phone the vet', checked: false }])

    expect(row(plants)).toMatchObject({ note_id: a, title: 'Water the plants', due_date: DUE })
    expect(tasksForNote(b).map((t) => [t.title, t.due_date])).toEqual([['Phone the vet', null]])
  })

  it('does not take the other row over when that note has not saved yet', () => {
    const { a, b, gone, plants } = reused(false)

    syncNoteTasks(b, 1, [{ taskId: gone, title: 'Phone the vet', checked: false }])

    expect(row(plants)).toMatchObject({ note_id: a, title: 'Water the plants', due_date: DUE })
    expect(tasksForNote(b).map((t) => [t.title, t.due_date])).toEqual([['Phone the vet', null]])
  })

  it('does not bring back the row of a different line deleted later', () => {
    const { noteId: a, ids } = linkedNote()
    const b = createNote({ notebook_id: 1, title: 'Shop', content: docOf() }).id
    syncNoteTasks(a, 1, [{ taskId: ids[0], title: 'Buy agar', checked: false }])
    const [other] = syncNoteTasks(b, 1, [{ taskId: null, title: 'Feed the cat', checked: false }])
    expect(other).toBe(ids[1])
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run(DUE, other)
    syncNoteTasks(b, 1, [])

    const [, back] = syncNoteTasks(a, 1, [
      { taskId: ids[0], title: 'Buy agar', checked: false },
      { taskId: ids[1], title: 'Book the lab', checked: false }
    ])

    expect(row(back)).toMatchObject({ note_id: a, title: 'Book the lab', due_date: null })
  })
})

describe('an empty line an older build made a row for', () => {
  it('keeps its row, so a new to-do elsewhere cannot get its id', () => {
    const { noteId, ids } = linkedNote()
    raw.exec(`INSERT INTO tasks (notebook_id, note_id, title, status) VALUES (1, ${noteId}, 'Untitled task', 'todo')`)
    const blank = (raw.prepare(`SELECT MAX(id) AS id FROM tasks`).get() as { id: number }).id
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(docOf(list(item(ids[0], 'Buy agar'), item(blank, ''), item(ids[1], 'Book the lab'))), noteId)
    expect(dropBlankTasks()).toBe(1)
    const b = createNote({ notebook_id: 1, title: 'Shop', content: docOf() }).id
    const [anna] = syncNoteTasks(b, 1, [{ taskId: null, title: 'Call Anna', checked: false }])

    const back = syncNoteTasks(noteId, 1, [
      { taskId: ids[0], title: 'Buy agar', checked: false },
      { taskId: blank, title: 'Order gloves', checked: false },
      { taskId: ids[1], title: 'Book the lab', checked: false }
    ])

    expect(back[1]).not.toBe(anna)
    expect(tasksForNote(b).map((t) => [t.id, t.title])).toEqual([[anna, 'Call Anna']])
    expect(tasksForNote(noteId).map((t) => t.title).sort()).toEqual(['Book the lab', 'Buy agar', 'Order gloves'])
  })
})
