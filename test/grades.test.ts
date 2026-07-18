import { describe, it, expect } from 'vitest'
import { weightedPercentage, weightedSwissGrade, swissItemGrade, letterGrade, gpaPoints, swissRound, swissPass, subjectAverage } from '../src/shared/grades'

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

describe('swissItemGrade', () => {
  it('treats max=6 rows as grades and clamps them into the 1–6 band', () => {
    expect(swissItemGrade({ score: 5.5, max: 6, weight: 1 })).toBeCloseTo(5.5)
    expect(swissItemGrade({ score: 45, max: 6, weight: 1 })).toBe(6) // legacy bad row stays bounded
  })
  it('converts points-based rows via grade = 1 + 5·(score/max)', () => {
    expect(swissItemGrade({ score: 85, max: 100, weight: 1 })).toBeCloseTo(5.25)
    expect(swissItemGrade({ score: 45, max: 100, weight: 1 })).toBeCloseTo(3.25) // a failing percent row reads as failing
    expect(swissItemGrade({ score: 18, max: 20, weight: 1 })).toBeCloseTo(5.5)
  })
  it('returns null for rows with no usable max', () => {
    expect(swissItemGrade({ score: 5, max: 0, weight: 1 })).toBeNull()
  })
})

describe('weightedSwissGrade', () => {
  it('averages native Swiss grades directly', () => {
    expect(weightedSwissGrade([{ score: 5.5, max: 6, weight: 1 }, { score: 4.5, max: 6, weight: 1 }])).toBeCloseTo(5.0)
  })
  it('respects weights', () => {
    // 6 at double weight vs 3: (12 + 3) / 3 = 5
    expect(weightedSwissGrade([{ score: 6, max: 6, weight: 2 }, { score: 3, max: 6, weight: 1 }])).toBeCloseTo(5)
  })
  it('mixes converted percent rows with native grades instead of clamping to 6', () => {
    // 90/100 → 5.5, native 5.0 → average 5.25 (the old raw-score average would have been ~47.5 → clamped 6)
    expect(weightedSwissGrade([{ score: 90, max: 100, weight: 1 }, { score: 5, max: 6, weight: 1 }])).toBeCloseTo(5.25)
  })
  it('ignores non-positive weights and returns null when empty', () => {
    expect(weightedSwissGrade([])).toBeNull()
    expect(weightedSwissGrade([{ score: 5, max: 6, weight: 0 }])).toBeNull()
    expect(weightedSwissGrade([{ score: 5, max: 6, weight: 1 }, { score: 1, max: 6, weight: -2 }])).toBeCloseTo(5)
  })
})

describe('swissRound / swissPass', () => {
  it('rounds to one decimal and clamps to the 1–6 band', () => {
    expect(swissRound(5.2499)).toBeCloseTo(5.2)
    expect(swissRound(5.25)).toBeCloseTo(5.3)
    expect(swissRound(7)).toBe(6)
    expect(swissRound(0.5)).toBe(1)
  })
  it('passes at 4.0 and above', () => {
    expect(swissPass(4)).toBe(true)
    expect(swissPass(3.9)).toBe(false)
    expect(swissPass(6)).toBe(true)
  })
})

describe('subjectAverage', () => {
  const items = [{ score: 5, max: 6, weight: 1 }, { score: 6, max: 6, weight: 1 }]
  it('returns the Swiss grade in swiss mode', () => {
    expect(subjectAverage(items, 'swiss')).toEqual({ value: 5.5, display: '5.5' })
  })
  it('returns a percentage in percent mode', () => {
    const r = subjectAverage(items, 'percent')
    expect(r?.value).toBeCloseTo(91.7)
    expect(r?.display).toBe('91.7%')
  })
  it('returns a letter in us mode with a comparable percent value', () => {
    const r = subjectAverage(items, 'us')
    expect(r?.display).toBe('A-')
    expect(r?.value).toBeCloseTo(91.7)
  })
  it('returns null with nothing to average', () => {
    expect(subjectAverage([], 'swiss')).toBeNull()
    expect(subjectAverage([], 'us')).toBeNull()
  })
})
