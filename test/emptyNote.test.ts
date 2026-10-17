import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openSqlite } from './sqlite'
import { isEmptyNote } from '../src/shared/emptyNote'

let db: ReturnType<typeof openSqlite>['db']

vi.mock('../src/main/db', () => ({ getDb: () => db }))

const { createNote, dropEmptyNotes, dropIfEmpty, getNote, removeNote } = await import('../src/main/repos/notes')

const doc = (...texts: string[]): string =>
  JSON.stringify({ type: 'doc', content: texts.map((text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined })) })

beforeEach(() => {
  db = openSqlite().db
  db.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      notebook_id INTEGER,
      title TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME
    );
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, notebook_id INTEGER, note_id INTEGER, title TEXT, status TEXT);
    CREATE TABLE flashcard_decks (id INTEGER PRIMARY KEY, notebook_id INTEGER, name TEXT, note_id INTEGER);
    CREATE VIRTUAL TABLE search_index USING fts5(
      title, content_text, source_type UNINDEXED, source_id UNINDEXED
    );
  `)
})

describe('isEmptyNote', () => {
  it('counts a note with only whitespace as empty', () => {
    expect(isEmptyNote(null, doc(''))).toBe(true)
    expect(isEmptyNote('   ', doc(' ', '\t', ''))).toBe(true)
    expect(isEmptyNote('', JSON.stringify({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] }))).toBe(true)
  })

  it('does not count a note with one character as empty', () => {
    expect(isEmptyNote('a', doc(''))).toBe(false)
    expect(isEmptyNote(null, doc('', '.'))).toBe(false)
  })

  it('keeps a blank checkbox, a rule and a body it cannot read', () => {
    const todo = JSON.stringify({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }] })
    expect(isEmptyNote(null, todo)).toBe(false)
    expect(isEmptyNote(null, JSON.stringify({ type: 'doc', content: [{ type: 'horizontalRule' }] }))).toBe(false)
    expect(isEmptyNote(null, '{not json')).toBe(false)
  })
})

describe('dropping empty notes', () => {
  it('deletes a completely empty note for good and leaves one with a character', () => {
    const empty = createNote({ notebook_id: 1 })
    const spaces = createNote({ notebook_id: 1, title: ' ', content: doc('  ') })
    const one = createNote({ notebook_id: 1, content: doc('x') })
    expect(dropIfEmpty(empty.id)).toBe(true)
    expect(dropIfEmpty(spaces.id)).toBe(true)
    expect(dropIfEmpty(one.id)).toBe(false)
    expect(getNote(empty.id)).toBeNull()
    expect(getNote(spaces.id)).toBeNull()
    expect(getNote(one.id)).not.toBeNull()
  })

  it('leaves trashed notes and notes with linked to-dos or decks alone', () => {
    const trashed = createNote({ notebook_id: 1 })
    removeNote(trashed.id)
    const withTask = createNote({ notebook_id: 1 })
    db.prepare(`INSERT INTO tasks (notebook_id, note_id, title, status) VALUES (1, ?, '', 'todo')`).run(withTask.id)
    const withDeck = createNote({ notebook_id: 1 })
    db.prepare(`INSERT INTO flashcard_decks (notebook_id, name, note_id) VALUES (1, 'Deck', ?)`).run(withDeck.id)
    expect(dropEmptyNotes()).toBe(0)
    expect(getNote(trashed.id)).not.toBeNull()
  })

  it('clears every empty note at startup', () => {
    createNote({ notebook_id: 1 })
    createNote({ notebook_id: 1 })
    const kept = createNote({ notebook_id: 1, title: 'Kept' })
    expect(dropEmptyNotes()).toBe(2)
    expect((db.prepare(`SELECT id FROM notes`).all() as Array<{ id: number }>).map((n) => n.id)).toEqual([kept.id])
  })
})
