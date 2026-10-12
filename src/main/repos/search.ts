import { getDb } from '../db'
import type { SearchResult } from '@shared/types'

/** One `search_index` table for notes, tasks and decks, keyed by (source_type, source_id). */

export { tiptapToText } from './text'

export function ftsDelete(sourceType: string, sourceId: number): void {
  getDb().prepare(`DELETE FROM search_index WHERE source_type = ? AND source_id = ?`).run(sourceType, String(sourceId))
}

export function ftsUpsert(sourceType: string, sourceId: number, title: string, contentText: string): void {
  ftsDelete(sourceType, sourceId)
  getDb()
    .prepare(`INSERT INTO search_index (title, content_text, source_type, source_id) VALUES (?, ?, ?, ?)`)
    .run(title, contentText, sourceType, String(sourceId))
}

export function searchQuery(q: string, limit = 20): SearchResult[] {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (tokens.length === 0) return []
  const match = tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' AND ')
  // Hits whose target is gone (a trashed note, a task or deck of one) are dropped before the limit,
  // so they can never crowd live results out. A task opens the note it lives in.
  const rows = getDb()
    .prepare(
      `SELECT s.title, snippet(search_index, 1, '⟪', '⟫', '…', 10) AS snippet, s.source_type, s.source_id,
              CASE s.source_type WHEN 'note' THEN n.id WHEN 'task' THEN tn.id END AS note_id
       FROM search_index s
       LEFT JOIN notes n ON s.source_type = 'note' AND n.id = s.source_id AND n.deleted_at IS NULL
       LEFT JOIN tasks t ON s.source_type = 'task' AND t.id = s.source_id
       LEFT JOIN notes tn ON tn.id = t.note_id AND tn.deleted_at IS NULL
       LEFT JOIN flashcard_decks d ON s.source_type = 'deck' AND d.id = s.source_id
         AND NOT EXISTS (SELECT 1 FROM notes dn WHERE dn.id = d.note_id AND dn.deleted_at IS NOT NULL)
       WHERE search_index MATCH ?
         AND (n.id IS NOT NULL OR tn.id IS NOT NULL OR d.id IS NOT NULL)
       ORDER BY rank LIMIT ?`
    )
    .all(match, limit) as Array<{ title: string; snippet: string; source_type: string; source_id: string; note_id: number | null }>
  const results: SearchResult[] = rows.map((r) => ({
    source_type: r.source_type as SearchResult['source_type'],
    source_id: Number(r.source_id),
    title: r.title,
    snippet: r.snippet,
    note_id: r.source_type === 'deck' ? null : r.note_id
  }))
  return results
}
