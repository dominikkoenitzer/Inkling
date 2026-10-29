import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import { extractNoteTaskItems } from '../src/shared/noteTasks'
import { mergeDocs, mergeTitle, type DocJson } from '../src/renderer/src/lib/mergeDoc'
import type { Card, Task } from '../src/shared/types'

let raw: DatabaseSync
let db: Database.Database

vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }))

const { migrate } = await import('../src/main/db')
const repos = await import('../src/main/repos')
const tools = await import('../src/main/mcp/tools')
// The MCP server as its own process: its own modules over the same database.
vi.resetModules()
const otherProcess = await import('../src/main/mcp/tools')

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string }

beforeEach(() => {
  ;({ raw, db } = openSqlite())
  migrate(db) // the real schema, as a fresh install gets it
  tools.forgetEdits()
})

const stored = (noteId: number): Node =>
  JSON.parse((raw.prepare(`SELECT content FROM notes WHERE id = ?`).get(noteId) as { content: string }).content)

const taskItems = (doc: Node): Node[] => {
  const out: Node[] = []
  const walk = (n: Node): void => {
    if (n.type === 'taskItem') out.push(n)
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

const tasksOf = (noteId: number): Task[] => raw.prepare(`SELECT * FROM tasks WHERE note_id = ? ORDER BY id`).all(noteId) as unknown as Task[]
const count = (sql: string, ...args: Array<string | number>): number => (raw.prepare(sql).get(...args) as { n: number }).n

// The editor's save of changed to-dos, as PageEditor makes it: a refused save is merged with the
// stored note and sent again. Returns how many tries it took.
const editorSaves = (noteId: number, base: string, doc: Node, maxTries = 3, title = repos.getNote(noteId)!.title, baseTitle = title): number => {
  let json = doc as DocJson
  for (let tries = 1; ; tries++) {
    const items = extractNoteTaskItems(json as never)
    const result = repos.saveNoteWithTasks(noteId, repos.homeNotebookId(), { title, content: JSON.stringify(json) }, items, { title: baseTitle, content: base })
    if (!result || result.ids || tries === maxTries) return tries
    json = mergeDocs(JSON.parse(base), json, JSON.parse(result.note.content))
    title = mergeTitle(baseTitle, title, result.note.title)
    base = result.note.content
    baseTitle = result.note.title
  }
}

// The editor's save when its to-dos did not change, as PageEditor makes it.
const editorUpdates = (noteId: number, base: string, doc: Node, title: string | null, baseTitle = title, maxTries = 3): number => {
  let json = doc as DocJson
  for (let tries = 1; ; tries++) {
    const content = JSON.stringify(json)
    const saved = repos.updateNote(noteId, { title, content }, { title: baseTitle, content: base })
    if (!saved || (saved.content === content && saved.title === title) || tries === maxTries) return tries
    json = mergeDocs(JSON.parse(base), json, JSON.parse(saved.content))
    title = mergeTitle(baseTitle, title, saved.title)
    base = saved.content
    baseTitle = saved.title
  }
}

describe('search', () => {
  it('finds notes, to-dos and decks, with plain snippets', () => {
    const note = tools.createNote({ title: 'Lab plan', markdown: 'Order agar plates for the microscope room\n- [ ] Book the microscope' })
    const deck = tools.addFlashcards({ deckName: 'Microbiology', cards: [{ front: 'Agar', back: 'A jelly' }] })

    const hits = tools.search({ query: 'microscope' }).results
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'note', id: note.id, noteId: note.id }),
        expect.objectContaining({ type: 'todo', title: 'Book the microscope', noteId: note.id })
      ])
    )
    for (const h of hits) expect(h.snippet).not.toMatch(/[⟪⟫]/)
    expect(hits.find((h) => h.type === 'note')!.snippet).toContain('microscope')

    expect(tools.search({ query: 'microbiology' }).results).toEqual([
      expect.objectContaining({ type: 'deck', id: deck.deckId, title: 'Microbiology', noteId: null })
    ])
  })

  it('keeps to the limit', () => {
    for (let i = 1; i <= 5; i++) tools.createNote({ title: `Alpha ${i}` })
    expect(tools.search({ query: 'alpha' }).results).toHaveLength(5)
    expect(tools.search({ query: 'alpha', limit: 2 }).results).toHaveLength(2)
  })
})

describe('listNotes', () => {
  it('lists live notes newest first, untitled ones as Untitled', () => {
    const a = tools.createNote({ title: 'Old' })
    const b = tools.createNote({ title: 'New' })
    const c = repos.createNote({ notebook_id: repos.homeNotebookId(), title: null })
    const gone = tools.createNote({ title: 'Trashed' })
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-01-01T00:00:00.000Z', a.id)
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-03-01T00:00:00.000Z', b.id)
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-02-01T00:00:00.000Z', c.id)
    repos.removeNote(gone.id)

    const { notes } = tools.listNotes({})
    expect(notes.map((n) => n.title)).toEqual(['New', 'Untitled', 'Old'])
    expect(notes[0]).toEqual({ id: b.id, title: 'New', updatedAt: '2026-03-01T00:00:00.000Z' })
    expect(tools.listNotes({ limit: 2 }).notes.map((n) => n.id)).toEqual([b.id, c.id])
  })
})

describe('readNote', () => {
  it('gives the note as Markdown with its title and last change', () => {
    const note = tools.createNote({ title: 'Plan', markdown: '## Steps\n\nBuy **agar**\n\n- [ ] Book it\n- [x] Read' })
    const read = tools.readNote({ id: note.id })
    expect(read).toMatchObject({ id: note.id, title: 'Plan', updatedAt: note.updatedAt })
    expect(read.markdown).toContain('## Steps')
    expect(read.markdown).toContain('Buy **agar**')
    expect(read.markdown).toContain('- [ ] Book it\n- [x] Read')
  })

  it('refuses a missing or trashed note', () => {
    expect(() => tools.readNote({ id: 999 })).toThrow(/no note with id 999/)
    const note = tools.createNote({ title: 'Gone' })
    repos.removeNote(note.id)
    expect(() => tools.readNote({ id: note.id })).toThrow(/no note with id/)
  })
})

describe('createNote', () => {
  it('turns checkbox lines into to-dos and stamps their ids the way the editor does', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro\n- [ ] Buy agar\n- [x] Book the lab' })
    expect(note.todosCreated).toBe(2)

    const rows = tasksOf(note.id)
    expect(rows.map((t) => [t.title, t.status])).toEqual([
      ['Buy agar', 'todo'],
      ['Book the lab', 'done']
    ])
    expect(rows[1].completed_at).toBeTruthy()
    const doc = stored(note.id)
    expect(taskItems(doc).map((n) => [n.attrs?.taskId, n.attrs?.checked])).toEqual([
      [rows[0].id, false],
      [rows[1].id, true]
    ])

    // The editor's next save sends the same items and must change nothing.
    const notebook = (raw.prepare(`SELECT notebook_id FROM notes WHERE id = ?`).get(note.id) as { notebook_id: number }).notebook_id
    expect(repos.syncNoteTasks(note.id, notebook, extractNoteTaskItems(doc as never))).toEqual(rows.map((t) => t.id))
    expect(tasksOf(note.id)).toHaveLength(2)
  })

  it('stores the note in the home notebook with a search row and its to-dos on Today', () => {
    const note = tools.createNote({ title: 'Errands', markdown: '- [ ] Call the vet' })
    const row = raw.prepare(`SELECT notebook_id, title FROM notes WHERE id = ?`).get(note.id) as { notebook_id: number; title: string }
    expect(row).toEqual({ notebook_id: repos.homeNotebookId(), title: 'Errands' })
    expect(count(`SELECT COUNT(*) AS n FROM search_index WHERE source_type = 'note' AND source_id = ?`, String(note.id))).toBe(1)
    expect(repos.openTasks().map((t) => [t.title, t.note_title])).toEqual([['Call the vet', 'Errands']])
  })

  it('makes no to-do from an empty checkbox line', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] \n- [ ] Buy agar' })
    expect(note.todosCreated).toBe(1)
    expect(tasksOf(note.id).map((t) => t.title)).toEqual(['Buy agar'])
  })

  it('makes an empty note without Markdown', () => {
    const note = tools.createNote({ title: 'Blank' })
    expect(note.todosCreated).toBe(0)
    expect(tools.readNote({ id: note.id }).markdown).toBe('')
  })

  it('needs a title', () => {
    expect(() => tools.createNote({ title: '   ', markdown: 'x' })).toThrow(/needs a title/)
    expect(count(`SELECT COUNT(*) AS n FROM notes`)).toBe(0)
  })

  it('leaves nothing behind when a to-do cannot be written', () => {
    raw.exec(`CREATE TRIGGER no_boom BEFORE INSERT ON tasks WHEN NEW.title = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    expect(() => tools.createNote({ title: 'Half', markdown: '- [ ] fine\n- [ ] boom' })).toThrow(/boom/)
    expect(count(`SELECT COUNT(*) AS n FROM notes`)).toBe(0)
    expect(count(`SELECT COUNT(*) AS n FROM tasks`)).toBe(0)
    expect(count(`SELECT COUNT(*) AS n FROM search_index`)).toBe(0)
  })
})

describe('appendToNote', () => {
  it('adds to the end and keeps what was there, old to-dos included', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line\n- [ ] Old task' })
    const [old] = tasksOf(note.id)
    tools.setTodoDone({ id: old.id }, true)

    const res = tools.appendToNote({ id: note.id, markdown: 'More text\n- [ ] New task' })
    expect(res.todosCreated).toBe(1)

    const rows = tasksOf(note.id)
    expect(rows.map((t) => [t.id, t.title, t.status])).toEqual([
      [old.id, 'Old task', 'done'],
      [rows[1].id, 'New task', 'todo']
    ])
    expect(taskItems(stored(note.id)).map((n) => [n.attrs?.taskId, n.attrs?.checked])).toEqual([
      [old.id, true],
      [rows[1].id, false]
    ])
    const md = tools.readNote({ id: note.id }).markdown
    expect(md.startsWith('Intro line')).toBe(true)
    expect(md.trimEnd().endsWith('- [ ] New task')).toBe(true)
    expect(tools.search({ query: 'more' }).results.some((h) => h.type === 'note' && h.id === note.id)).toBe(true)
  })

  it('drops empty lines at the end of the note before adding', () => {
    const empty = { type: 'paragraph' }
    const note = repos.createNote({
      notebook_id: repos.homeNotebookId(),
      title: 'Gaps',
      content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }, empty, empty] })
    })
    tools.appendToNote({ id: note.id, markdown: 'World' })
    expect(stored(note.id).content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'World' }] }
    ])
  })

  it('refuses empty Markdown and missing or trashed notes', () => {
    const note = tools.createNote({ title: 'Keep', markdown: 'Body' })
    expect(() => tools.appendToNote({ id: note.id, markdown: '  \n ' })).toThrow(/nothing to append/)
    expect(() => tools.appendToNote({ id: 4242, markdown: 'x' })).toThrow(/no note with id 4242/)
    repos.removeNote(note.id)
    expect(() => tools.appendToNote({ id: note.id, markdown: 'x' })).toThrow(/no note with id/)
    expect(JSON.stringify(stored(note.id))).not.toContain('"x"')
  })
})

describe('listOpenTodos', () => {
  it('lists open to-dos of live notes with their note', () => {
    const a = tools.createNote({ title: 'Lab', markdown: '- [ ] Buy agar\n- [x] Done already' })
    const untitled = repos.createNote({ notebook_id: repos.homeNotebookId(), title: null })
    tools.appendToNote({ id: untitled.id, markdown: '- [ ] Loose end' })
    const gone = tools.createNote({ title: 'Gone', markdown: '- [ ] Hidden' })
    repos.removeNote(gone.id)

    const { todos } = tools.listOpenTodos({})
    expect(todos.map((t) => [t.text, t.noteId, t.noteTitle]).sort()).toEqual([
      ['Buy agar', a.id, 'Lab'],
      ['Loose end', untitled.id, 'Untitled']
    ])
    expect(todos[0]).toEqual({
      id: expect.any(Number),
      text: expect.any(String),
      noteId: expect.any(Number),
      noteTitle: expect.any(String),
      due: null,
      overdue: false
    })
    expect(tools.listOpenTodos({ limit: 1 }).todos).toHaveLength(1)
  })
})

describe('setTodoDone', () => {
  it('ticks and reopens a to-do, and the checkbox in the note follows', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] Buy agar' })
    const [task] = tasksOf(note.id)

    expect(tools.setTodoDone({ id: task.id }, true)).toEqual({ id: task.id, text: 'Buy agar', done: true, noteId: note.id })
    expect(taskItems(stored(note.id))[0].attrs?.checked).toBe(true)
    expect(tools.listOpenTodos({}).todos).toEqual([])
    expect(tools.readNote({ id: note.id }).markdown).toContain('- [x] Buy agar')

    expect(tools.setTodoDone({ id: task.id }, false)).toEqual({ id: task.id, text: 'Buy agar', done: false, noteId: note.id })
    expect(taskItems(stored(note.id))[0].attrs?.checked).toBe(false)
    expect(tools.listOpenTodos({}).todos.map((t) => t.id)).toEqual([task.id])
  })

  it('refuses an unknown to-do and one in a trashed note', () => {
    expect(() => tools.setTodoDone({ id: 4242 }, true)).toThrow(/no to-do with id 4242/)
    const note = tools.createNote({ title: 'Gone', markdown: '- [ ] Hidden' })
    const [task] = tasksOf(note.id)
    repos.removeNote(note.id)
    expect(() => tools.setTodoDone({ id: task.id }, true)).toThrow(/no to-do with id/)
    expect(tasksOf(note.id)[0].status).toBe('todo')
  })
})

describe('an editor save started from an older version of the note', () => {
  const typed = (base: string): Node => {
    const doc = JSON.parse(base) as Node
    doc.content!.push({ type: 'paragraph', content: [{ type: 'text', text: 'Typed here' }] })
    return doc
  }

  it('leaves the text and to-dos the assistant appended', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line\n- [ ] Old task' })
    const base = repos.getNote(note.id)!.content
    tools.appendToNote({ id: note.id, markdown: '- [ ] Call back' })

    editorSaves(note.id, base, typed(base), 1)

    expect(tools.readNote({ id: note.id }).markdown).toContain('- [ ] Call back')
    expect(tasksOf(note.id).map((t) => t.title)).toEqual(['Old task', 'Call back'])
  })

  it('leaves a to-do the assistant ticked done in the note and on Today', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] Book the room' })
    const base = repos.getNote(note.id)!.content
    const [task] = tasksOf(note.id)
    tools.setTodoDone({ id: task.id }, true)

    editorSaves(note.id, base, typed(base), 1)

    expect(taskItems(stored(note.id))[0].attrs?.checked).toBe(true)
    expect(tasksOf(note.id)[0].status).toBe('done')
  })

  it('writes nothing and gives the stored note back', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    tools.appendToNote({ id: note.id, markdown: 'More' })
    const now = repos.getNote(note.id)!

    expect(repos.updateNote(note.id, { title: 'Renamed', content: JSON.stringify(typed(base)) }, { title: 'Lab', content: base })).toEqual(now)
    expect(repos.getNote(note.id)).toEqual(now)
  })

  it('saves over the content it started from, and over its own content with the title', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    const content = JSON.stringify(typed(base))
    expect(repos.updateNote(note.id, { content }, { title: 'Lab', content: base })?.content).toBe(content)
    expect(repos.updateNote(note.id, { title: 'Renamed', content }, { title: 'Lab', content: base })?.title).toBe('Renamed')
  })

  it('still finds a trashed note gone', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    repos.removeNote(note.id)
    expect(repos.updateNote(note.id, { content: JSON.stringify(typed(base)) }, { title: 'Lab', content: base })).toBeNull()
    expect(repos.updateNote(note.id, { content: JSON.stringify(typed(base)) }, { title: 'Lab', content: 'older' })).toBeNull()
  })

  it('lands once merged with the stored note, with the to-dos matching it', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line\n- [ ] Old task\n- [ ] Book the room' })
    const base = repos.getNote(note.id)!.content
    const [old, room] = tasksOf(note.id)
    const mine = typed(base)
    mine.content!.push({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call Anna' }] }] }] })
    tools.appendToNote({ id: note.id, markdown: '- [ ] Call back' })
    tools.setTodoDone({ id: room.id }, true)

    expect(editorSaves(note.id, base, mine)).toBe(2)
    const md = tools.readNote({ id: note.id }).markdown
    for (const line of ['Intro line', '- [ ] Old task', '- [x] Book the room', '- [ ] Call back', 'Typed here', '- [ ] Call Anna']) {
      expect(md).toContain(line)
    }
    const rows = tasksOf(note.id)
    expect(rows.map((t) => [t.title, t.status])).toEqual([
      ['Old task', 'todo'],
      ['Book the room', 'done'],
      ['Call back', 'todo'],
      ['Call Anna', 'todo']
    ])
    expect(rows.slice(0, 2).map((t) => t.id)).toEqual([old.id, room.id])
    // Both sides added a list at the end: the editor's comes first, so the lines are in another order than the rows.
    const lines = extractNoteTaskItems(stored(note.id) as never).sort((a, b) => Number(a.taskId) - Number(b.taskId))
    expect(lines.map((l) => [l.taskId, l.title, l.checked])).toEqual(rows.map((t) => [t.id, t.title, t.status === 'done']))
  })

  it('keeps one row per to-do when a line was typed below a list the assistant ticked in', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] Old task\n- [ ] Book the room' })
    const base = repos.getNote(note.id)!.content
    const [old, room] = tasksOf(note.id)
    const mine = JSON.parse(base) as Node
    mine.content![0].content!.push({ type: 'taskItem', attrs: { checked: false, taskId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call Anna' }] }] })
    mine.content!.push({ type: 'paragraph', content: [{ type: 'text', text: 'Notes' }] })
    tools.setTodoDone({ id: old.id }, true)

    editorSaves(note.id, base, mine)

    expect(tools.readNote({ id: note.id }).markdown.trim()).toBe('- [x] Old task\n- [ ] Book the room\n- [ ] Call Anna\n\nNotes')
    const rows = tasksOf(note.id)
    expect(rows.map((t) => [t.id, t.title, t.status])).toEqual([
      [old.id, 'Old task', 'done'],
      [room.id, 'Book the room', 'todo'],
      [rows[2].id, 'Call Anna', 'todo']
    ])
  })

  it('keeps one row and the tick for a to-do the editor moved while the assistant ticked it', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] Buy agar\n- [ ] Book the room\n- [ ] Call Anna' })
    const base = repos.getNote(note.id)!.content
    const [agar, room, anna] = tasksOf(note.id)
    const mine = JSON.parse(base) as Node
    mine.content![0].content!.unshift(mine.content![0].content!.pop()!)
    tools.setTodoDone({ id: anna.id }, true)

    editorSaves(note.id, base, mine)

    expect(tools.readNote({ id: note.id }).markdown.trim()).toBe('- [x] Call Anna\n- [ ] Buy agar\n- [ ] Book the room')
    expect(tasksOf(note.id).map((t) => [t.id, t.title, t.status])).toEqual([
      [agar.id, 'Buy agar', 'todo'],
      [room.id, 'Book the room', 'todo'],
      [anna.id, 'Call Anna', 'done']
    ])
  })

  it('keeps the title the assistant set while the editor saved its text', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    tools.renameNote({ id: note.id, title: 'Lab week 3' })

    editorUpdates(note.id, base, typed(base), 'Lab')

    expect(repos.getNote(note.id)!.title).toBe('Lab week 3')
    expect(tools.readNote({ id: note.id }).markdown).toContain('Typed here')
  })

  it('keeps the title the assistant set while the editor saved a new to-do', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line\n- [ ] Old task' })
    const base = repos.getNote(note.id)!.content
    const mine = JSON.parse(base) as Node
    mine.content![1].content!.push({ type: 'taskItem', attrs: { checked: false, taskId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call Anna' }] }] })
    tools.renameNote({ id: note.id, title: 'Lab week 3' })

    editorSaves(note.id, base, mine, 3, 'Lab')

    expect(repos.getNote(note.id)!.title).toBe('Lab week 3')
    expect(tools.readNote({ id: note.id }).markdown.trim()).toBe('Intro line\n\n- [ ] Old task\n- [ ] Call Anna')
  })

  it('keeps the title and text the assistant changed while the editor saved a new to-do', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line\n- [ ] Old task' })
    const base = repos.getNote(note.id)!.content
    const mine = JSON.parse(base) as Node
    mine.content![1].content!.push({ type: 'taskItem', attrs: { checked: false, taskId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call Anna' }] }] })
    tools.appendToNote({ id: note.id, markdown: 'More' })
    tools.renameNote({ id: note.id, title: 'Lab week 3' })

    editorSaves(note.id, base, mine, 3, 'Lab')

    expect(repos.getNote(note.id)!.title).toBe('Lab week 3')
    expect(tools.readNote({ id: note.id }).markdown.trim()).toBe('Intro line\n\n- [ ] Old task\n- [ ] Call Anna\n\nMore')
  })

  it('keeps a title typed here over the one the assistant set meanwhile', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    tools.renameNote({ id: note.id, title: 'Lab week 3' })

    editorUpdates(note.id, base, typed(base), 'Lab notes', 'Lab')

    expect(repos.getNote(note.id)!.title).toBe('Lab notes')
  })
})

describe('an assistant write landing while the editor saves', () => {
  // Another process writes only while this connection holds no transaction: at the first such
  // point once the save has begun writing, or after the save when it leaves none.
  const landingDuring = (save: () => void, write: () => void): void => {
    const prepare = raw.prepare.bind(raw)
    let begun = false
    let landed = false
    raw.prepare = ((sql: string) => {
      if (begun && !raw.isTransaction && !landed) {
        landed = true
        write()
      }
      if (raw.isTransaction) begun = true
      return prepare(sql)
    }) as typeof raw.prepare
    try {
      save()
    } finally {
      raw.prepare = prepare
    }
    if (!landed) write()
  }

  it('keeps the note and its to-do agreeing when the assistant ticks it', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [x] Book the room' })
    const base = repos.getNote(note.id)!.content
    const [room] = tasksOf(note.id)
    const mine = JSON.parse(base) as Node
    taskItems(mine)[0].attrs!.checked = false

    landingDuring(
      () => editorSaves(note.id, base, mine),
      () => otherProcess.setTodoDone({ id: room.id }, true)
    )

    expect(taskItems(stored(note.id))[0].attrs?.checked).toBe(true)
    expect(tasksOf(note.id).map((t) => [t.id, t.status])).toEqual([[room.id, 'done']])
  })

  it('keeps a to-do the editor deleted gone when the assistant appends', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] Buy agar\n- [ ] Book the room' })
    const base = repos.getNote(note.id)!.content
    const [agar] = tasksOf(note.id)
    const mine = JSON.parse(base) as Node
    mine.content![0].content!.pop()

    landingDuring(
      () => editorSaves(note.id, base, mine),
      () => otherProcess.appendToNote({ id: note.id, markdown: '- [ ] Call back' })
    )

    expect(tools.readNote({ id: note.id }).markdown).not.toContain('Book the room')
    expect(tasksOf(note.id).map((t) => [t.id, t.title])).toEqual([
      [agar.id, 'Buy agar'],
      [tasksOf(note.id)[1].id, 'Call back']
    ])
  })
})

describe('listDecks', () => {
  it('counts cards and the ones due now', () => {
    const { deckId } = tools.addFlashcards({ deckName: 'Bio', cards: [{ front: 'Agar', back: 'A jelly' }, { front: 'Cell', back: 'A unit' }] })
    expect(tools.listDecks().decks).toEqual([{ id: deckId, name: 'Bio', cards: 2, due: 2, noteId: null }])

    const [first] = raw.prepare(`SELECT * FROM flashcards WHERE deck_id = ? ORDER BY id`).all(deckId) as unknown as Card[]
    repos.reviewCard(first.id, 'good')
    expect(tools.listDecks().decks[0]).toMatchObject({ cards: 2, due: 1 })
  })
})

describe('addFlashcards', () => {
  const cardsOf = (deckId: number): Card[] => raw.prepare(`SELECT * FROM flashcards WHERE deck_id = ? ORDER BY id`).all(deckId) as unknown as Card[]

  it('adds to a deck by id', () => {
    const deck = repos.createDeck(repos.homeNotebookId(), 'Chem')
    expect(tools.addFlashcards({ deckId: deck.id, cards: [{ front: 'H2O', back: 'Water' }] })).toEqual({ deckId: deck.id, deckName: 'Chem', added: 1 })
    expect(cardsOf(deck.id).map((c) => [c.front, c.back])).toEqual([['H2O', 'Water']])
  })

  it('reuses a deck of the same name and makes one when there is none', () => {
    const deck = repos.createDeck(repos.homeNotebookId(), 'Chem')
    expect(tools.addFlashcards({ deckName: ' chem ', cards: [{ front: 'NaCl', back: 'Salt' }] }).deckId).toBe(deck.id)
    expect(repos.listDecks()).toHaveLength(1)

    const made = tools.addFlashcards({ deckName: 'Physics', cards: [{ front: 'F', back: 'ma' }] })
    expect(made.deckName).toBe('Physics')
    expect(repos.listDecks().map((d) => d.name)).toEqual(['Chem', 'Physics'])
    expect(repos.listDecks()[1].notebook_id).toBe(repos.homeNotebookId())
  })

  it('makes one card per cloze number, with no back needed', () => {
    const res = tools.addFlashcards({ deckName: 'Cells', cards: [{ front: 'The {{c1::nucleus}} holds the {{c2::DNA}}' }] })
    expect(res.added).toBe(2)
    expect(cardsOf(res.deckId).map((c) => [c.cloze, c.back])).toEqual([
      [1, ''],
      [2, '']
    ])
  })

  it('checks every card and the deck arguments before writing', () => {
    expect(() => tools.addFlashcards({ deckName: 'New', cards: [{ front: 'Agar', back: 'Jelly' }, { front: 'Agar' }] })).toThrow(/Card 2 needs a back/)
    expect(() => tools.addFlashcards({ deckName: 'New', cards: [{ front: 'Agar', back: '   ' }] })).toThrow(/Card 1 needs a back/)
    expect(() => tools.addFlashcards({ deckName: 'New', cards: [{ front: '  ', back: 'x' }] })).toThrow(/Card 1 has no front/)
    expect(() => tools.addFlashcards({ deckName: 'New', cards: [] })).toThrow(/at least one card/)
    expect(() => tools.addFlashcards({ deckId: 1, deckName: 'New', cards: [{ front: 'a', back: 'b' }] })).toThrow(/one of deckId or deckName/)
    expect(() => tools.addFlashcards({ cards: [{ front: 'a', back: 'b' }] })).toThrow(/one of deckId or deckName/)
    expect(() => tools.addFlashcards({ deckId: 77, cards: [{ front: 'a', back: 'b' }] })).toThrow(/no deck with id 77/)
    expect(repos.listDecks()).toEqual([])
    expect(count(`SELECT COUNT(*) AS n FROM flashcards`)).toBe(0)
  })

  it('rolls the whole call back when a card cannot be written', () => {
    raw.exec(`CREATE TRIGGER no_boom BEFORE INSERT ON flashcards WHEN NEW.front = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    expect(() => tools.addFlashcards({ deckName: 'Fresh', cards: [{ front: 'ok', back: 'x' }, { front: 'boom', back: 'y' }] })).toThrow(/boom/)
    expect(repos.listDecks()).toEqual([])
    expect(count(`SELECT COUNT(*) AS n FROM flashcards`)).toBe(0)
    expect(count(`SELECT COUNT(*) AS n FROM search_index WHERE source_type = 'deck'`)).toBe(0)
  })
})

/* ------------------------------ Edits and trash ----------------------------- */

const PLAN = '# Plan\n\nIntro\n\n## Week 1\n\nRead chapter 1\n- [ ] Buy agar\n- [ ] Book the lab\n\n## Week 2\n\n- [ ] Write it up\n\n### Notes\n\nSmall print'

describe('listNotes paging, recent changes and the trash', () => {
  it('pages, filters by change time and lists the trash', () => {
    const a = tools.createNote({ title: 'A' })
    const b = tools.createNote({ title: 'B' })
    const c = tools.createNote({ title: 'C' })
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-01-01T00:00:00.000Z', a.id)
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-02-01T00:00:00.000Z', b.id)
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-03-01T00:00:00.000Z', c.id)

    expect(tools.listNotes({ limit: 2 })).toMatchObject({ more: true })
    expect(tools.listNotes({ limit: 2, offset: 2 })).toEqual({ notes: [expect.objectContaining({ id: a.id })], more: false })
    expect(tools.listNotes({ changedSince: '2026-02-01' }).notes.map((n) => n.title)).toEqual(['C', 'B'])
    expect(() => tools.listNotes({ changedSince: 'last week' })).toThrow(/not a date/)

    tools.deleteNote({ id: b.id })
    expect(tools.listNotes({}).notes.map((n) => n.title)).toEqual(['C', 'A'])
    expect(tools.listNotes({ inTrash: true }).notes).toEqual([expect.objectContaining({ id: b.id, title: 'B', deletedAt: expect.any(String) })])
  })

  it('filters by the change time in either stored form', () => {
    const early = tools.createNote({ title: 'Early' })
    const late = tools.createNote({ title: 'Late' })
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-10-23T05:30:00.000Z', early.id)
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-10-23 06:00:00', late.id)

    expect(tools.listNotes({ changedSince: '2026-10-23T06:00:00Z' }).notes.map((n) => n.title)).toEqual(['Late'])
    expect(tools.listNotes({ changedSince: '2026-10-23T05:45:00+00:00' }).notes.map((n) => n.title)).toEqual(['Late'])
    expect(tools.listNotes({ changedSince: '2026-10-23T06:00:01Z' }).notes).toEqual([])
    expect(tools.listNotes({ changedSince: '2026-10-23' }).notes.map((n) => n.title).sort()).toEqual(['Early', 'Late'])
  })

  it('lists the latest change first in either stored form', () => {
    const early = tools.createNote({ title: 'Early' })
    const late = tools.createNote({ title: 'Late' })
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-10-23T05:30:00.000Z', early.id)
    raw.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run('2026-10-23 06:00:00', late.id)

    expect(tools.listNotes({}).notes.map((n) => n.title)).toEqual(['Late', 'Early'])
    expect(tools.listNotes({ limit: 1 }).notes.map((n) => n.title)).toEqual(['Late'])
  })
})

describe('sections', () => {
  it('reads one section, subsections included', () => {
    const note = tools.createNote({ title: 'Plan', markdown: PLAN })
    expect(tools.readNote({ id: note.id, heading: '## week 2' }).markdown).toBe('## Week 2\n\n- [ ] Write it up\n\n### Notes\n\nSmall print\n')
    expect(() => tools.readNote({ id: note.id, heading: 'Week 3' })).toThrow(/no heading "Week 3".*"Week 1", "Week 2"/)
  })

  it('appends at the end of a section', () => {
    const note = tools.createNote({ title: 'Plan', markdown: PLAN })
    const res = tools.appendToNote({ id: note.id, heading: 'Week 1', markdown: '- [ ] Order slides' })
    expect(res.todosCreated).toBe(1)
    const md = tools.readNote({ id: note.id }).markdown
    expect(md).toContain('- [ ] Book the lab\n\n- [ ] Order slides\n\n## Week 2')
  })

  it('replaces a section body, keeps the rest and the to-dos that stay', () => {
    const note = tools.createNote({ title: 'Plan', markdown: PLAN })
    const [agar, lab, write] = tasksOf(note.id)
    const res = tools.replaceNoteSection({ id: note.id, heading: 'Week 1', markdown: 'Read chapter 2\n- [ ] Book the lab\n- [ ] Clean up' })

    expect(res.previous).toBe('Read chapter 1\n\n- [ ] Buy agar\n- [ ] Book the lab\n')
    expect(res.todosCreated).toBe(1)
    const rows = tasksOf(note.id)
    expect(rows.map((t) => t.title)).toEqual(['Book the lab', 'Write it up', 'Clean up'])
    expect(rows.find((t) => t.title === 'Book the lab')!.id).toBe(lab.id)
    expect(rows.find((t) => t.title === 'Write it up')!.id).toBe(write.id)
    expect(rows.some((t) => t.id === agar.id)).toBe(false)
    expect(tools.readNote({ id: note.id }).markdown).toBe(
      '# Plan\n\nIntro\n\n## Week 1\n\nRead chapter 2\n\n- [ ] Book the lab\n- [ ] Clean up\n\n## Week 2\n\n- [ ] Write it up\n\n### Notes\n\nSmall print\n'
    )
  })

  it('clears a section and refuses a heading that is not unique', () => {
    const note = tools.createNote({ title: 'Plan', markdown: '## A\n\none\n\n## B\n\ntwo\n\n## B\n\nthree' })
    tools.replaceNoteSection({ id: note.id, heading: 'A', markdown: '' })
    expect(tools.readNote({ id: note.id }).markdown.startsWith('## A\n\n## B')).toBe(true)
    expect(() => tools.replaceNoteSection({ id: note.id, heading: 'B', markdown: 'x' })).toThrow(/2 headings are called "B"/)
  })
})

describe('editNote', () => {
  it('swaps text once and leaves every other block as stored', () => {
    const note = tools.createNote({ title: 'Plan', markdown: PLAN })
    const before = stored(note.id).content!
    const res = tools.editNote({ id: note.id, oldText: 'Read chapter 1', newText: 'Read **chapter 4**' })
    expect(res.replaced).toBe(1)
    const after = stored(note.id).content!
    expect(after).toHaveLength(before.length)
    after.forEach((block, i) => {
      if (i !== 3) expect(block).toEqual(before[i])
    })
    expect(tools.readNote({ id: note.id }).markdown).toContain('Read **chapter 4**')
  })

  it('keeps a reworded to-do and its row, and spans blocks', () => {
    const note = tools.createNote({ title: 'Plan', markdown: PLAN })
    const [agar, lab] = tasksOf(note.id)
    tools.editNote({ id: note.id, oldText: '- [ ] Buy agar', newText: '- [ ] Buy more agar' })
    expect(tasksOf(note.id).slice(0, 2).map((t) => [t.id, t.title])).toEqual([
      [agar.id, 'Buy more agar'],
      [lab.id, 'Book the lab']
    ])
    tools.editNote({ id: note.id, oldText: 'Intro\n\n## Week 1', newText: 'Intro, longer\n\n## First week' })
    expect(tools.readNote({ id: note.id }).markdown).toContain('Intro, longer\n\n## First week\n\nRead chapter 1')
  })

  it('needs a single match unless replaceAll is set', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'agar one\nagar two' })
    expect(() => tools.editNote({ id: note.id, oldText: 'agar', newText: 'gel' })).toThrow(/2 times/)
    expect(() => tools.editNote({ id: note.id, oldText: 'jelly', newText: 'gel' })).toThrow(/not in the note/)
    expect(() => tools.editNote({ id: note.id, oldText: '  ', newText: 'gel' })).toThrow(/cannot be empty/)
    expect(tools.editNote({ id: note.id, oldText: 'agar', newText: 'gel', replaceAll: true }).replaced).toBe(2)
    expect(tools.readNote({ id: note.id }).markdown).toBe('gel one\n\ngel two\n')
  })

  it('removes text when newText is empty', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'keep\ndrop me\nkeep too' })
    tools.editNote({ id: note.id, oldText: 'drop me', newText: '' })
    expect(tools.readNote({ id: note.id }).markdown).toBe('keep\n\nkeep too\n')
  })

  it('swaps text that starts or ends in the blank line between blocks', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'one\ntwo words' })
    tools.editNote({ id: note.id, oldText: '\n\ntwo', newText: '\n\nthree' })
    expect(tools.readNote({ id: note.id }).markdown).toBe('one\n\nthree words\n')
    tools.editNote({ id: note.id, oldText: '\nthree', newText: '\nfour' })
    expect(tools.readNote({ id: note.id }).markdown).toBe('one\n\nfour words\n')
    tools.editNote({ id: note.id, oldText: 'one\n\n', newText: 'one ' })
    expect(tools.readNote({ id: note.id }).markdown).toBe('one four words\n')
  })
})

describe('undoEdit', () => {
  it('takes edits back one at a time, removed to-dos with their old id and date', () => {
    const note = tools.createNote({ title: 'Plan', markdown: PLAN })
    const agar = tasksOf(note.id)[0]
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run('2026-10-20T10:00:00.000Z', agar.id)
    const original = tools.readNote({ id: note.id }).markdown

    tools.editNote({ id: note.id, oldText: '- [ ] Buy agar\n', newText: '' })
    tools.appendToNote({ id: note.id, markdown: 'Later' })
    expect(tasksOf(note.id).some((t) => t.id === agar.id)).toBe(false)

    expect(tools.undoEdit({ id: note.id }).left).toBe(1)
    expect(tools.undoEdit({ id: note.id }).left).toBe(0)
    expect(tools.readNote({ id: note.id }).markdown).toBe(original)
    expect(tasksOf(note.id).find((t) => t.id === agar.id)).toMatchObject({ title: 'Buy agar', due_date: '2026-10-20T10:00:00.000Z' })
    expect(() => tools.undoEdit({ id: note.id })).toThrow(/nothing to undo/)
  })

  it('refuses when the note changed in the app since', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'one' })
    tools.appendToNote({ id: note.id, markdown: 'two' })
    const changed = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'typed in the app' }] }] }
    repos.updateNote(note.id, { content: JSON.stringify(changed) })
    expect(() => tools.undoEdit({ id: note.id })).toThrow(/changed since/)
    expect(tools.readNote({ id: note.id }).markdown).toBe('typed in the app\n')
  })
})

describe('rename, delete and restore', () => {
  it('renames a note', () => {
    const note = tools.createNote({ title: 'Old' })
    expect(tools.renameNote({ id: note.id, title: ' New ' })).toMatchObject({ title: 'New', previousTitle: 'Old' })
    expect(tools.search({ query: 'new' }).results.map((h) => h.id)).toContain(note.id)
    expect(() => tools.renameNote({ id: note.id, title: ' ' })).toThrow(/needs a title/)
  })

  it('moves a note to the trash with its to-dos and cards, and brings it back', () => {
    const note = tools.createNote({ title: 'Bio', markdown: '- [ ] Revise\nCell :: The smallest unit of life' })
    tools.makeFlashcardsFromNote({ id: note.id })
    expect(tools.deleteNote({ id: note.id })).toMatchObject({ id: note.id, inTrash: true, keptForDays: 30 })
    expect(count(`SELECT COUNT(*) AS n FROM notes WHERE id = ?`, note.id)).toBe(1)
    expect(tools.listOpenTodos({}).todos).toEqual([])
    expect(tools.listDecks().decks).toEqual([])
    expect(() => tools.readNote({ id: note.id })).toThrow(/no note/)

    expect(tools.restoreNote({ id: note.id })).toMatchObject({ id: note.id, title: 'Bio' })
    expect(tools.listOpenTodos({}).todos.map((t) => t.text)).toEqual(['Revise'])
    expect(tools.listDecks().decks).toHaveLength(1)
    expect(() => tools.restoreNote({ id: note.id })).toThrow(/not in the trash/)
    expect(() => tools.restoreNote({ id: 999 })).toThrow(/not even in the trash/)
  })
})

/* ------------------------------ Today and cards ----------------------------- */

describe('today', () => {
  it('shows open to-dos with dates and the decks with cards due', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] Late one\n- [ ] Plain one' })
    const [late] = tasksOf(note.id)
    // stored like the app does, a local time as ISO UTC, so the local day stays 2 January in every zone
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run(new Date(2020, 0, 2, 12).toISOString(), late.id)
    tools.addFlashcards({ deckName: 'Bio', cards: [{ front: 'Agar', back: 'A jelly' }] })
    tools.addFlashcards({ deckName: 'Done for now', cards: [{ front: 'x', back: 'y' }] })
    const later = (raw.prepare(`SELECT id FROM flashcards WHERE front = 'x'`).get() as { id: number }).id
    repos.reviewCard(later, 'easy')

    const t = tools.today()
    expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(t.todos.map((x) => [x.text, x.due, x.overdue])).toEqual([
      ['Late one', '2020-01-02', true],
      ['Plain one', null, false]
    ])
    expect(t).toMatchObject({ openTodos: 2, flashcardsDue: 1, decks: [{ name: 'Bio', due: 1 }] })
  })
})

describe('listDueFlashcards and gradeFlashcard', () => {
  it('asks cloze cards one gap at a time and records a grade like the review screen', () => {
    const { deckId } = tools.addFlashcards({
      deckName: 'Cells',
      cards: [{ front: 'The {{c1::nucleus}} holds the {{c2::DNA}}' }, { front: 'Agar', back: 'A jelly' }]
    })
    const { cards, due } = tools.listDueFlashcards({})
    expect(due).toBe(3)
    expect(cards.map((c) => [c.question, c.answer])).toEqual(
      expect.arrayContaining([
        ['The […] holds the DNA', 'The nucleus holds the DNA'],
        ['The nucleus holds the […]', 'The nucleus holds the DNA'],
        ['Agar', 'A jelly']
      ])
    )
    expect(cards.every((c) => c.isNew && c.deckId === deckId && c.deckName === 'Cells')).toBe(true)
    expect(tools.listDueFlashcards({ limit: 1 }).cards).toHaveLength(1)

    const graded = tools.gradeFlashcard({ id: cards[0].id, grade: 'good' })
    expect(Date.parse(graded.nextReview)).toBeGreaterThan(Date.now())
    expect(count(`SELECT COUNT(*) AS n FROM review_log WHERE card_id = ?`, cards[0].id)).toBe(1)
    expect(tools.listDueFlashcards({ deckId }).due).toBe(2)
    expect(() => tools.listDueFlashcards({ deckId: 99 })).toThrow(/no deck with id 99/)
    expect(() => tools.gradeFlashcard({ id: 999, grade: 'good' })).toThrow(/no flashcard with id 999/)
  })

  it('orders cards from several decks by their due time in either stored form', () => {
    const six = tools.addFlashcards({ deckName: 'Cells', cards: [{ front: 'six', back: '1' }] })
    const five = tools.addFlashcards({ deckName: 'Plants', cards: [{ front: 'five', back: '2' }] })
    raw.prepare(`UPDATE flashcards SET next_review_date = ? WHERE deck_id = ?`).run('2026-10-23 06:00:00', six.deckId)
    raw.prepare(`UPDATE flashcards SET next_review_date = ? WHERE deck_id = ?`).run('2026-10-23T05:00:00.000Z', five.deckId)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T08:00:00.000Z'))
    try {
      expect(tools.listDueFlashcards({}).cards.map((c) => c.question)).toEqual(['five', 'six'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('makeFlashcardsFromNote', () => {
  const linkedCards = (noteId: number): Card[] =>
    raw
      .prepare(`SELECT c.* FROM flashcards c JOIN flashcard_decks d ON d.id = c.deck_id WHERE d.note_id = ? ORDER BY c.id`)
      .all(noteId) as unknown as Card[]

  it('makes the note’s own deck and stamps the lines like the button does', () => {
    const note = tools.createNote({ title: 'Bio', markdown: 'Cell :: The smallest unit of life\nThe {{c1::heart}} pumps blood\nJust prose' })
    const res = tools.makeFlashcardsFromNote({ id: note.id })
    expect(res).toMatchObject({ deckName: 'Bio', cards: 2, added: 2, due: 2 })
    const lines = stored(note.id).content!.filter((b) => b.attrs?.cardLine)
    expect(lines).toHaveLength(2)

    // Again after a new line and a reworded one: one more card, the reworded card kept.
    const [cell] = linkedCards(note.id)
    tools.editNote({ id: note.id, oldText: 'The smallest unit of life', newText: 'The basic unit of life' })
    tools.appendToNote({ id: note.id, markdown: 'Agar :: A jelly' })
    expect(tools.makeFlashcardsFromNote({ id: note.id })).toMatchObject({ deckId: res.deckId, cards: 3, added: 1 })
    expect(linkedCards(note.id).find((c) => c.id === cell.id)!.back).toBe('The basic unit of life')
  })

  it('refuses to remove cards whose line is gone, and changes nothing', () => {
    const note = tools.createNote({ title: 'Bio', markdown: 'Cell :: Unit\nAgar :: Jelly' })
    tools.makeFlashcardsFromNote({ id: note.id })
    tools.editNote({ id: note.id, oldText: 'Agar :: Jelly', newText: 'Agar is a jelly' })
    tools.appendToNote({ id: note.id, markdown: 'Gel :: Soft' })
    expect(() => tools.makeFlashcardsFromNote({ id: note.id })).toThrow(/would remove 1 card/)
    expect(linkedCards(note.id).map((c) => c.front)).toEqual(['Cell', 'Agar'])
  })

  it('says how to write card lines when there are none', () => {
    const note = tools.createNote({ title: 'Prose', markdown: 'Nothing to learn here' })
    expect(() => tools.makeFlashcardsFromNote({ id: note.id })).toThrow(/no card lines/)
    expect(repos.listDecks()).toEqual([])
  })
})
