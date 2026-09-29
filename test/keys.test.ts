import { describe, expect, it } from 'vitest'
import { ignoresShortcut } from '../src/renderer/src/lib/keys'

/** Just enough of a keydown event and its target to stand in for the DOM. */
const key = (target: object | null, defaultPrevented = false): { target: EventTarget | null; defaultPrevented: boolean } => ({
  target: target as EventTarget | null,
  defaultPrevented
})

describe('ignoresShortcut', () => {
  it('lets a key through when nothing else claims it', () => {
    expect(ignoresShortcut(key({ tagName: 'BODY' }), false)).toBe(false)
    expect(ignoresShortcut(key({ tagName: 'BUTTON' }), false)).toBe(false)
    expect(ignoresShortcut(key(null), false)).toBe(false)
  })

  it('leaves typing in a field alone', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(ignoresShortcut(key({ tagName }), false)).toBe(true)
    }
    expect(ignoresShortcut(key({ tagName: 'DIV', isContentEditable: true }), false)).toBe(true)
  })

  it('stands back while an overlay is open', () => {
    expect(ignoresShortcut(key({ tagName: 'BODY' }), true)).toBe(true)
  })

  it('stands back when another handler already took the key', () => {
    expect(ignoresShortcut(key({ tagName: 'BODY' }, true), false)).toBe(true)
  })
})
