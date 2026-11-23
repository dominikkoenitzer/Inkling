import { localDay, storedTime } from '@shared/day'

/** The day `offset` days from the local day `today` (`YYYY-MM-DD`), as a local day. */
function dayFrom(today: string, offset: number): string {
  const [y, m, d] = today.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + offset))
}

/**
 * The group a note last changed at `updatedAt` is listed under, seen on the local day `today`:
 * today, yesterday, earlier this week (from Monday), then its month, with the year when not this one.
 */
export function changedGroup(updatedAt: string, today: string): string {
  const time = storedTime(updatedAt)
  if (Number.isNaN(time)) return 'Earlier'
  const day = localDay(new Date(time))
  if (day >= today) return 'Today'
  if (day === dayFrom(today, -1)) return 'Yesterday'
  const [y, m, d] = today.split('-').map(Number)
  const sinceMonday = (new Date(y, m - 1, d).getDay() + 6) % 7
  if (day >= dayFrom(today, -sinceMonday)) return 'Earlier this week'
  const when = new Date(time)
  const month = when.toLocaleString('en', { month: 'long' })
  return when.getFullYear() === y ? month : `${month} ${when.getFullYear()}`
}

/** For each note in list order, the label to show above it when it starts a new group, else null. */
export function groupLabels(notes: Array<{ updated_at: string }>, today: string): Array<string | null> {
  let last: string | null = null
  return notes.map((n) => {
    const label = changedGroup(n.updated_at, today)
    if (label === last) return null
    last = label
    return label
  })
}
