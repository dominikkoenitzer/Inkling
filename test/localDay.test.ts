import { describe, expect, it } from 'vitest'

import { localDay } from '@shared/day'

describe('localDay', () => {
  it('renders a local calendar day, zero-padded', () => {
    expect(localDay(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
    expect(localDay(new Date(2026, 11, 31, 12))).toBe('2026-12-31')
  })

  it('reports the local day, not the UTC one', () => {
    // 23:30 local on the 17th is already the 18th in UTC east of Greenwich, so this must say 17.
    expect(localDay(new Date(2026, 7, 17, 23, 30))).toBe('2026-08-17')
  })
})
