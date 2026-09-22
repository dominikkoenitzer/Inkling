/** Pure grade math shared across processes. */

export type GradingSystem = 'percent' | 'swiss'

/** The one list both grading-system pickers (Grades header, Settings) render from. */
export const GRADING_SYSTEM_OPTIONS: Array<{ value: GradingSystem; label: string; title: string }> = [
  { value: 'percent', label: '%', title: 'Percentages' },
  { value: 'swiss', label: '1–6', title: 'Swiss scale. 6 is best, 4 is a pass.' }
]

export interface GradeItem {
  score: number
  max: number
  weight: number
  /**
   * The system this row was entered under. "4/6" is ambiguous on its own (four points out
   * of six, or a Swiss 4?), so the row is always read under its own system, not the one
   * currently selected. Legacy rows may omit it; see the fallbacks below.
   */
  system?: GradingSystem
}

/** True when this row is a native Swiss 1–6 grade (score IS the grade), not a points entry. */
function isNativeSwiss(g: GradeItem): boolean {
  return g.system ? g.system === 'swiss' : g.max === 6
}

/**
 * One row as a percentage. A Swiss grade maps linearly (6 = 100%, 4 = 60%, 1 = 0%),
 * anything else is score/max. Null when there is nothing usable to divide by.
 */
export function itemPercent(g: GradeItem): number | null {
  if (g.system === 'swiss') {
    const grade = Math.min(6, Math.max(1, g.score))
    return ((grade - 1) / 5) * 100
  }
  if (!(g.max > 0)) return null
  return (g.score / g.max) * 100
}

/** Weighted percentage across rows, each read under its own system. Null when empty. */
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

/**
 * One row on the Swiss 1-6 scale. A Swiss row IS its grade; points convert via
 * grade = 1 + 5·(score/max). Keyed on the entry system, not on max === 6, which would also
 * match an ordinary six-point quiz.
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

/** One comparable number per subject. `value` ascends with performance, so min() is the weakest. */
export function subjectAverage(items: GradeItem[], system: GradingSystem): { value: number; display: string } | null {
  if (system === 'swiss') {
    const avg = weightedSwissGrade(items)
    if (avg === null) return null
    const g = swissRound(avg)
    return { value: g, display: g.toFixed(1) }
  }
  const pct = weightedPercentage(items)
  if (pct === null) return null
  // one decimal everywhere, matching the Grades header, so the same number never shows twice with different rounding
  const rounded = Math.round(pct * 10) / 10
  return { value: rounded, display: `${rounded.toFixed(1)}%` }
}
