import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich'
  ;(globalThis as unknown as { window: unknown }).window = { inkling: {} }
})

import { heatmapColumns } from '../src/renderer/src/lib/heatmap'
import { localDayKey } from '../src/renderer/src/stores/app'

const WEEKS = 27

/** First local day of a `days` window ending today, as the main process computes it. */
function windowStart(days: number, now: Date): string {
  return localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)))
}

describe('heatmapColumns', () => {
  it('runs in Europe/Zurich, so the DST cases below are real', () => {
    expect(new Date(2026, 9, 24, 12).getTimezoneOffset()).toBe(-120)
    expect(new Date(2026, 9, 26, 12).getTimezoneOffset()).toBe(-60)
  })

  // 2026-09-28 is a Monday; walk the whole week, just after midnight, at noon and late.
  for (let i = 0; i < 7; i++) {
    for (const hour of [0, 12, 23]) {
      const now = new Date(2026, 8, 28 + i, hour, 30)
      it(`puts today in the last column on ${localDayKey(now)} ${hour}:30`, () => {
        const cols = heatmapColumns(WEEKS, now)
        expect(cols).toHaveLength(WEEKS)
        const last = cols[WEEKS - 1]
        expect(last[0].date.getDay()).toBe(1)
        expect(last[i].key).toBe(localDayKey(now))
        last.forEach((d, r) => expect(d.future).toBe(r > i))
        expect(cols.flat().filter((d) => d.future)).toHaveLength(6 - i)
        expect(cols[0][0].key >= windowStart(WEEKS * 7, now)).toBe(true)
      })
    }
  }

  it('keeps one cell per calendar day across both 2026 DST changes', () => {
    for (const now of [new Date(2026, 9, 25, 12), new Date(2026, 9, 26, 1), new Date(2026, 2, 29, 12), new Date(2026, 2, 30, 1)]) {
      const days = heatmapColumns(WEEKS, now).flat()
      expect(new Set(days.map((d) => d.key)).size).toBe(WEEKS * 7)
      for (let k = 1; k < days.length; k++) {
        const a = days[k - 1].date
        const b = days[k].date
        expect(Math.round((b.getTime() - a.getTime()) / 86_400_000)).toBe(1)
        expect(b.getHours()).toBe(0)
      }
      expect(days.find((d) => d.key === localDayKey(now))?.future).toBe(false)
      expect(days[0].key >= windowStart(WEEKS * 7, now)).toBe(true)
    }
  })
})
