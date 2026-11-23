import { describe, it, expect } from 'vitest'
import { reviewDone, reviewPosition } from '../src/renderer/src/lib/review'

describe('reviewPosition', () => {
  it('counts the card on screen from one', () => {
    expect(reviewPosition(0, 2)).toBe(1)
    expect(reviewPosition(1, 2)).toBe(2)
  })

  it('stays on the last card once the session is through', () => {
    expect(reviewPosition(2, 2)).toBe(2)
  })

  it('says nothing for an empty session', () => {
    expect(reviewPosition(0, 0)).toBe(0)
  })
})

describe('reviewDone', () => {
  it('fills the bar with the cards graded so far', () => {
    expect(reviewDone(0, 2)).toBe(0)
    expect(reviewDone(1, 2)).toBe(0.5)
    expect(reviewDone(2, 2)).toBe(1)
    expect(reviewDone(0, 0)).toBe(0)
  })
})
