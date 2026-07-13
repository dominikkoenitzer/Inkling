import { describe, it, expect } from 'vitest'
import { isColorKey, ramp, accentVars, stickyColors, COLOR_KEYS, RAMPS } from '../src/renderer/src/lib/colors'

describe('isColorKey', () => {
  it('accepts the five brand keys and rejects anything else', () => {
    expect(COLOR_KEYS).toHaveLength(5)
    for (const k of COLOR_KEYS) expect(isColorKey(k)).toBe(true)
    expect(isColorKey('rainbow')).toBe(false)
    expect(isColorKey(null)).toBe(false)
    expect(isColorKey(undefined)).toBe(false)
  })
})

describe('ramp', () => {
  it('returns the ramp for a known key', () => {
    expect(ramp('coral')).toBe(RAMPS.coral)
  })
  it('falls back to teal for unknown/empty keys', () => {
    expect(ramp('nope')).toBe(RAMPS.teal)
    expect(ramp(null)).toBe(RAMPS.teal)
  })
  it('every ramp has the full 50→900 scale', () => {
    for (const key of COLOR_KEYS) {
      const stops = Object.keys(RAMPS[key]).map(Number).sort((a, b) => a - b)
      expect(stops).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900])
    }
  })
})

describe('accentVars', () => {
  it('uses theme-specific soft/text tokens so contrast holds', () => {
    const dark = accentVars('teal', 'dark') as Record<string, string>
    const cozy = accentVars('teal', 'cozy') as Record<string, string>
    expect(dark['--accent']).toBe(RAMPS.teal[500])
    expect(cozy['--accent']).toBe(RAMPS.teal[500])
    // dark leans on a translucent soft + lighter text; cozy uses solid light/dark stops
    expect(dark['--accent-text']).toBe(RAMPS.teal[300])
    expect(cozy['--accent-text']).toBe(RAMPS.teal[700])
    expect(dark['--accent-soft']).not.toBe(cozy['--accent-soft'])
  })
})

describe('stickyColors', () => {
  it('inverts fill/text between dark and cozy themes', () => {
    const dark = stickyColors('pink', 'dark')
    const cozy = stickyColors('pink', 'cozy')
    expect(dark.bg).toBe(RAMPS.pink[900])
    expect(cozy.bg).toBe(RAMPS.pink[100])
  })
})
