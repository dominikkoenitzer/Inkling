/**
 * Two clocks: rows are stamped in UTC so they sort correctly anywhere, but a "day" (streak,
 * heatmap square) is the user's own calendar, so those queries bucket with `localtime` and
 * compare against `localDay`.
 */

export { localDay } from '@shared/streaks'

/** Now, as the UTC ISO string every timestamp column stores. */
export const now = (): string => new Date().toISOString()
