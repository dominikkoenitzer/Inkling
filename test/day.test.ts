import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich'
  ;(globalThis as unknown as { window: unknown }).window = { inkling: {} }
})

import { useApp, watchDay, msUntilNextLocalDay } from '../src/renderer/src/stores/app'
import { localDay } from '@shared/day'

describe('msUntilNextLocalDay', () => {
  it('counts to the next local midnight, 25 hours on the night clocks go back', () => {
    expect(msUntilNextLocalDay(new Date(2026, 8, 30, 23, 0))).toBe(3_600_000)
    expect(msUntilNextLocalDay(new Date(2026, 9, 25, 0, 0))).toBe(25 * 3_600_000)
    expect(msUntilNextLocalDay(new Date(2026, 2, 29, 0, 0))).toBe(23 * 3_600_000)
  })
})

describe('watchDay', () => {
  const target = new EventTarget()
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 24, 23, 59, 0))
    useApp.setState({ today: localDay() })
    stop = watchDay(target)
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('rolls "today" over at local midnight', async () => {
    expect(useApp.getState().today).toBe('2026-10-24')
    await vi.advanceTimersByTimeAsync(61_000)
    expect(useApp.getState().today).toBe('2026-10-25')
  })

  it('keeps rolling over on the 25-hour DST day', async () => {
    await vi.advanceTimersByTimeAsync(61_000 + 25 * 3_600_000)
    expect(useApp.getState().today).toBe('2026-10-26')
  })

  it('catches up on focus after the machine slept through midnight', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 8, 0))
    target.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(useApp.getState().today).toBe('2026-10-25')
  })
})
