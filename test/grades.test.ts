import { describe, it, expect } from 'vitest'
import { weightedPercentage, letterGrade, gpaPoints } from '../src/shared/grades'

describe('weightedPercentage', () => {
  it('averages equally-weighted items', () => {
    expect(weightedPercentage([{ score: 45, max: 50, weight: 1 }, { score: 80, max: 100, weight: 1 }])).toBeCloseTo(85)
  })
  it('respects weights', () => {
    // 100% at weight 3, 0% at weight 1 -> 75%
    expect(weightedPercentage([{ score: 10, max: 10, weight: 3 }, { score: 0, max: 10, weight: 1 }])).toBeCloseTo(75)
  })
  it('ignores items with non-positive max or weight, and returns null when empty', () => {
    expect(weightedPercentage([])).toBeNull()
    expect(weightedPercentage([{ score: 5, max: 0, weight: 1 }, { score: 5, max: 10, weight: 0 }])).toBeNull()
    expect(weightedPercentage([{ score: 9, max: 10, weight: 1 }, { score: 5, max: 0, weight: 1 }])).toBeCloseTo(90)
  })
})

describe('letterGrade', () => {
  it('maps percentages to letters at the boundaries', () => {
    expect(letterGrade(97)).toBe('A+')
    expect(letterGrade(93)).toBe('A')
    expect(letterGrade(90)).toBe('A-')
    expect(letterGrade(85)).toBe('B')
    expect(letterGrade(72)).toBe('C-')
    expect(letterGrade(59)).toBe('F')
    expect(letterGrade(0)).toBe('F')
  })
})

describe('gpaPoints', () => {
  it('maps to the 4.0 scale', () => {
    expect(gpaPoints(95)).toBe(4.0)
    expect(gpaPoints(91)).toBe(3.7)
    expect(gpaPoints(84)).toBe(3.0)
    expect(gpaPoints(50)).toBe(0.0)
  })
})
