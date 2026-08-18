import { describe, expect, it } from 'vitest'

import { isLiveDay, localDay, streaksFrom } from '@shared/streaks'

/**
 * `today` is injected everywhere so these assertions mean the same thing in June as
 * in December. The dates are local-noon so the arithmetic is never one DST hour away
 * from the day it names.
 */
const at = (day: string): Date => new Date(`${day}T12:00:00`)

/** The `n` local days ending on `day`, oldest first. */
const runEndingOn = (day: string, n: number): string[] => {
  const out: string[] = []
  const cursor = at(day)
  cursor.setDate(cursor.getDate() - (n - 1))
  for (let i = 0; i < n; i++) {
    out.push(localDay(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

describe('localDay', () => {
  it('renders a local calendar day, zero-padded', () => {
    expect(localDay(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
    expect(localDay(new Date(2026, 11, 31, 12))).toBe('2026-12-31')
  })

  it('reports the local day, not the UTC one', () => {
    // 23:30 local on the 17th is already the 18th in UTC east of Greenwich. The
    // heatmap and the streak both mean the user's calendar, so this must say 17.
    expect(localDay(new Date(2026, 7, 17, 23, 30))).toBe('2026-08-17')
  })
})

describe('streaksFrom — counting', () => {
  const today = at('2026-08-17')

  it('reports nothing for no history', () => {
    expect(streaksFrom([], today)).toEqual({ current: 0, longest: 0 })
  })

  it('counts a single day of study as a streak of one', () => {
    expect(streaksFrom(['2026-08-17'], today)).toEqual({ current: 1, longest: 1 })
  })

  it('counts consecutive days', () => {
    expect(streaksFrom(runEndingOn('2026-08-17', 5), today)).toEqual({ current: 5, longest: 5 })
  })

  it('is not fooled by a duplicated day', () => {
    const days = [...runEndingOn('2026-08-17', 3), '2026-08-16', '2026-08-16']
    expect(streaksFrom(days, today).current).toBe(3)
  })

  it('does not care what order the days arrive in', () => {
    const days = runEndingOn('2026-08-17', 4)
    expect(streaksFrom([...days].reverse(), today)).toEqual(streaksFrom(days, today))
  })

  it('breaks the run at a gap', () => {
    // 10th–12th, nothing on the 13th, then 14th–17th.
    const days = [...runEndingOn('2026-08-12', 3), ...runEndingOn('2026-08-17', 4)]
    expect(streaksFrom(days, today)).toEqual({ current: 4, longest: 4 })
  })

  it('remembers a longer past run while a shorter one is live', () => {
    const days = [...runEndingOn('2026-07-20', 9), ...runEndingOn('2026-08-17', 2)]
    expect(streaksFrom(days, today)).toEqual({ current: 2, longest: 9 })
  })
})

describe('streaksFrom — the one-day grace', () => {
  const today = at('2026-08-17')

  it('keeps the streak alive when the last study day was yesterday', () => {
    // The point of the grace: at 9am you have not studied today *yet*, and the
    // number should not have already collapsed to zero.
    expect(streaksFrom(runEndingOn('2026-08-16', 6), today)).toEqual({ current: 6, longest: 6 })
  })

  it('ends the streak once a whole day has been missed', () => {
    expect(streaksFrom(runEndingOn('2026-08-15', 6), today)).toEqual({ current: 0, longest: 6 })
  })

  it('never reports a current streak longer than the longest', () => {
    const days = [...runEndingOn('2026-06-01', 4), ...runEndingOn('2026-08-16', 3)]
    const { current, longest } = streaksFrom(days, today)
    expect(current).toBeLessThanOrEqual(longest)
  })
})

describe('streaksFrom — calendar edges', () => {
  it('counts across the end of a month', () => {
    const today = at('2026-02-02')
    expect(streaksFrom(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'], today).current).toBe(4)
  })

  it('counts across the end of a year', () => {
    const today = at('2027-01-02')
    expect(streaksFrom(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], today).current).toBe(4)
  })

  it('counts through a leap day', () => {
    const today = at('2024-03-01')
    expect(streaksFrom(['2024-02-28', '2024-02-29', '2024-03-01'], today).current).toBe(3)
  })

  it('does not invent a leap day in a common year', () => {
    // Feb 28 and Mar 1 are consecutive in 2026 — nothing sits between them.
    const today = at('2026-03-01')
    expect(streaksFrom(['2026-02-28', '2026-03-01'], today).current).toBe(2)
  })
})

describe('isLiveDay', () => {
  const today = at('2026-08-17')

  it('accepts today and yesterday', () => {
    expect(isLiveDay('2026-08-17', today)).toBe(true)
    expect(isLiveDay('2026-08-16', today)).toBe(true)
  })

  it('rejects anything older, and anything in the future', () => {
    expect(isLiveDay('2026-08-15', today)).toBe(false)
    expect(isLiveDay('2026-08-18', today)).toBe(false)
  })

  it('looks back across a month boundary', () => {
    expect(isLiveDay('2026-07-31', at('2026-08-01'))).toBe(true)
  })

  it('looks back across a year boundary', () => {
    expect(isLiveDay('2026-12-31', at('2027-01-01'))).toBe(true)
  })
})
