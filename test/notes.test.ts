import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

/**
 * better-sqlite3 is rebuilt for Electron on install, so it cannot load under Node here.
 * Node's own SQLite speaks the same prepare/run/get/all dialect the repos use, and has
 * FTS5, which is enough to exercise the notes repo against a real database.
 */
let db: DatabaseSync

vi.mock('../src/main/db', () => ({ getDb: () => db }))

const { createNote, removeNote, restoreNote, updateNote } = await import('../src/main/repos/notes')
const { searchQuery } = await import('../src/main/repos/search')

const doc = (text: string): string => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

beforeEach(() => {
  db = new DatabaseSync(':memory:')
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
    CREATE VIRTUAL TABLE search_index USING fts5(
      title, content_text, source_type UNINDEXED, source_id UNINDEXED
    );
  `)
})

describe('updateNote after a soft delete', () => {
  it('does not write to a trashed page or put it back in search', () => {
    const note = createNote({ notebook_id: 1, title: 'Chapter 2', content: doc('mitochondria') })
    removeNote(note.id)

    // the editor's debounced save lands after the page went to the trash
    expect(updateNote(note.id, { title: 'Chapter 2', content: doc('mitochondria and more') })).toBeNull()

    expect(searchQuery('mitochondria')).toEqual([])
    const row = db.prepare(`SELECT content FROM notes WHERE id = ?`).get(note.id) as { content: string }
    expect(row.content).toBe(doc('mitochondria'))
  })

  it('still saves a live page and keeps it searchable', () => {
    const note = createNote({ notebook_id: 1, title: 'Chapter 2', content: doc('mitochondria') })
    expect(updateNote(note.id, { content: doc('ribosomes') })?.content).toBe(doc('ribosomes'))
    expect(searchQuery('ribosomes').map((r) => r.source_id)).toEqual([note.id])
  })

  it('comes back in search once restored', () => {
    const note = createNote({ notebook_id: 1, title: 'Chapter 2', content: doc('mitochondria') })
    removeNote(note.id)
    restoreNote(note.id)
    expect(searchQuery('mitochondria').map((r) => r.source_id)).toEqual([note.id])
  })
})
