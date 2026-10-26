import { getDb } from '../db'
import { now } from './dates'
import { ftsDelete, ftsUpsert, tiptapToText } from './search'
import { isEmptyNote } from '@shared/emptyNote'
import type { Note, NoteBase } from '@shared/types'

const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

/** Every live note, newest edit first. */
export function listNotes(): Note[] {
  return getDb().prepare(`SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY julianday(updated_at) DESC, id DESC`).all() as Note[]
}

export function getNote(id: number): Note | null {
  return (getDb().prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as Note | undefined) ?? null
}

export function createNote(input: { notebook_id: number; title?: string | null; content?: string }): Note {
  const ts = now()
  const info = getDb()
    .prepare(
      `INSERT INTO notes (notebook_id, title, content, created_at, updated_at)
       VALUES (@notebook_id, @title, @content, @ts, @ts)`
    )
    .run({ notebook_id: input.notebook_id, title: input.title ?? null, content: input.content ?? EMPTY_DOC, ts })
  const note = getNote(Number(info.lastInsertRowid))!
  ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  return note
}

/**
 * With `base`, the title and content an edit started from, nothing is written once the stored
 * content, or the stored title the patch sets, is neither that nor the new one (an assistant
 * wrote to the note meanwhile), and the stored note comes back unchanged, so the caller can tell
 * by its title and content that the save did not land.
 */
export function updateNote(id: number, patch: Record<string, unknown>, base?: NoteBase): Note | null {
  const allowed = ['title', 'content', 'notebook_id'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    const unchanged =
      base === undefined
        ? ''
        : ('content' in patch ? ' AND content IN (@base, @content)' : ' AND content = @base') +
          ('title' in patch ? ' AND (title IS @baseTitle OR title IS @title)' : '')
    const info = getDb()
      .prepare(`UPDATE notes SET ${sets}, updated_at = @ts WHERE id = @id AND deleted_at IS NULL${unchanged}`)
      .run({
        ...patch,
        id,
        ts: now(),
        ...(base === undefined ? {} : { base: base.content }),
        ...(base !== undefined && 'title' in patch ? { baseTitle: base.title } : {})
      })
    if (info.changes === 0) {
      // Trashed or gone: a debounced save landing after the delete must not revive the page in search.
      const stored = base === undefined ? null : getNote(id)
      return stored && !stored.deleted_at ? stored : null
    }
  }
  const note = getNote(id)
  if (!note) return null // row was deleted (e.g. a debounced save landing after the note was removed)
  if ('title' in patch || 'content' in patch) {
    ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  }
  return note
}

/* ------------------------------- Empty notes ------------------------------ */

/**
 * Deletes a live note for good if it is still completely empty and nothing hangs off it.
 * Returns whether it went. Such a note skips the trash: there is nothing in it to undo.
 */
export function dropIfEmpty(id: number): boolean {
  const db = getDb()
  const tx = db.transaction(() => {
    const note = db.prepare(`SELECT title, content FROM notes WHERE id = ? AND deleted_at IS NULL`).get(id) as
      | Pick<Note, 'title' | 'content'>
      | undefined
    if (!note || !isEmptyNote(note.title, note.content)) return false
    const linked = db
      .prepare(`SELECT (SELECT COUNT(*) FROM tasks WHERE note_id = @id) + (SELECT COUNT(*) FROM flashcard_decks WHERE note_id = @id) AS n`)
      .get({ id }) as { n: number }
    if (linked.n > 0) return false
    db.prepare(`DELETE FROM notes WHERE id = ?`).run(id)
    ftsDelete('note', id)
    return true
  })
  return tx() as boolean
}

/** Called once at startup: empty notes left behind last time go. */
export function dropEmptyNotes(): number {
  const ids = getDb().prepare(`SELECT id FROM notes WHERE deleted_at IS NULL`).all() as Array<{ id: number }>
  return ids.filter((n) => dropIfEmpty(n.id)).length
}

/* ---------------------------------- Trash --------------------------------- */

/** How long a deleted note stays recoverable before the next launch clears it for good. */
export const TRASH_RETENTION_DAYS = 30

/**
 * Soft delete: the row gets a tombstone, drops out of every list and out of search, and is
 * purged for real after TRASH_RETENTION_DAYS. The toast offers an undo until then.
 */
export function removeNote(id: number): void {
  getDb().prepare(`UPDATE notes SET deleted_at = ? WHERE id = ?`).run(now(), id)
  ftsDelete('note', id)
}

export function restoreNote(id: number): Note | null {
  getDb().prepare(`UPDATE notes SET deleted_at = NULL WHERE id = ?`).run(id)
  const note = getNote(id)
  if (note) ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  return note
}

/** Called once at startup: anything deleted longer ago than the retention window goes. */
export function purgeExpiredNotes(): number {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000).toISOString()
  const stale = getDb()
    .prepare(`SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
    .all(cutoff) as Array<{ id: number }>
  const del = getDb().prepare(`DELETE FROM notes WHERE id = ?`)
  const taskIds = getDb().prepare(`SELECT id FROM tasks WHERE note_id = ?`)
  const delTasks = getDb().prepare(`DELETE FROM tasks WHERE note_id = ?`)
  const freeCards = getDb().prepare(
    `UPDATE flashcards SET source_line = NULL WHERE deck_id IN (SELECT id FROM flashcard_decks WHERE note_id = ?)`
  )
  const tx = getDb().transaction(() => {
    for (const n of stale) {
      // A note's checkboxes go with it.
      for (const t of taskIds.all(n.id) as Array<{ id: number }>) ftsDelete('task', t.id)
      delTasks.run(n.id)
      // Its deck stays as a deck of its own, with cards that can be edited again.
      freeCards.run(n.id)
      del.run(n.id)
      ftsDelete('note', n.id)
    }
  })
  tx()
  return stale.length
}
