import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich'
})

import { daysBetween } from '../src/shared/fsrs'
import { storedTime } from '../src/shared/day'

// Cards carry review times in two forms: ISO from the app, and SQLite's own UTC form from the v4 migration.
describe('review times in either stored form', () => {
  const now = new Date('2026-10-23T12:00:00.000Z')

  it('runs in a zone away from UTC', () => {
    expect(now.getTimezoneOffset()).not.toBe(0)
  })

  it('measure the same span from a last review in either form', () => {
    expect(daysBetween('2026-10-22T12:00:00.000Z', now)).toBe(1)
    expect(daysBetween('2026-10-22 12:00:00', now)).toBe(1)
    expect(daysBetween('2026-10-22 12:00:00.500', now)).toBeCloseTo(1, 4)
  })

  it('read a due date as the same instant in either form', () => {
    const iso = Date.parse('2026-10-23T12:00:00.000Z')
    expect(storedTime('2026-10-23T12:00:00.000Z')).toBe(iso)
    expect(storedTime('2026-10-23 12:00:00')).toBe(iso)
    expect(storedTime('2026-10-23 12:00')).toBe(iso)
    expect(storedTime('not a date')).toBeNaN()
  })
})
