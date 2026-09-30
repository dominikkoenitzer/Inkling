import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    focus: { start: vi.fn(async () => 7), complete: vi.fn(async () => undefined) },
    streak: { bump: vi.fn(async () => ({ count: 1, last_day: null as string | null })) }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useTimer, startFocusSession } from '../src/renderer/src/stores/timer'
import { useApp } from '../src/renderer/src/stores/app'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0, 0))
  useTimer.getState().reset()
  inkling.focus.complete.mockClear()
})

afterEach(() => {
  useTimer.getState().pause()
  vi.useRealTimers()
})

/** A throttled window: the clock moves on but only one interval callback gets to run. */
function throttle(ms: number): void {
  vi.setSystemTime(Date.now() + ms - 1000)
  vi.advanceTimersByTime(1000)
}

describe('focus timer', () => {
  it('counts down by the wall clock, not by how many ticks ran', async () => {
    await useTimer.getState().start(1)
    vi.advanceTimersByTime(5000)
    expect(useTimer.getState().secondsLeft).toBe(55)
    throttle(31_000)
    expect(useTimer.getState().secondsLeft).toBe(24)
  })

  it('finishes on time even when the window slept through the end', async () => {
    await useTimer.getState().start(1)
    throttle(90_000)
    const s = useTimer.getState()
    expect(s.secondsLeft).toBe(0)
    expect(s.running).toBe(false)
    expect(s.justFinished).toBe(true)
    expect(inkling.focus.complete).toHaveBeenCalledWith(7, 1)
  })

  it('does not count paused time', async () => {
    await useTimer.getState().start(1)
    vi.advanceTimersByTime(10_000)
    useTimer.getState().pause()
    vi.setSystemTime(Date.now() + 120_000)
    expect(useTimer.getState().secondsLeft).toBe(50)
    useTimer.getState().resume()
    throttle(20_000)
    expect(useTimer.getState().secondsLeft).toBe(30)
  })

  it('starts a 25-minute block from the palette or Today, and resumes a live one', async () => {
    useApp.setState({ tab: 'notes', selectedDeckId: 3 })
    startFocusSession()
    await vi.waitFor(() => expect(useTimer.getState().running).toBe(true))
    expect(useTimer.getState().totalSeconds).toBe(25 * 60)
    expect(useApp.getState().tab).toBe('study')
    expect(useApp.getState().selectedDeckId).toBeNull()

    vi.advanceTimersByTime(60_000)
    inkling.focus.start.mockClear()
    useApp.setState({ tab: 'today' })
    startFocusSession()
    expect(inkling.focus.start).not.toHaveBeenCalled()
    expect(useTimer.getState().secondsLeft).toBe(24 * 60)
    expect(useApp.getState().tab).toBe('study')
  })

  it('keeps breaks on the wall clock too', () => {
    useTimer.getState().startBreak(5)
    throttle(61_000)
    expect(useTimer.getState().secondsLeft).toBe(239)
  })
})
