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
  /**
   * The grading system this row was entered under. score/max is ambiguous on its own
   * (is "4/6" four-out-of-six points, or a native Swiss grade of 4?), so every row now
   * records how it was entered and is interpreted that way regardless of the system the
   * viewer has selected. Legacy rows may omit it; see the fallbacks below.
   */
  system?: GradingSystem
}

/** True when this row is a native Swiss 1–6 grade (score IS the grade), not a points entry. */
function isNativeSwiss(g: GradeItem): boolean {
  return g.system ? g.system === 'swiss' : g.max === 6
}

/**
 * A single row as a percentage (0–100), read under the system it was entered in.
 * A native Swiss grade maps linearly (6→100%, 4 = pass → 60%, 1→0%); everything else
 * is score/max. Returns null when there is nothing usable to divide by.
 */
export function itemPercent(g: GradeItem): number | null {
  if (g.system === 'swiss') {
    const grade = Math.min(6, Math.max(1, g.score))
    return ((grade - 1) / 5) * 100
  }
  if (!(g.max > 0)) return null
  return (g.score / g.max) * 100
}

/**
 * Weighted percentage (0–100) across grade items, each read under its own entry system.
 * Items with nothing usable to average, or non-positive weight, are ignored. Returns null
 * when there is nothing valid to average.
 */
export function weightedPercentage(items: GradeItem[]): number | null {
  let num = 0
  let den = 0
  for (const g of items) {
    if (!(g.weight > 0)) continue
    const p = itemPercent(g)
    if (p === null) continue
    num += g.weight * p
    den += g.weight
  }
  if (den === 0) return null
  return num / den
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
 * A single row's value on the Swiss 1–6 scale (6 best, 4 = pass). A row entered in Swiss
 * mode IS its grade; any other entry is points-based and converts via the official mapping
 * grade = 1 + 5·(score/max). Keying on the entry system (not on max === 6, which also matches
 * an ordinary 6-point quiz) is what keeps a system switch from silently reinterpreting rows.
 */
export function swissItemGrade(g: GradeItem): number | null {
  if (isNativeSwiss(g)) return Math.min(6, Math.max(1, g.score))
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
