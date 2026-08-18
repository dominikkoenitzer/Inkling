/**
 * Streak arithmetic over local calendar days.
 *
 * Pure on purpose: the counting rules are the part that is easy to get subtly
 * wrong (month ends, leap days, the "yesterday still counts" grace), so they
 * live here with no database and no Electron behind them, where the test suite
 * can reach them. `repos/streak.ts` supplies the days from the review and focus
 * history and does nothing but call in.
 */

/** A Date rendered as its local calendar day (`YYYY-MM-DD`), not its UTC one. */
export const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The day before `day`, computed at local noon so a DST shift cannot move it. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return localDay(d)
}

/**
 * Current and longest run of consecutive local days with any activity. Derived from the
 * review/focus history rather than the two counters in `settings`, so it stays true even
 * if the app never ran on a day you studied — and it can look backwards, which counters
 * can't.
 *
 * A run only counts as *current* if it reaches today or yesterday: one missed day
 * shouldn't zero the number before the user has had a chance to study.
 */
export function streaksFrom(activeDays: readonly string[], today: Date = new Date()): { current: number; longest: number } {
  if (activeDays.length === 0) return { current: 0, longest: 0 }
  const set = new Set(activeDays)

  let longest = 0
  for (const day of set) {
    if (set.has(dayBefore(day))) continue // not the start of a run
    let run = 0
    const cursor = new Date(`${day}T12:00:00`)
    while (set.has(localDay(cursor))) {
      run++
      cursor.setDate(cursor.getDate() + 1)
    }
    if (run > longest) longest = run
  }

  const start = new Date(today)
  start.setHours(12, 0, 0, 0)
  let anchor: Date | null = null
  if (set.has(localDay(start))) anchor = start
  else {
    const yesterday = new Date(start)
    yesterday.setDate(yesterday.getDate() - 1)
    if (set.has(localDay(yesterday))) anchor = yesterday
  }

  let current = 0
  if (anchor) {
    const cursor = new Date(anchor)
    while (set.has(localDay(cursor))) {
      current++
      cursor.setDate(cursor.getDate() - 1)
    }
  }
  return { current, longest }
}

/** A stored streak still counts if its last day is today or yesterday. */
export function isLiveDay(day: string, today: Date = new Date()): boolean {
  const start = new Date(today)
  start.setHours(12, 0, 0, 0)
  return day === localDay(start) || day === dayBefore(localDay(start))
}
