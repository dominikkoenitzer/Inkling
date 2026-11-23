import { describe, expect, it } from 'vitest'

import { changedGroup, groupLabels } from '../src/renderer/src/lib/noteGroups'

// A stored timestamp for local noon on that day, so the test holds in every time zone.
const at = (y: number, m: number, d: number, h = 12): string => new Date(y, m - 1, d, h).toISOString()

describe('changedGroup', () => {
  // Wednesday 25 November 2026.
  const today = '2026-11-25'

  it('names today, yesterday and the rest of this week', () => {
    expect(changedGroup(at(2026, 11, 25), today)).toBe('Today')
    expect(changedGroup(at(2026, 11, 25, 0), today)).toBe('Today')
    expect(changedGroup(at(2026, 11, 24, 23), today)).toBe('Yesterday')
    expect(changedGroup(at(2026, 11, 23, 0), today)).toBe('Earlier this week')
  })

  it('puts the days before Monday under their month', () => {
    expect(changedGroup(at(2026, 11, 22, 23), today)).toBe('November')
    expect(changedGroup(at(2026, 10, 5), today)).toBe('October')
    expect(changedGroup(at(2026, 1, 1), today)).toBe('January')
  })

  it('adds the year to a month of another year', () => {
    expect(changedGroup(at(2025, 11, 30), today)).toBe('November 2025')
  })

  it('on a Monday, has no earlier days this week', () => {
    expect(changedGroup(at(2026, 11, 22), '2026-11-23')).toBe('Yesterday')
    expect(changedGroup(at(2026, 11, 21), '2026-11-23')).toBe('November')
  })

  it('on a Sunday, counts back to Monday', () => {
    expect(changedGroup(at(2026, 11, 23), '2026-11-29')).toBe('Earlier this week')
    expect(changedGroup(at(2026, 11, 22), '2026-11-29')).toBe('November')
  })

  it('crosses the turn of the year', () => {
    expect(changedGroup(at(2026, 12, 31), '2027-01-01')).toBe('Yesterday')
    expect(changedGroup(at(2026, 12, 28), '2027-01-01')).toBe('Earlier this week')
    expect(changedGroup(at(2026, 12, 20), '2027-01-01')).toBe('December 2026')
  })

  it('reads the database form of a timestamp as UTC', () => {
    const stored = new Date(2026, 10, 24, 12).toISOString().replace('T', ' ').slice(0, 19)
    expect(changedGroup(stored, today)).toBe('Yesterday')
  })

  it('lists a clock set ahead under today, and an unreadable date last', () => {
    expect(changedGroup(at(2026, 12, 2), today)).toBe('Today')
    expect(changedGroup('not a date', today)).toBe('Earlier')
  })
})

describe('groupLabels', () => {
  const today = '2026-11-25'

  it('labels only the first note of each group, keeping the list order', () => {
    const notes = [at(2026, 11, 25, 15), at(2026, 11, 25, 9), at(2026, 11, 24), at(2026, 11, 2), at(2026, 10, 30), at(2026, 10, 1)].map(
      (updated_at) => ({ updated_at })
    )
    expect(groupLabels(notes, today)).toEqual(['Today', null, 'Yesterday', 'November', 'October', null])
  })

  it('gives each note the same label every time', () => {
    const notes = [at(2026, 11, 25), at(2026, 11, 25)].map((updated_at) => ({ updated_at }))
    expect(groupLabels(notes, today)).toEqual(groupLabels(notes, today))
    expect(groupLabels([], today)).toEqual([])
  })
})
