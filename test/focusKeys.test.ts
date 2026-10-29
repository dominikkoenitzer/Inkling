import { describe, it, expect } from 'vitest'
import { canTab, endsReview, nextRow, reviewKey } from '../src/renderer/src/lib/keys'

const el = (tabIndex: number, extra: { disabled?: boolean; inert?: boolean } = {}): Parameters<typeof canTab>[0] => ({
  tabIndex,
  disabled: extra.disabled,
  closest: (s: string) => (s === '[inert]' && extra.inert ? {} : null)
})

describe('canTab', () => {
  it('takes what Tab can reach', () => {
    expect(canTab(el(0))).toBe(true)
  })

  it('skips disabled, inert and out of order elements, so the last stop is a real one', () => {
    expect(canTab(el(0, { disabled: true }))).toBe(false)
    expect(canTab(el(0, { inert: true }))).toBe(false)
    expect(canTab(el(-1))).toBe(false)
  })
})

describe('nextRow', () => {
  it('moves one row down or up and stops at the ends', () => {
    expect(nextRow(1, 3, 'ArrowDown')).toBe(2)
    expect(nextRow(1, 3, 'ArrowUp')).toBe(0)
    expect(nextRow(2, 3, 'ArrowDown')).toBe(2)
    expect(nextRow(0, 3, 'ArrowUp')).toBe(0)
  })

  it('leaves other keys and focus outside the rows alone', () => {
    expect(nextRow(1, 3, 'Enter')).toBeNull()
    expect(nextRow(-1, 3, 'ArrowDown')).toBeNull()
  })
})

describe('endsReview', () => {
  const on = (key: string, tagName = 'BODY'): Parameters<typeof endsReview>[0] => ({ key, target: { tagName } as unknown as EventTarget })

  it('takes Escape and Enter on the last screen', () => {
    expect(endsReview(on('Escape'))).toBe(true)
    expect(endsReview(on('Enter'))).toBe(true)
  })

  it('leaves Enter on a button to that button, and other keys alone', () => {
    expect(endsReview(on('Enter', 'BUTTON'))).toBe(false)
    expect(endsReview(on(' '))).toBe(false)
    expect(endsReview(on('1'))).toBe(false)
  })
})

describe('reviewKey', () => {
  const on = (key: string, tagName = 'BODY'): Parameters<typeof reviewKey>[0] => ({ key, target: { tagName } as unknown as EventTarget })

  it('shows the answer on Space or Enter, and grades nothing before that', () => {
    expect(reviewKey(on(' '), false)).toBe('reveal')
    expect(reviewKey(on('Enter'), false)).toBe('reveal')
    expect(reviewKey(on('3'), false)).toBe(null)
  })

  it('grades Good on Enter once the answer shows, and 1 to 4 pick a grade', () => {
    expect(reviewKey(on('Enter'), true)).toBe('good')
    expect(reviewKey(on('1'), true)).toBe('again')
    expect(reviewKey(on('4'), true)).toBe('easy')
    expect(reviewKey(on('5'), true)).toBe(null)
  })

  it('stops on Esc and leaves Enter on a button to that button', () => {
    expect(reviewKey(on('Escape'), false)).toBe('finish')
    expect(reviewKey(on('Enter', 'BUTTON'), false)).toBe(null)
    expect(reviewKey(on('Enter', 'BUTTON'), true)).toBe(null)
  })
})
