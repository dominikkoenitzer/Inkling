import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import { extractNoteTaskItems } from '../src/shared/noteTasks'
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
    raw.prepare(`UPDATE tasks SET due_date = ? WHERE id = ?`).run('2020-01-02T12:00:00.000Z', late.id)
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
