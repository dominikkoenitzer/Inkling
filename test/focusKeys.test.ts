import { describe, it, expect } from 'vitest'
import { canTab } from '../src/renderer/src/lib/keys'

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
