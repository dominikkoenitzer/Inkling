/**
 * The two clocks this data layer works in.
 *
 * Rows are stamped in UTC so they sort and compare correctly wherever the file is
 * opened. Anything the user thinks of as "a day", though — a streak, a heatmap
 * square, "did I study today" — is a question about their own calendar, so the
 * stats and streak queries bucket with SQLite's `localtime` modifier and compare
 * against `localDay`. Re-exported here so both come from one import.
 */

export { localDay } from '@shared/streaks'

/** Now, as the UTC ISO string every timestamp column stores. */
export const now = (): string => new Date().toISOString()
