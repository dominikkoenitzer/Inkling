import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import { extractNoteTaskItems, stampTaskIds } from '../src/shared/noteTasks'
import { mergeDocs, type DocJson } from '../src/renderer/src/lib/mergeDoc'
import type { Card, Task } from '../src/shared/types'

let raw: DatabaseSync
let db: Database.Database

vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }))

const { migrate } = await import('../src/main/db')
const repos = await import('../src/main/repos')
const tools = await import('../src/main/mcp/tools')

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string }

beforeEach(() => {
  ;({ raw, db } = openSqlite())
  migrate(db) // the real schema, as a fresh install gets it
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
    expect(todos[0]).toEqual({ id: expect.any(Number), text: expect.any(String), noteId: expect.any(Number), noteTitle: expect.any(String) })
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

  // The editor's save: its to-dos first, then the note, both from the content it loaded.
  const editorSave = (noteId: number, base: string, doc: Node): void => {
    const ids = repos.syncNoteTasks(noteId, repos.homeNotebookId(), extractNoteTaskItems(doc as never), base)
    if (ids) repos.updateNote(noteId, { content: JSON.stringify(doc) }, base)
  }

  it('leaves the text and to-dos the assistant appended', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line\n- [ ] Old task' })
    const base = repos.getNote(note.id)!.content
    tools.appendToNote({ id: note.id, markdown: '- [ ] Call back' })

    editorSave(note.id, base, typed(base))

    expect(tools.readNote({ id: note.id }).markdown).toContain('- [ ] Call back')
    expect(tasksOf(note.id).map((t) => t.title)).toEqual(['Old task', 'Call back'])
  })

  it('leaves a to-do the assistant ticked done in the note and on Today', () => {
    const note = tools.createNote({ title: 'Lab', markdown: '- [ ] Book the room' })
    const base = repos.getNote(note.id)!.content
    const [task] = tasksOf(note.id)
    tools.setTodoDone({ id: task.id }, true)

    editorSave(note.id, base, typed(base))

    expect(taskItems(stored(note.id))[0].attrs?.checked).toBe(true)
    expect(tasksOf(note.id)[0].status).toBe('done')
  })

  it('writes nothing and gives the stored note back', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    tools.appendToNote({ id: note.id, markdown: 'More' })
    const now = repos.getNote(note.id)!

    expect(repos.updateNote(note.id, { title: 'Renamed', content: JSON.stringify(typed(base)) }, base)).toEqual(now)
    expect(repos.getNote(note.id)).toEqual(now)
  })

  it('saves over the content it started from, and over its own content with the title', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    const content = JSON.stringify(typed(base))
    expect(repos.updateNote(note.id, { content }, base)?.content).toBe(content)
    expect(repos.updateNote(note.id, { title: 'Renamed', content }, base)?.title).toBe('Renamed')
  })

  it('still finds a trashed note gone', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line' })
    const base = repos.getNote(note.id)!.content
    repos.removeNote(note.id)
    expect(repos.updateNote(note.id, { content: JSON.stringify(typed(base)) }, base)).toBeNull()
    expect(repos.updateNote(note.id, { content: JSON.stringify(typed(base)) }, 'older')).toBeNull()
  })

  it('lands once merged with the stored note, with the to-dos matching it', () => {
    const note = tools.createNote({ title: 'Lab', markdown: 'Intro line\n- [ ] Old task\n- [ ] Book the room' })
    let base = repos.getNote(note.id)!.content
    const [old, room] = tasksOf(note.id)
    const mine = typed(base)
    mine.content!.push({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call Anna' }] }] }] })
    tools.appendToNote({ id: note.id, markdown: '- [ ] Call back' })
    tools.setTodoDone({ id: room.id }, true)

    // The editor's save path: a refused save is merged with the stored note and sent again.
    let json = mine as DocJson
    let tries = 0
    for (;;) {
      tries++
      const ids = repos.syncNoteTasks(note.id, repos.homeNotebookId(), extractNoteTaskItems(json as never), base)
      if (ids) {
        json = stampTaskIds(json as Record<string, unknown>, ids) as DocJson
        const content = JSON.stringify(json)
        if (repos.updateNote(note.id, { content }, base)!.content === content) break
      }
      const now = repos.getNote(note.id)!.content
      json = mergeDocs(JSON.parse(base), json, JSON.parse(now))
      base = now
    }

    expect(tries).toBe(2)
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
    let base = repos.getNote(note.id)!.content
    const [old, room] = tasksOf(note.id)
    const mine = JSON.parse(base) as Node
    mine.content![0].content!.push({ type: 'taskItem', attrs: { checked: false, taskId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call Anna' }] }] })
    mine.content!.push({ type: 'paragraph', content: [{ type: 'text', text: 'Notes' }] })
    tools.setTodoDone({ id: old.id }, true)

    let json = mine as DocJson
    for (let tries = 0; tries < 3; tries++) {
      const ids = repos.syncNoteTasks(note.id, repos.homeNotebookId(), extractNoteTaskItems(json as never), base)
      if (ids) {
        json = stampTaskIds(json as Record<string, unknown>, ids) as DocJson
        const content = JSON.stringify(json)
        if (repos.updateNote(note.id, { content }, base)!.content === content) break
      }
      const now = repos.getNote(note.id)!.content
      json = mergeDocs(JSON.parse(base), json, JSON.parse(now))
      base = now
    }

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
    let base = repos.getNote(note.id)!.content
    const [agar, room, anna] = tasksOf(note.id)
    const mine = JSON.parse(base) as Node
    mine.content![0].content!.unshift(mine.content![0].content!.pop()!)
    tools.setTodoDone({ id: anna.id }, true)

    let json = mine as DocJson
    for (let tries = 0; tries < 3; tries++) {
      const ids = repos.syncNoteTasks(note.id, repos.homeNotebookId(), extractNoteTaskItems(json as never), base)
      if (ids) {
        json = stampTaskIds(json as Record<string, unknown>, ids) as DocJson
        const content = JSON.stringify(json)
        if (repos.updateNote(note.id, { content }, base)!.content === content) break
      }
      const now = repos.getNote(note.id)!.content
      json = mergeDocs(JSON.parse(base), json, JSON.parse(now))
      base = now
    }

    expect(tools.readNote({ id: note.id }).markdown.trim()).toBe('- [x] Call Anna\n- [ ] Buy agar\n- [ ] Book the room')
    expect(tasksOf(note.id).map((t) => [t.id, t.title, t.status])).toEqual([
      [agar.id, 'Buy agar', 'todo'],
      [room.id, 'Book the room', 'todo'],
      [anna.id, 'Call Anna', 'done']
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
