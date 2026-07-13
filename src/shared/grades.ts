/** Pure grade math shared across processes. */

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
