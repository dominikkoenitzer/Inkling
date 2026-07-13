import { addDays, differenceInMilliseconds, isBefore, isSameDay, startOfDay } from 'date-fns'
import type { CalEvent } from '@shared/types'

export interface Occurrence {
  event: CalEvent
  start: Date
  end: Date
  key: string
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export function byDayFromRule(rule: string | null): string[] {
  if (!rule || !rule.startsWith('WEEKLY')) return []
  const m = rule.match(/BYDAY=([A-Z,]+)/)
  return m ? m[1].split(',') : []
}

export function makeWeeklyRule(days: string[]): string | null {
  if (days.length === 0) return null
  const ordered = DAY_CODES.filter((d) => days.includes(d))
  return `WEEKLY;BYDAY=${ordered.join(',')}`
}

/** Expand base events (incl. simplified weekly RRULEs) into concrete occurrences within [from, to). */
export function expandEvents(events: CalEvent[], from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = []
  for (const ev of events) {
    const baseStart = new Date(ev.start_time)
    const baseEnd = ev.end_time ? new Date(ev.end_time) : new Date(baseStart.getTime() + 60 * 60 * 1000)
    const duration = Math.max(differenceInMilliseconds(baseEnd, baseStart), 15 * 60 * 1000)
    const byday = byDayFromRule(ev.recurrence_rule)
    if (byday.length === 0) {
      if (baseStart < to && baseEnd > from) {
        out.push({ event: ev, start: baseStart, end: baseEnd, key: `${ev.id}` })
      }
      continue
    }
    let cursor = startOfDay(from)
    while (isBefore(cursor, to)) {
      const code = DAY_CODES[cursor.getDay()]
      if (byday.includes(code) && (isSameDay(cursor, baseStart) || cursor > baseStart)) {
        const start = new Date(cursor)
        start.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0)
        const end = new Date(start.getTime() + duration)
        if (start < to && end > from) {
          out.push({ event: ev, start, end, key: `${ev.id}:${start.toISOString().slice(0, 10)}` })
        }
      }
      cursor = addDays(cursor, 1)
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}
