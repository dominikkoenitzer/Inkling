import { getDb } from '../db'
import { now } from './dates'
import { ftsDelete, ftsUpsert, tiptapToText } from './search'
import type { Note } from '@shared/types'

const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

export function listNotes(notebookId: number): Note[] {
  return getDb()
    .prepare(`SELECT * FROM notes WHERE notebook_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`)
    .all(notebookId) as Note[]
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

export function updateNote(id: number, patch: Record<string, unknown>): Note | null {
  const allowed = ['title', 'content', 'notebook_id'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb()
      .prepare(`UPDATE notes SET ${sets}, updated_at = @ts WHERE id = @id`)
      .run({ ...patch, id, ts: now() })
  }
  const note = getNote(id)
  if (!note) return null // row was deleted (e.g. a debounced save landing after the note was removed)
  if ('title' in patch || 'content' in patch) {
    ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  }
  return note
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
  const tx = getDb().transaction(() => {
    for (const n of stale) {
      del.run(n.id)
      ftsDelete('note', n.id)
    }
  })
  tx()
  return stale.length
}
