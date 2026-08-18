import { getDb } from '../db'
import { getSetting, setSetting } from './settings'
import { isLiveDay, streaksFrom } from '@shared/streaks'
import type { StreakInfo } from '@shared/types'

/**
 * Gentle streak, derived from what you actually did.
 *
 * Through v0.3.x this was two counters in `settings`, bumped when the app happened to be
 * open at the right moment — which meant the user bar and any other reader could disagree,
 * and a study session that ended without a bump vanished. Since v0.4.0 the review log and
 * focus history are the record, so the streak is computed from them and there is exactly
 * one answer. The old counter is still honoured while it's live, so nobody upgrading loses
 * a streak they earned before there was any history to derive it from.
 *
 * The counting itself is in `@shared/streaks`, with no database behind it, so the rules
 * that are easy to get wrong are covered by tests.
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
 * Called after a review session or focus block. The history row is already written by the
 * time this runs, so there is nothing to increment — it just re-reads the truth. The legacy
 * counters are kept in step so a downgrade to v0.3.x still finds a sane streak.
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
