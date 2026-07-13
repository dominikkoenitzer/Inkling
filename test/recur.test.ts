import { describe, it, expect } from 'vitest'
import { byDayFromRule, makeWeeklyRule, expandEvents } from '../src/renderer/src/lib/recur'
import type { CalEvent } from '../src/shared/types'

const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: 1,
  notebook_id: 1,
  title: 'Class',
  start_time: '',
  end_time: null,
  recurrence_rule: null,
  linked_task_id: null,
  color: null,
  ...over
})

describe('byDayFromRule', () => {
  it('parses BYDAY codes from a weekly rule', () => {
    expect(byDayFromRule('WEEKLY;BYDAY=MO,WE,FR')).toEqual(['MO', 'WE', 'FR'])
  })
  it('returns [] for null or non-weekly rules', () => {
    expect(byDayFromRule(null)).toEqual([])
    expect(byDayFromRule('DAILY;BYDAY=MO')).toEqual([])
  })
})

describe('makeWeeklyRule', () => {
  it('normalizes day order (Sun→Sat) regardless of input order', () => {
    expect(makeWeeklyRule(['FR', 'MO', 'WE'])).toBe('WEEKLY;BYDAY=MO,WE,FR')
  })
  it('returns null when no days are selected', () => {
    expect(makeWeeklyRule([])).toBeNull()
  })
})

describe('expandEvents', () => {
  // Jan 5 2026 is a Monday; window is that whole week [Mon, next Mon).
  const from = new Date(2026, 0, 5, 0, 0, 0, 0)
  const to = new Date(2026, 0, 12, 0, 0, 0, 0)

  it('expands a weekly MO/WE/FR class onto exactly Mon, Wed, Fri', () => {
    const events = [
      ev({
        start_time: new Date(2026, 0, 5, 9, 0, 0, 0).toISOString(),
        end_time: new Date(2026, 0, 5, 10, 0, 0, 0).toISOString(),
        recurrence_rule: 'WEEKLY;BYDAY=MO,WE,FR'
      })
    ]
    const occ = expandEvents(events, from, to)
    expect(occ.map((o) => o.start.getDate())).toEqual([5, 7, 9])
    expect(occ.every((o) => o.start.getHours() === 9)).toBe(true)
    // each occurrence keeps the base duration (1h)
    expect(occ.every((o) => o.end.getTime() - o.start.getTime() === 60 * 60 * 1000)).toBe(true)
  })

  it('includes a one-off event that falls inside the window', () => {
    const events = [ev({ start_time: new Date(2026, 0, 6, 14, 0, 0, 0).toISOString() })]
    const occ = expandEvents(events, from, to)
    expect(occ).toHaveLength(1)
    expect(occ[0].start.getDate()).toBe(6)
  })

  it('excludes a one-off event outside the window', () => {
    const events = [ev({ start_time: new Date(2026, 0, 20, 14, 0, 0, 0).toISOString() })]
    expect(expandEvents(events, from, to)).toHaveLength(0)
  })
})
