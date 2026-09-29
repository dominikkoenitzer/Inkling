import { describe, expect, it } from 'vitest'
import { ignoresShortcut, onActivateKey } from '../src/renderer/src/lib/keys'

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

describe('onActivateKey', () => {
  const press = (key: string, onSelf = true): { ran: number; prevented: boolean } => {
    let ran = 0
    let prevented = false
    const self = {}
    onActivateKey(() => ran++)({
      key,
      target: onSelf ? self : {},
      currentTarget: self,
      preventDefault: () => (prevented = true)
    } as never)
    return { ran, prevented }
  }

  it('runs on Enter and Space, like a button', () => {
    expect(press('Enter')).toEqual({ ran: 1, prevented: true })
    expect(press(' ')).toEqual({ ran: 1, prevented: true })
  })

  it('ignores other keys', () => {
    expect(press('a')).toEqual({ ran: 0, prevented: false })
  })

  it('leaves keys on a nested control to that control', () => {
    expect(press('Enter', false)).toEqual({ ran: 0, prevented: false })
  })
})
