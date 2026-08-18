import { getDb } from '../db'
import { now } from './dates'

export function startFocus(input: { task_id?: number | null; deck_id?: number | null }): number {
  const info = getDb()
    .prepare(`INSERT INTO focus_sessions (task_id, deck_id, started_at, completed) VALUES (?, ?, ?, 0)`)
    .run(input.task_id ?? null, input.deck_id ?? null, now())
  return Number(info.lastInsertRowid)
}

export function completeFocus(id: number, minutes: number): void {
  getDb().prepare(`UPDATE focus_sessions SET duration_minutes = ?, completed = 1 WHERE id = ?`).run(minutes, id)
}

export function todayFocusMinutes(): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(duration_minutes), 0) AS m FROM focus_sessions WHERE completed = 1 AND started_at >= ?`)
    .get(start.toISOString()) as { m: number }
  return row.m
}
