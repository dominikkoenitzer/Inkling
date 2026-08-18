import { getDb } from '../db'
import { ftsDelete } from './search'
import type { ColorKey, Notebook } from '@shared/types'

export function listNotebooks(): Notebook[] {
  return getDb().prepare(`SELECT * FROM notebooks ORDER BY sort_order, id`).all() as Notebook[]
}

export function createNotebook(input: { name: string; color: ColorKey; icon?: string | null; kind?: string; is_journal?: boolean }): Notebook {
  const max = (getDb().prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM notebooks`).get() as { m: number }).m
  const info = getDb()
    .prepare(`INSERT INTO notebooks (name, color, icon, kind, sort_order, is_journal) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.name, input.color, input.icon ?? null, input.kind ?? 'general', max + 1, input.is_journal ? 1 : 0)
  return getDb().prepare(`SELECT * FROM notebooks WHERE id = ?`).get(info.lastInsertRowid) as Notebook
}

export function updateNotebook(id: number, patch: Record<string, unknown>): Notebook {
  const allowed = ['name', 'color', 'icon', 'kind', 'sort_order'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE notebooks SET ${sets} WHERE id = @id`).run({ ...patch, id })
  }
  return getDb().prepare(`SELECT * FROM notebooks WHERE id = ?`).get(id) as Notebook
}

export function removeNotebook(id: number): void {
  const db = getDb()
  const noteIds = db.prepare(`SELECT id FROM notes WHERE notebook_id = ?`).all(id) as Array<{ id: number }>
  const taskIds = db.prepare(`SELECT id FROM tasks WHERE notebook_id = ?`).all(id) as Array<{ id: number }>
  const deckIds = db.prepare(`SELECT id FROM flashcard_decks WHERE notebook_id = ?`).all(id) as Array<{ id: number }>
  const tx = db.transaction(() => {
    for (const n of noteIds) ftsDelete('note', n.id)
    for (const t of taskIds) ftsDelete('task', t.id)
    for (const d of deckIds) ftsDelete('deck', d.id)
    db.prepare(`DELETE FROM notebooks WHERE id = ?`).run(id)
  })
  tx()
}
