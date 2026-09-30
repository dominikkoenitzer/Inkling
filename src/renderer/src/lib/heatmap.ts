import { localDayKey } from '@/stores/app'

export interface HeatmapDay {
  key: string
  date: Date
  /** Later this week than today: drawn as an empty slot, not as a day without study. */
  future: boolean
}

/**
 * The heatmap's calendar: `weeks` columns, Monday at the top, the last column being the
 * current week so today is always on it. The first cell is `weeks - 1` Mondays back, which
 * stays inside the `weeks * 7` days the activity query covers. Days are built from the
 * calendar date, never by adding 24 hours, so a DST change cannot skip or repeat a cell.
 */
export function heatmapColumns(weeks: number, now: Date = new Date()): HeatmapDay[][] {
  const y = now.getFullYear()
  const m = now.getMonth()
  const today = now.getDate()
  const weekday = (now.getDay() + 6) % 7 // 0 = Monday
  const first = today - weekday - (weeks - 1) * 7
  const cols: HeatmapDay[][] = []
  for (let c = 0; c < weeks; c++) {
    const col: HeatmapDay[] = []
    for (let r = 0; r < 7; r++) {
      const offset = first + c * 7 + r
      const date = new Date(y, m, offset)
      col.push({ key: localDayKey(date), date, future: offset > today })
    }
    cols.push(col)
  }
  return cols
}
