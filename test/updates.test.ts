import { describe, expect, it } from 'vitest'
import { updatesItself } from '../src/main/updates'

describe('updatesItself', () => {
  it('updates a packaged build on Windows and Linux', () => {
    expect(updatesItself('win32', true)).toBe(true)
    expect(updatesItself('linux', true)).toBe(true)
  })

  it('leaves the Mac alone, where an unsigned app cannot install its own update', () => {
    expect(updatesItself('darwin', true)).toBe(false)
  })

  it('never updates a development build', () => {
    expect(updatesItself('win32', false)).toBe(false)
  })
})
