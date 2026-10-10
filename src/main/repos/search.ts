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

export function searchQuery(q: string): SearchResult[] {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (tokens.length === 0) return []
  const match = tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' AND ')
  const rows = getDb()
    .prepare(
      `SELECT title, snippet(search_index, 1, '⟪', '⟫', '…', 10) AS snippet, source_type, source_id
       FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 20`
    )
    .all(match) as Array<{ title: string; snippet: string; source_type: string; source_id: string }>
  // What each kind of hit opens: a live note, the live note a task sits in, or a deck.
  const targets: Record<SearchResult['source_type'], string> = {
    note: `SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL`,
    task: `SELECT t.note_id AS id FROM tasks t JOIN notes n ON n.id = t.note_id WHERE t.id = ? AND n.deleted_at IS NULL`,
    deck: `SELECT id FROM flashcard_decks WHERE id = ?`
  }
  const results: SearchResult[] = []
  for (const r of rows) {
    const id = Number(r.source_id)
    const type = r.source_type as SearchResult['source_type']
    // A task opens the note it lives in; a row whose target is gone is stale and skipped.
    const target = getDb().prepare(targets[type]).get(id) as { id: number } | undefined
    if (!target) continue
    results.push({ source_type: type, source_id: id, title: r.title, snippet: r.snippet, note_id: type === 'deck' ? null : target.id })
  }
  return results
}
