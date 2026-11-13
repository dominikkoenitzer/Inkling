import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import { storedTime } from '../src/shared/day'

let db: Database.Database

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }))

const { migrate } = await import('../src/main/db')
const { createNotebook } = await import('../src/main/repos/notebooks')
const { createNote, listNotes, removeNote, updateNote } = await import('../src/main/repos/notes')
const { openTasks, saveNoteWithTasks, setTaskDone, syncNoteTasks } = await import('../src/main/repos/tasks')
const { addCard, createDeck, reviewCard } = await import('../src/main/repos/flashcards')

/** Mid-afternoon, so a stored clock time can never pass for a day by chance. */
const AFTERNOON = new Date(2026, 10, 11, 14, 37, 12, 345)

/** Every column that records when something was done; a due date he picks is his own. */
function stamps(): Array<{ where: string; value: string }> {
  const out: Array<{ where: string; value: string }> = []
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>
    for (const col of cols.map((c) => c.name).filter((c) => /_at$|_date$|^last_review$/.test(c) && c !== 'due_date')) {
      for (const row of db.prepare(`SELECT ${col} AS v FROM ${name} WHERE ${col} IS NOT NULL`).all() as Array<{ v: string }>) {
        out.push({ where: `${name}.${col}`, value: String(row.v) })
      }
    }
  }
  return out
}

const isLocalMidnight = (value: string): boolean => {
  const d = new Date(storedTime(value))
  return !Number.isNaN(d.getTime()) && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
}

describe('nothing keeps the clock time of something he did', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(AFTERNOON)
    ;({ db } = openSqlite())
    migrate(db)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores only the day for notes, tasks, decks, cards and reviews', () => {
    const book = createNotebook({ name: 'Biology', color: 'teal' })
    const note = createNote({ notebook_id: book.id, title: 'Cells' })
    updateNote(note.id, { title: 'Cells and more' })
    const [taskId] = syncNoteTasks(note.id, book.id, [{ taskId: null, title: 'Read chapter 2', checked: false }])
    setTaskDone(taskId, true)
    saveNoteWithTasks(note.id, book.id, { title: 'Cells', content: '{"type":"doc","content":[]}' }, [
      { taskId, title: 'Read chapter 2', checked: true },
      { taskId: null, title: 'Draw a cell', checked: true }
    ])
    const deck = createDeck(book.id, 'Cells')
    for (const grade of ['again', 'hard', 'good', 'easy'] as const) {
      reviewCard(addCard(deck.id, `front ${grade}`, 'back').id, grade)
    }
    const other = createNote({ notebook_id: book.id, title: 'Trash me' })
    removeNote(other.id)

    const found = stamps()
    expect(found.map((s) => s.where)).toEqual(
      expect.arrayContaining(['notebooks.created_at', 'notes.updated_at', 'notes.deleted_at', 'tasks.completed_at', 'flashcards.last_review', 'review_log.reviewed_at'])
    )
    expect(found.filter((s) => !isLocalMidnight(s.value))).toEqual([])
  })

  it('stamps the day when a to-do already in a note is ticked', () => {
    const book = createNotebook({ name: 'Biology', color: 'teal' })
    const note = createNote({ notebook_id: book.id, title: 'Cells' })
    const [taskId] = syncNoteTasks(note.id, book.id, [{ taskId: null, title: 'Read chapter 2', checked: false }])
    syncNoteTasks(note.id, book.id, [{ taskId, title: 'Read chapter 2', checked: true }])
    const done = db.prepare(`SELECT completed_at FROM tasks WHERE id = ?`).get(taskId) as { completed_at: string }
    expect(isLocalMidnight(done.completed_at)).toBe(true)
  })

  it('stamps the day when ticking a to-do writes the checkbox into its note', () => {
    const book = createNotebook({ name: 'Biology', color: 'teal' })
    const note = createNote({ notebook_id: book.id, title: 'Cells' })
    const [taskId] = syncNoteTasks(note.id, book.id, [{ taskId: null, title: 'Read chapter 2', checked: false }])
    const line = { type: 'taskItem', attrs: { checked: false, taskId }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read chapter 2' }] }] }
    updateNote(note.id, { content: JSON.stringify({ type: 'doc', content: [{ type: 'taskList', content: [line] }] }) })
    const before = db.prepare(`SELECT edit_seq FROM notes WHERE id = ?`).get(note.id) as { edit_seq: number }
    setTaskDone(taskId, true)
    const after = db.prepare(`SELECT content, updated_at, edit_seq FROM notes WHERE id = ?`).get(note.id) as { content: string; updated_at: string; edit_seq: number }
    expect(after.content).toContain('"checked":true')
    expect(after.edit_seq).toBeGreaterThan(before.edit_seq)
    expect(isLocalMidnight(after.updated_at)).toBe(true)
  })

  it('makes a new card due on the day it was added', () => {
    const book = createNotebook({ name: 'Biology', color: 'teal' })
    const card = addCard(createDeck(book.id, 'Cells').id, 'front', 'back')
    expect(isLocalMidnight(card.next_review_date)).toBe(true)
  })

  it('lists the note edited last first, also within one day', () => {
    const book = createNotebook({ name: 'Biology', color: 'teal' })
    const first = createNote({ notebook_id: book.id, title: 'First' })
    const second = createNote({ notebook_id: book.id, title: 'Second' })
    expect(listNotes().map((n) => n.id)).toEqual([second.id, first.id])
    updateNote(first.id, { title: 'First, edited' })
    expect(listNotes().map((n) => n.id)).toEqual([first.id, second.id])
  })

  it('lists the to-dos of the note edited last first, also within one day', () => {
    const book = createNotebook({ name: 'Biology', color: 'teal' })
    const first = createNote({ notebook_id: book.id, title: 'First' })
    const second = createNote({ notebook_id: book.id, title: 'Second' })
    syncNoteTasks(second.id, book.id, [{ taskId: null, title: 'task b', checked: false }])
    syncNoteTasks(first.id, book.id, [{ taskId: null, title: 'task a', checked: false }])
    updateNote(first.id, { title: 'First, edited' })
    expect(openTasks().map((t) => t.title)).toEqual(['task a', 'task b'])
  })

  it('names backups without a time', () => {
    const src = join(__dirname, '..', 'src', 'main')
    const files = fs.readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
    const named = files.filter((f) => /toISOString\(\)\.replace\(/.test(fs.readFileSync(join(src, f), 'utf8')))
    expect(named).toEqual([])
  })
})
