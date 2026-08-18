import { getDb } from '../db'
import { tiptapToText } from './search'
import { extractTags } from '@shared/tags'
import type { Note } from '@shared/types'

/**
 * Rebuild a note's tags from its content. Called from create/update rather than exposed
 * over IPC, so the tag index cannot drift from the text it describes.
 */
export function syncNoteTags(noteId: number, title: string | null, content: string): void {
  const db = getDb()
  const tags = extractTags(`${title ?? ''} ${tiptapToText(content)}`)
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_tags WHERE note_id = ?`).run(noteId)
    const insert = db.prepare(`INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)`)
    for (const tag of tags) insert.run(noteId, tag)
  })
  tx()
}

/** Every tag used in a notebook, most-used first, with how many live notes carry it. */
export function listTags(notebookId?: number): Array<{ tag: string; count: number }> {
  const db = getDb()
  const where = notebookId === undefined ? '' : 'AND n.notebook_id = ?'
  const sql = `SELECT t.tag AS tag, COUNT(*) AS count
                 FROM note_tags t JOIN notes n ON n.id = t.note_id
                WHERE n.deleted_at IS NULL ${where}
                GROUP BY t.tag ORDER BY count DESC, t.tag`
  const stmt = db.prepare(sql)
  return (notebookId === undefined ? stmt.all() : stmt.all(notebookId)) as Array<{ tag: string; count: number }>
}

export function tagsForNote(noteId: number): string[] {
  return (getDb().prepare(`SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag`).all(noteId) as Array<{ tag: string }>).map(
    (r) => r.tag
  )
}

export function notesWithTag(tag: string, notebookId?: number): Note[] {
  const db = getDb()
  const where = notebookId === undefined ? '' : 'AND n.notebook_id = ?'
  const sql = `SELECT n.* FROM note_tags t JOIN notes n ON n.id = t.note_id
                WHERE t.tag = ? AND n.deleted_at IS NULL ${where}
                ORDER BY n.pinned DESC, n.updated_at DESC`
  const stmt = db.prepare(sql)
  return (notebookId === undefined ? stmt.all(tag.toLowerCase()) : stmt.all(tag.toLowerCase(), notebookId)) as Note[]
}

/** One-time backfill so notes written before v0.4.0 get their tags without an edit. */
export function backfillTags(): void {
  const rows = getDb().prepare(`SELECT id, title, content FROM notes`).all() as Array<{
    id: number
    title: string | null
    content: string
  }>
  for (const n of rows) syncNoteTags(n.id, n.title, n.content)
}
