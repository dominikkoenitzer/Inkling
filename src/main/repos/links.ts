import { getDb } from '../db'
import { createNote } from './notes'
import type { Note } from '@shared/types'

/** Wiki-links: the `[[…]]` edges between notes, and the backlinks they imply. */

/**
 * Resolve the `[[wiki-links]]` in a note and rebuild its outgoing edges.
 *
 * Mirrors `syncNoteTasks`: the note's content is the source of truth, this runs on save,
 * and it hands back one id per label in the same order so the editor can stamp the ids
 * into the document. A label that doesn't match an existing page creates one — that's the
 * whole point of linking as you write, rather than having to make the page first.
 */
export function syncNoteLinks(sourceNoteId: number, notebookId: number, labels: string[]): number[] {
  const db = getDb()
  const ids: number[] = []
  const tx = db.transaction(() => {
    for (const raw of labels) {
      const label = raw.trim()
      if (!label) {
        ids.push(0)
        continue
      }
      // Prefer a page in the current notebook, then anywhere — so "Chapter 4" resolves to
      // this subject's page rather than a same-named one in another subject.
      const match = (db
        .prepare(
          `SELECT id FROM notes
            WHERE type = 'page' AND deleted_at IS NULL AND LOWER(TRIM(COALESCE(title,''))) = LOWER(?)
            ORDER BY (notebook_id = ?) DESC, id
            LIMIT 1`
        )
        .get(label, notebookId) as { id: number } | undefined) ?? undefined

      const targetId = match ? match.id : createNote({ notebook_id: notebookId, type: 'page', title: label }).id
      ids.push(targetId)
    }

    db.prepare(`DELETE FROM note_links WHERE source_note_id = ?`).run(sourceNoteId)
    const insert = db.prepare(`INSERT OR IGNORE INTO note_links (source_note_id, target_note_id) VALUES (?, ?)`)
    for (const target of new Set(ids)) {
      if (target > 0 && target !== sourceNoteId) insert.run(sourceNoteId, target)
    }
  })
  tx()
  return ids
}

/** Notes that link *to* this one — the other half of a wiki-link, and the useful half. */
export function noteBacklinks(noteId: number): Note[] {
  return getDb()
    .prepare(
      `SELECT n.* FROM note_links l
         JOIN notes n ON n.id = l.source_note_id
        WHERE l.target_note_id = ? AND n.deleted_at IS NULL
        ORDER BY n.updated_at DESC`
    )
    .all(noteId) as Note[]
}
