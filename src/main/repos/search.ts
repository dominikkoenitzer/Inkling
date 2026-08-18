import { getDb } from '../db'
import type { SearchResult } from '@shared/types'

/**
 * The full-text index. Notes, tasks and decks all write into one `search_index`
 * table keyed by (source_type, source_id), which is why every repository that
 * creates or destroys one of those rows calls in here.
 */

export function tiptapToText(json: string): string {
  try {
    const doc = JSON.parse(json)
    const out: string[] = []
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      const node = n as { text?: string; content?: unknown[] }
      if (typeof node.text === 'string') out.push(node.text)
      if (Array.isArray(node.content)) node.content.forEach(walk)
    }
    walk(doc)
    return out.join(' ')
  } catch {
    return ''
  }
}

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
  const results: SearchResult[] = []
  for (const r of rows) {
    const id = Number(r.source_id)
    let notebookId: number | null = null
    if (r.source_type === 'note') notebookId = (getDb().prepare(`SELECT notebook_id FROM notes WHERE id = ?`).get(id) as { notebook_id: number } | undefined)?.notebook_id ?? null
    else if (r.source_type === 'task') notebookId = (getDb().prepare(`SELECT notebook_id FROM tasks WHERE id = ?`).get(id) as { notebook_id: number } | undefined)?.notebook_id ?? null
    else if (r.source_type === 'deck') notebookId = (getDb().prepare(`SELECT notebook_id FROM flashcard_decks WHERE id = ?`).get(id) as { notebook_id: number } | undefined)?.notebook_id ?? null
    if (notebookId === null) continue // stale index row
    results.push({
      source_type: r.source_type as SearchResult['source_type'],
      source_id: id,
      title: r.title,
      snippet: r.snippet,
      notebook_id: notebookId
    })
  }
  return results
}
