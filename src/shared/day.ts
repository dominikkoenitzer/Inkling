/** A Date rendered as its local calendar day (`YYYY-MM-DD`), not its UTC one. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * A stored timestamp in milliseconds, NaN when unreadable. SQLite's own `YYYY-MM-DD HH:MM:SS`
 * form is UTC like the ISO one, though `Date.parse` would read it as local time.
 */
export function storedTime(value: string): number {
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)
  return Date.parse(sqlite ? `${value.replace(' ', 'T')}Z` : value)
}
