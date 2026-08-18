import { getDb } from '../db'
import { now } from './dates'
import type { GradingSystem } from '@shared/grades'
import type { Grade } from '@shared/types'

export function listGrades(notebookId: number): Grade[] {
  return getDb().prepare(`SELECT * FROM grades WHERE notebook_id = ? ORDER BY id DESC`).all(notebookId) as Grade[]
}

export function listAllGrades(): Grade[] {
  return getDb().prepare(`SELECT * FROM grades ORDER BY notebook_id, id`).all() as Grade[]
}

export function createGrade(input: {
  notebook_id: number
  title: string
  score: number
  max: number
  weight: number
  system?: GradingSystem
}): Grade {
  const info = getDb()
    .prepare(`INSERT INTO grades (notebook_id, title, score, max, weight, system, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(input.notebook_id, input.title, input.score, input.max, input.weight, input.system ?? 'percent', now())
  return getDb().prepare(`SELECT * FROM grades WHERE id = ?`).get(info.lastInsertRowid) as Grade
}

export function updateGrade(id: number, patch: Record<string, unknown>): Grade {
  const allowed = ['title', 'score', 'max', 'weight'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE grades SET ${sets} WHERE id = @id`).run({ ...patch, id })
  }
  return getDb().prepare(`SELECT * FROM grades WHERE id = ?`).get(id) as Grade
}

export function removeGrade(id: number): void {
  getDb().prepare(`DELETE FROM grades WHERE id = ?`).run(id)
}
