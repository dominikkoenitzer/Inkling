/** A Date rendered as its local calendar day (`YYYY-MM-DD`), not its UTC one. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Local midnight of the day `d` falls on: the most Inkling keeps of when something was done. */
export function startOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Local midnight `days` calendar days after the day `d` falls on. */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
}

/** The day `d` falls on, as the UTC ISO string rows are stamped with. */
export function dayStamp(d: Date = new Date()): string {
  return startOfDay(d).toISOString()
}

/** Whole calendar days from the day of `from` to the day of `to`. */
export function daysApart(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

/**
 * A stored timestamp in milliseconds, NaN when unreadable. SQLite's own `YYYY-MM-DD HH:MM:SS`
 * form is UTC like the ISO one, though `Date.parse` would read it as local time.
 */
export function storedTime(value: string): number {
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)
  return Date.parse(sqlite ? `${value.replace(' ', 'T')}Z` : value)
}
