import { getDb } from '../db'
import { now } from './dates'
import { ftsDelete, ftsUpsert, tiptapToText } from './search'
import { syncNoteTags } from './tags'
import type { Note, NoteType } from '@shared/types'

const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

export function listNotes(notebookId: number, type?: NoteType): Note[] {
  if (type) {
    return getDb()
      .prepare(`SELECT * FROM notes WHERE notebook_id = ? AND type = ? AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`)
      .all(notebookId, type) as Note[]
  }
  return getDb()
    .prepare(`SELECT * FROM notes WHERE notebook_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`)
    .all(notebookId) as Note[]
}

export function getNote(id: number): Note | null {
  return (getDb().prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as Note | undefined) ?? null
}

export function createNote(input: {
  notebook_id: number
  type: NoteType
  title?: string | null
  content?: string
  color?: string | null
  pos_x?: number
  pos_y?: number
  width?: number
  height?: number
}): Note {
  const content = input.content ?? EMPTY_DOC
  const ts = now()
  const info = getDb()
    .prepare(
      `INSERT INTO notes (notebook_id, type, title, content, color, pos_x, pos_y, width, height, created_at, updated_at)
       VALUES (@notebook_id, @type, @title, @content, @color, @pos_x, @pos_y, @width, @height, @ts, @ts)`
    )
    .run({
      notebook_id: input.notebook_id,
      type: input.type,
      title: input.title ?? null,
      content,
      color: input.color ?? null,
      pos_x: input.pos_x ?? null,
      pos_y: input.pos_y ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      ts
    })
  const note = getNote(Number(info.lastInsertRowid))!
  ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  syncNoteTags(note.id, note.title, note.content)
  return note
}

export function updateNote(id: number, patch: Record<string, unknown>): Note | null {
  const allowed = ['title', 'content', 'color', 'pos_x', 'pos_y', 'width', 'height', 'pinned', 'notebook_id'] as const
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
    syncNoteTags(note.id, note.title, note.content)
  }
  return note
}

/* ---------------------------------- Trash --------------------------------- */

/** How long a deleted note is recoverable before the next launch clears it for good. */
export const TRASH_RETENTION_DAYS = 30

/**
 * Soft delete. Through v0.3.x this was an immediate `DELETE` with no confirmation and no
 * way back — one misclick in the sidebar and a page was gone. The row now gets a tombstone
 * instead: it drops out of every list and out of search, the UI offers an undo, and it is
 * purged for real after TRASH_RETENTION_DAYS.
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

/** Notes currently in the trash, newest deletion first. */
export function listDeletedNotes(notebookId?: number): Note[] {
  const db = getDb()
  if (notebookId !== undefined) {
    return db
      .prepare(`SELECT * FROM notes WHERE deleted_at IS NOT NULL AND notebook_id = ? ORDER BY deleted_at DESC`)
      .all(notebookId) as Note[]
  }
  return db.prepare(`SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all() as Note[]
}

/** Permanently delete one trashed note. Tasks linked to it lose the link but survive. */
export function purgeNote(id: number): void {
  getDb().prepare(`DELETE FROM notes WHERE id = ? AND deleted_at IS NOT NULL`).run(id)
  ftsDelete('note', id)
}

export function emptyTrash(): number {
  const rows = listDeletedNotes()
  const del = getDb().prepare(`DELETE FROM notes WHERE id = ?`)
  const tx = getDb().transaction(() => {
    for (const n of rows) {
      del.run(n.id)
      ftsDelete('note', n.id)
    }
  })
  tx()
  return rows.length
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
