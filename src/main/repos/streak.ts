import { getDb } from '../db'
import { getSetting, setSetting } from './settings'
import { isLiveDay, streaksFrom } from '@shared/streaks'
import type { StreakInfo } from '@shared/types'

/**
 * The streak is computed from the review and focus history, not from a counter, so it is
 * right even if the app was never open on a day you studied. Pre-v0.4.0 counters in
 * `settings` are still honoured while they are ahead. Counting lives in `@shared/streaks`.
 */
export function getStreak(): StreakInfo {
  const days = studyDays()
  const derived = streaksFrom(days)
  const legacyCount = Number(getSetting('streak_count') ?? '0')
  const legacyDay = getSetting('streak_last_day')

  if (derived.current === 0 && legacyCount > 0 && legacyDay && isLiveDay(legacyDay)) {
    return { count: legacyCount, last_day: legacyDay }
  }
  return { count: derived.current, last_day: days.at(-1) ?? legacyDay }
}

/**
 * Called after a review session or focus block. The history row already exists, so this
 * only re-reads it; the legacy counters are kept in step for a downgrade.
 */
export function bumpStreak(fallbackDay: string): StreakInfo {
  const info = getStreak()
  setSetting('streak_count', String(info.count))
  setSetting('streak_last_day', info.last_day ?? fallbackDay)
  return info
}

/** Every local day with a review or a completed focus session, ascending. */
export function studyDays(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT day FROM (
           SELECT date(reviewed_at, 'localtime') AS day FROM review_log
           UNION
           SELECT date(started_at, 'localtime') AS day FROM focus_sessions WHERE completed = 1 AND duration_minutes > 0
         ) ORDER BY day`
      )
      .all() as Array<{ day: string }>
  ).map((r) => r.day)
}
