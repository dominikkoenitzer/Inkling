import { getDb } from '../db'
import { localDay, now } from './dates'
import { studyDays } from './streak'
import { streaksFrom } from '@shared/streaks'
import type { ActivityDay, StatsOverview } from '@shared/types'

/**
 * Everything here buckets by local calendar day via SQLite's `localtime` modifier,
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

  const dueNow = (
    db.prepare(`SELECT COUNT(*) AS n FROM flashcards WHERE next_review_date <= ?`).get(now()) as { n: number }
  ).n

  return {
    window_days: windowDays,
    reviews,
    reviews_all_time: reviewsAllTime,
    retention: ret.total > 0 ? (ret.passed ?? 0) / ret.total : null,
    focus_minutes: focus,
    current_streak: current,
    longest_streak: longest,
    active_days: allActive.filter((d) => d >= from).length,
    due_now: dueNow
  }
}
