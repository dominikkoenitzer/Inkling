/** Rows are stamped in UTC; a "day" is the user's own calendar, see `localDay`. */

export { localDay } from '@shared/day'

/** Now, as the UTC ISO string every timestamp column stores. */
export const now = (): string => new Date().toISOString()
