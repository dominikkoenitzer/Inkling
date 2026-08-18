import { getDb } from '../db'
import { localDay, now } from './dates'
import { studyDays } from './streak'
import { streaksFrom } from '@shared/streaks'
import type { ActivityDay, ForecastDay, RatingBreakdown, StatsOverview, SubjectStat } from '@shared/types'

/**
 * Everything here buckets by *local* calendar day via SQLite's `localtime` modifier —
 * timestamps are stored as UTC ISO strings, but "did I study today" is a question about
 * the user's own calendar, and the main process runs in their timezone.
 */

/** First local day of a window of `days` ending today (inclusive of both ends). */
function windowStart(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (Math.max(1, days) - 1))
  return localDay(d)
}

/**
 * Reviews and focus minutes per local day, for the activity heatmap. Only days with
 * something on them are returned; the renderer fills the calendar grid around them.
 */
export function activity(days = 182): ActivityDay[] {
  const from = windowStart(days)
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(reviews) AS reviews, SUM(focus_minutes) AS focus_minutes FROM (
         SELECT date(reviewed_at, 'localtime') AS day, COUNT(*) AS reviews, 0 AS focus_minutes
           FROM review_log
          WHERE date(reviewed_at, 'localtime') >= ?
          GROUP BY day
         UNION ALL
         SELECT date(started_at, 'localtime') AS day, 0 AS reviews, COALESCE(SUM(duration_minutes), 0) AS focus_minutes
           FROM focus_sessions
          WHERE completed = 1 AND date(started_at, 'localtime') >= ?
          GROUP BY day
       )
       GROUP BY day ORDER BY day`
    )
    .all(from, from) as ActivityDay[]
  return rows
}

/** Cards coming due over the next `days` local days, so "what's ahead" isn't a surprise. */
export function forecast(days = 14): ForecastDay[] {
  const rows = getDb()
    .prepare(
      `SELECT date(next_review_date, 'localtime') AS day, COUNT(*) AS due
         FROM flashcards
        WHERE next_review_date IS NOT NULL
        GROUP BY day ORDER BY day`
    )
    .all() as ForecastDay[]

  // Anything already overdue is work for today, not for the day it was scheduled.
  const today = localDay(new Date())
  const horizon = new Date()
  horizon.setDate(horizon.getDate() + Math.max(1, days) - 1)
  const last = localDay(horizon)

  const byDay = new Map<string, number>()
  for (const r of rows) {
    const day = r.day <= today ? today : r.day
    if (day > last) continue
    byDay.set(day, (byDay.get(day) ?? 0) + r.due)
  }

  const out: ForecastDay[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  for (let i = 0; i < Math.max(1, days); i++) {
    const key = localDay(cursor)
    out.push({ day: key, due: byDay.get(key) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export function statsOverview(windowDays = 30): StatsOverview {
  const db = getDb()
  const from = windowStart(windowDays)

  const reviews = (db.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE date(reviewed_at, 'localtime') >= ?`).get(from) as { n: number }).n
  const reviewsAllTime = (db.prepare(`SELECT COUNT(*) AS n FROM review_log`).get() as { n: number }).n

  // True retention: only cards that were already in review state were actually being
  // *recalled*. A new card's first answer and relearning steps aren't memory tests.
  const ret = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN rating > 1 THEN 1 ELSE 0 END) AS passed
         FROM review_log WHERE state = 'review' AND date(reviewed_at, 'localtime') >= ?`
    )
    .get(from) as { total: number; passed: number | null }

  const focus = (
    db
      .prepare(
        `SELECT COALESCE(SUM(duration_minutes), 0) AS m FROM focus_sessions
          WHERE completed = 1 AND date(started_at, 'localtime') >= ?`
      )
      .get(from) as { m: number }
  ).m

  const allActive = studyDays()
  const { current, longest } = streaksFrom(allActive)

  const cards = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) AS n_new,
              SUM(CASE WHEN state IN ('learning','relearning') THEN 1 ELSE 0 END) AS n_learning,
              SUM(CASE WHEN state = 'review' THEN 1 ELSE 0 END) AS n_review,
              AVG(stability) AS mean_stability,
              SUM(CASE WHEN next_review_date <= ? THEN 1 ELSE 0 END) AS due_now
         FROM flashcards`
    )
    .get(now()) as {
    total: number
    n_new: number | null
    n_learning: number | null
    n_review: number | null
    mean_stability: number | null
    due_now: number | null
  }

  return {
    window_days: windowDays,
    reviews,
    reviews_all_time: reviewsAllTime,
    retention: ret.total > 0 ? (ret.passed ?? 0) / ret.total : null,
    focus_minutes: focus,
    current_streak: current,
    longest_streak: longest,
    active_days: allActive.filter((d) => d >= from).length,
    cards_total: cards.total,
    cards_new: cards.n_new ?? 0,
    cards_learning: cards.n_learning ?? 0,
    cards_review: cards.n_review ?? 0,
    mean_stability: cards.mean_stability,
    due_now: cards.due_now ?? 0
  }
}

export function ratingBreakdown(windowDays = 30): RatingBreakdown {
  const row = getDb()
    .prepare(
      `SELECT SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS again,
              SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS hard,
              SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS good,
              SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS easy
         FROM review_log WHERE date(reviewed_at, 'localtime') >= ?`
    )
    .get(windowStart(windowDays)) as Record<keyof RatingBreakdown, number | null>
  return { again: row.again ?? 0, hard: row.hard ?? 0, good: row.good ?? 0, easy: row.easy ?? 0 }
}

/** Per-notebook study snapshot. Rows with no activity at all are left out. */
export function subjectStats(windowDays = 30): SubjectStat[] {
  const db = getDb()
  const from = windowStart(windowDays)
  const nowIso = now()

  const rows = db
    .prepare(
      `SELECT d.notebook_id AS notebook_id,
              COUNT(r.id) AS reviews,
              SUM(CASE WHEN r.state = 'review' THEN 1 ELSE 0 END) AS recall_total,
              SUM(CASE WHEN r.state = 'review' AND r.rating > 1 THEN 1 ELSE 0 END) AS recall_passed
         FROM review_log r
         JOIN flashcard_decks d ON d.id = r.deck_id
        WHERE date(r.reviewed_at, 'localtime') >= ?
        GROUP BY d.notebook_id`
    )
    .all(from) as Array<{ notebook_id: number; reviews: number; recall_total: number | null; recall_passed: number | null }>

  const focusRows = db
    .prepare(
      `SELECT d.notebook_id AS notebook_id, COALESCE(SUM(f.duration_minutes), 0) AS minutes
         FROM focus_sessions f
         JOIN flashcard_decks d ON d.id = f.deck_id
        WHERE f.completed = 1 AND date(f.started_at, 'localtime') >= ?
        GROUP BY d.notebook_id
        UNION ALL
       SELECT t.notebook_id AS notebook_id, COALESCE(SUM(f.duration_minutes), 0) AS minutes
         FROM focus_sessions f
         JOIN tasks t ON t.id = f.task_id
        WHERE f.completed = 1 AND date(f.started_at, 'localtime') >= ?
        GROUP BY t.notebook_id`
    )
    .all(from, from) as Array<{ notebook_id: number; minutes: number }>

  const dueRows = db
    .prepare(
      `SELECT d.notebook_id AS notebook_id, COUNT(*) AS due
         FROM flashcards c JOIN flashcard_decks d ON d.id = c.deck_id
        WHERE c.next_review_date <= ?
        GROUP BY d.notebook_id`
    )
    .all(nowIso) as Array<{ notebook_id: number; due: number }>

  const byId = new Map<number, SubjectStat>()
  const get = (id: number): SubjectStat => {
    let s = byId.get(id)
    if (!s) {
      s = { notebook_id: id, reviews: 0, retention: null, focus_minutes: 0, cards_due: 0 }
      byId.set(id, s)
    }
    return s
  }
  for (const r of rows) {
    const s = get(r.notebook_id)
    s.reviews = r.reviews
    s.retention = (r.recall_total ?? 0) > 0 ? (r.recall_passed ?? 0) / (r.recall_total as number) : null
  }
  for (const f of focusRows) get(f.notebook_id).focus_minutes += f.minutes
  for (const d of dueRows) get(d.notebook_id).cards_due = d.due
  return [...byId.values()].sort((a, b) => b.reviews - a.reviews)
}
