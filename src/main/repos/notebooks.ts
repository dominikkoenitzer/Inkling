import { getDb } from '../db'
import type { ColorKey, Notebook } from '@shared/types'

// Notebooks are a storage detail now: the app shows one list of notes. Older databases can
// hold several, and their notes all show up together.

export function listNotebooks(): Notebook[] {
  return getDb().prepare(`SELECT * FROM notebooks ORDER BY sort_order, id`).all() as Notebook[]
}

export function createNotebook(input: { name: string; color: ColorKey }): Notebook {
  const max = (getDb().prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM notebooks`).get() as { m: number }).m
  const info = getDb()
    .prepare(`INSERT INTO notebooks (name, color, sort_order) VALUES (?, ?, ?)`)
    .run(input.name, input.color, max + 1)
  return getDb().prepare(`SELECT * FROM notebooks WHERE id = ?`).get(info.lastInsertRowid) as Notebook
}

/** Where new notes and decks go: the first notebook, made on the spot if there is none. */
export function homeNotebookId(): number {
  return listNotebooks()[0]?.id ?? createNotebook({ name: 'Notes', color: 'teal' }).id
}
