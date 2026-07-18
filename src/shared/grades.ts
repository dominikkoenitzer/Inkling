/** Pure grade math shared across processes. */

export type GradingSystem = 'percent' | 'us' | 'swiss'

/** The one list both grading-system pickers (Grades header, Settings) render from. */
export const GRADING_SYSTEM_OPTIONS: Array<{ value: GradingSystem; label: string; title: string }> = [
  { value: 'percent', label: '%', title: 'Percentages' },
  { value: 'us', label: 'A–F', title: 'US letters + 4.0 GPA' },
  { value: 'swiss', label: '1–6', title: 'Swiss scale. 6 is best, 4 is a pass.' }
]

export interface GradeItem {
  score: number
  max: number
  weight: number
}

/**
 * Weighted percentage (0–100) across grade items. Items with a non-positive max or
 * weight are ignored. Returns null when there is nothing valid to average.
 */
export function weightedPercentage(items: GradeItem[]): number | null {
  let num = 0
  let den = 0
  for (const g of items) {
    if (!(g.max > 0) || !(g.weight > 0)) continue
    num += g.weight * (g.score / g.max)
    den += g.weight
  }
  if (den === 0) return null
  return (num / den) * 100
}

const LETTERS: Array<[number, string]> = [
  [97, 'A+'],
  [93, 'A'],
  [90, 'A-'],
  [87, 'B+'],
  [83, 'B'],
  [80, 'B-'],
  [77, 'C+'],
  [73, 'C'],
  [70, 'C-'],
  [67, 'D+'],
  [63, 'D'],
  [60, 'D-']
]

export function letterGrade(pct: number): string {
  for (const [min, letter] of LETTERS) if (pct >= min) return letter
  return 'F'
}

/**
 * A single row's value on the Swiss 1–6 scale (6 best, 4 = pass). Rows entered in
 * Swiss mode store max = 6 and score = the grade itself; any other max is a
 * points-based entry and converts via the official mapping grade = 1 + 5·(score/max),
 * so data entered under another system still reads sanely after a switch.
 */
export function swissItemGrade(g: GradeItem): number | null {
  if (g.max === 6) return Math.min(6, Math.max(1, g.score))
  if (!(g.max > 0)) return null
  return Math.min(6, Math.max(1, 1 + 5 * (g.score / g.max)))
}

/** Weighted average on the Swiss scale. Returns null when nothing valid to average. */
export function weightedSwissGrade(items: GradeItem[]): number | null {
  let num = 0
  let den = 0
  for (const g of items) {
    if (!(g.weight > 0)) continue
    const grade = swissItemGrade(g)
    if (grade === null) continue
    num += g.weight * grade
    den += g.weight
  }
  if (den === 0) return null
  return num / den
}

/** Round a Swiss grade to one decimal, clamped to the 1–6 band. */
export function swissRound(grade: number): number {
  return Math.min(6, Math.max(1, Math.round(grade * 10) / 10))
}

export function swissPass(grade: number): boolean {
  return grade >= 4
}

/**
 * One comparable number per subject in the chosen system plus a compact display string.
 * `value` ascends with performance in every system, so min() finds the weakest subject.
 */
export function subjectAverage(items: GradeItem[], system: GradingSystem): { value: number; display: string } | null {
  if (system === 'swiss') {
    const avg = weightedSwissGrade(items)
    if (avg === null) return null
    const g = swissRound(avg)
    return { value: g, display: g.toFixed(1) }
  }
  const pct = weightedPercentage(items)
  if (pct === null) return null
  const rounded = Math.round(pct * 10) / 10
  // one decimal everywhere, matching the Grades header, so the same number never shows twice with different rounding
  return system === 'us' ? { value: rounded, display: letterGrade(rounded) } : { value: rounded, display: `${rounded.toFixed(1)}%` }
}

/** 4.0-scale GPA points from a percentage (standard US mapping). */
export function gpaPoints(pct: number): number {
  const table: Array<[number, number]> = [
    [93, 4.0],
    [90, 3.7],
    [87, 3.3],
    [83, 3.0],
    [80, 2.7],
    [77, 2.3],
    [73, 2.0],
    [70, 1.7],
    [67, 1.3],
    [63, 1.0],
    [60, 0.7]
  ]
  for (const [min, pts] of table) if (pct >= min) return pts
  return 0.0
}
