import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { EditorState, NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  ariaKeys,
  closesSheet,
  editKey,
  ignoresShortcut,
  isBackKey,
  isCommandKey,
  keyLabel,
  onActivateKey,
  onButton,
  shortcutsKey,
  takeShortcut
} from '../src/renderer/src/lib/keys'
import { tickTodo } from '../src/renderer/src/lib/editorKeys'
import type { AppCommand } from '../src/shared/api'

/** Just enough of a keydown event and its target to stand in for the DOM. */
const key = (
  target: object | null,
  defaultPrevented = false
): { target: EventTarget | null; defaultPrevented: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean } => ({
  target: target as EventTarget | null,
  defaultPrevented,
  ctrlKey: false,
  metaKey: false,
  altKey: false
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

  it('leaves a key held with Control, Command or Option to its own shortcut', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      expect(ignoresShortcut({ ...key({ tagName: 'BODY' }), [mod]: true }, false), mod).toBe(true)
    }
    expect(ignoresShortcut({ ...key({ tagName: 'BODY' }), shiftKey: true }, false)).toBe(false)
  })
})

describe('takeShortcut', () => {
  const press = (
    init: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean; defaultPrevented?: boolean },
    mac: boolean
  ): { ran: AppCommand[]; prevented: boolean } => {
    const ran: AppCommand[] = []
    let prevented = false
    const e = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...init, preventDefault: () => (prevented = true) }
    takeShortcut(e, (c) => ran.push(c), mac)
    return { ran, prevented }
  }

  it('runs the app shortcuts on Command on a Mac and on Ctrl elsewhere', () => {
    expect(press({ key: 'n', metaKey: true }, true)).toEqual({ ran: ['new-note'], prevented: true })
    expect(press({ key: 'k', ctrlKey: true }, false)).toEqual({ ran: ['search'], prevented: true })
    expect(press({ key: '1', metaKey: true }, true).ran).toEqual(['today'])
    expect(press({ key: '2', ctrlKey: true }, false).ran).toEqual(['study'])
    expect(press({ key: ',', metaKey: true }, true).ran).toEqual(['settings'])
  })

  it('leaves Control on a Mac to text editing', () => {
    expect(press({ key: 'n', ctrlKey: true }, true)).toEqual({ ran: [], prevented: false })
    expect(press({ key: 'k', ctrlKey: true }, true)).toEqual({ ran: [], prevented: false })
  })

  it('takes a held key without running it again, so the Mac menu never sees the repeats', () => {
    expect(press({ key: 'n', metaKey: true, repeat: true }, true)).toEqual({ ran: [], prevented: true })
    expect(press({ key: 'F1', repeat: true }, true)).toEqual({ ran: [], prevented: true })
  })

  it('opens the shortcuts on F1, and on Command and slash on a Mac', () => {
    expect(press({ key: 'F1' }, false).ran).toEqual(['shortcuts'])
    expect(press({ key: 'F1' }, true).ran).toEqual(['shortcuts'])
    expect(press({ key: '/', metaKey: true }, true).ran).toEqual(['shortcuts'])
    expect(press({ key: '/', metaKey: true, shiftKey: true }, true).ran).toEqual(['shortcuts'])
    expect(press({ key: '/', ctrlKey: true }, false)).toEqual({ ran: [], prevented: false })
  })

  it('leaves Option combinations and other keys alone', () => {
    expect(press({ key: 'n', metaKey: true, altKey: true }, true)).toEqual({ ran: [], prevented: false })
    expect(press({ key: 'b', metaKey: true }, true)).toEqual({ ran: [], prevented: false })
    expect(press({ key: 'n' }, false)).toEqual({ ran: [], prevented: false })
  })

  it('leaves a key the editor already took, as Shift+Command+7 for a numbered list where Shift+7 types a slash', () => {
    expect(press({ key: '/', metaKey: true, shiftKey: true, defaultPrevented: true }, true)).toEqual({ ran: [], prevented: false })
    expect(press({ key: '/', metaKey: true, shiftKey: true }, true).ran).toEqual(['shortcuts'])
  })
})

describe('shortcutsKey', () => {
  it('is F1 off a Mac and Command and slash on one', () => {
    expect(keyLabel(shortcutsKey(false), false)).toBe('F1')
    expect(keyLabel(shortcutsKey(true), true)).toBe(String.fromCodePoint(0x2318) + '/')
  })
})

describe('closesSheet', () => {
  const press = (key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean; composing?: boolean } = {}) => ({
    key,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    isComposing: !!mods.composing
  })

  it('closes on Escape everywhere', () => {
    expect(closesSheet(press('Escape'), false)).toBe(true)
    expect(closesSheet(press('Escape'), true)).toBe(true)
  })

  it('closes on Command+W on a Mac, so the key never reaches the window', () => {
    expect(closesSheet(press('w', { meta: true }), true)).toBe(true)
    expect(closesSheet(press('W', { meta: true }), true)).toBe(true)
    expect(closesSheet(press('w', { meta: true, shift: true }), true)).toBe(false)
    expect(closesSheet(press('w', { ctrl: true }), true)).toBe(false)
    expect(closesSheet(press('w', { ctrl: true }), false)).toBe(false)
  })

  it('leaves Escape to an input method that is still composing a word', () => {
    expect(closesSheet(press('Escape', { composing: true }), true)).toBe(false)
  })
})

describe('ariaKeys', () => {
  it('names the keys the way assistive tech expects', () => {
    expect(ariaKeys('Ctrl+K', true)).toBe('Meta+K')
    expect(ariaKeys('Ctrl+K', false)).toBe('Control+K')
    expect(ariaKeys('Ctrl+Shift+8', true)).toBe('Meta+Shift+8')
    expect(ariaKeys('F1', true)).toBe('F1')
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

describe('editKey', () => {
  const press = (key: string, cancels = true): { committed: unknown; cancelled: unknown; prevented: boolean } => {
    let committed: unknown = null
    let cancelled: unknown = null
    let prevented = false
    const field = {}
    editKey(
      { key, nativeEvent: { isComposing: false }, currentTarget: field, preventDefault: () => (prevented = true) } as never,
      (el) => (committed = el),
      cancels ? (el) => (cancelled = el) : undefined
    )
    return { committed: committed === field, cancelled: cancelled === field, prevented }
  }

  it('commits the field on Enter', () => {
    expect(press('Enter')).toEqual({ committed: true, cancelled: false, prevented: true })
  })

  it('cancels the edit on Escape', () => {
    expect(press('Escape')).toEqual({ committed: false, cancelled: true, prevented: true })
  })

  it('leaves Escape alone in a field with nothing to cancel', () => {
    expect(press('Escape', false)).toEqual({ committed: false, cancelled: false, prevented: false })
  })

  it('leaves Enter to the input method while it is composing a word', () => {
    let committed = false
    editKey(
      { key: 'Enter', nativeEvent: { isComposing: true }, currentTarget: {}, preventDefault: () => {} } as never,
      () => (committed = true)
    )
    expect(committed).toBe(false)
  })

  it('ignores other keys', () => {
    expect(press('a')).toEqual({ committed: false, cancelled: false, prevented: false })
  })
})

describe('tickTodo', () => {
  const schema = getSchema([StarterKit, TaskList, TaskItem.configure({ nested: true })])
  type J = Record<string, unknown>
  const para = (text: string): J => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const todo = (text: string, ...nested: J[]): J => ({ type: 'taskItem', attrs: { checked: false }, content: [para(text), ...nested] })
  const docOf = (...blocks: J[]): PMNode => schema.nodeFromJSON({ type: 'doc', content: blocks })
  /** Where the text `text` starts, and where the node holding it starts. */
  const find = (doc: PMNode, text: string, type: string): { text: number; node: number } => {
    let at = -1
    let node = -1
    doc.descendants((n, pos) => {
      if (n.isText && n.text === text && at < 0) at = pos
      return true
    })
    doc.nodesBetween(at, at, (n, pos) => {
      if (n.type.name === type) node = pos
    })
    return { text: at, node }
  }
  /** Presses the key on `doc` with `select` as the selection; the doc after, or null if the key was left alone. */
  const press = (doc: PMNode, select: (doc: PMNode) => Selection): PMNode | null => {
    const state = EditorState.create({ doc, selection: select(doc) })
    const tr = state.tr
    return tickTodo(tr, true) ? state.apply(tr).doc : null
  }
  const ticks = (doc: PMNode | null): boolean[] => {
    const out: boolean[] = []
    doc?.descendants((n) => {
      if (n.type.name === 'taskItem') out.push(!!n.attrs.checked)
      return true
    })
    return out
  }
  const nested = docOf({ type: 'taskList', content: [todo('Outer', { type: 'taskList', content: [todo('Inner')] })] })

  it('ticks the to-do the cursor is in, the nested one too', () => {
    expect(ticks(press(nested, (d) => TextSelection.create(d, find(d, 'Outer', 'taskItem').text + 2)))).toEqual([true, false])
    expect(ticks(press(nested, (d) => TextSelection.create(d, find(d, 'Inner', 'taskItem').text + 2)))).toEqual([false, true])
  })

  it('ticks a selected nested to-do, not the one around it', () => {
    expect(ticks(press(nested, (d) => NodeSelection.create(d, find(d, 'Inner', 'taskItem').node)))).toEqual([false, true])
    expect(ticks(press(nested, (d) => NodeSelection.create(d, find(d, 'Outer', 'taskItem').node)))).toEqual([true, false])
  })

  it('leaves the key alone in a list item under a to-do', () => {
    for (const list of ['bulletList', 'orderedList']) {
      const doc = docOf({ type: 'taskList', content: [todo('Outer', { type: list, content: [{ type: 'listItem', content: [para('Point')] }] })] })
      expect(press(doc, (d) => TextSelection.create(d, find(d, 'Point', 'listItem').text + 2))).toBeNull()
    }
  })

  it('leaves the key alone in a code block and outside to-dos', () => {
    const doc = docOf({ type: 'codeBlock', content: [{ type: 'text', text: 'let a' }] }, para('Plain'))
    expect(press(doc, (d) => TextSelection.create(d, find(d, 'let a', 'codeBlock').text + 1))).toBeNull()
    expect(press(doc, (d) => TextSelection.create(d, find(d, 'Plain', 'paragraph').text + 1))).toBeNull()
  })
})

describe('onButton', () => {
  it('tells a key on a focused button, which presses it, from one on the page', () => {
    expect(onButton(key({ tagName: 'BUTTON' }))).toBe(true)
    expect(onButton(key({ tagName: 'BODY' }))).toBe(false)
    expect(onButton(key({ tagName: 'DIV' }))).toBe(false)
    expect(onButton(key(null))).toBe(false)
  })
})

describe('keyLabel', () => {
  it('keeps the written form off a Mac', () => {
    expect(keyLabel('Ctrl+Shift+8', false)).toBe('Ctrl+Shift+8')
    expect(keyLabel('F1', false)).toBe('F1')
  })

  it('writes Mac glyphs in the system order, without plus signs', () => {
    const [ctrl, opt, shift, cmd, ret] = [0x2303, 0x2325, 0x21e7, 0x2318, 0x21a9].map((c) => String.fromCodePoint(c))
    expect(keyLabel('Ctrl+K', true)).toBe(cmd + 'K')
    expect(keyLabel('Ctrl+,', true)).toBe(cmd + ',')
    expect(keyLabel('Ctrl+Shift+8', true)).toBe(shift + cmd + '8')
    expect(keyLabel('Ctrl+Alt+1', true)).toBe(opt + cmd + '1')
    expect(keyLabel('Ctrl+Enter', true)).toBe(cmd + ret)
    expect(keyLabel('Shift+Alt+Ctrl+K', true)).toBe(opt + shift + cmd + 'K')
    expect(keyLabel('F1', true)).toBe('F1')
    expect(ctrl).not.toBe(cmd)
  })
})

describe('isCommandKey', () => {
  const press = (ctrlKey: boolean, metaKey: boolean): { ctrlKey: boolean; metaKey: boolean } => ({ ctrlKey, metaKey })

  it('takes Ctrl off a Mac, as before', () => {
    expect(isCommandKey(press(true, false), false)).toBe(true)
    expect(isCommandKey(press(false, true), false)).toBe(true)
    expect(isCommandKey(press(false, false), false)).toBe(false)
  })

  it('takes only Command on a Mac, where Control moves the cursor in text', () => {
    expect(isCommandKey(press(false, true), true)).toBe(true)
    expect(isCommandKey(press(true, false), true)).toBe(false)
    expect(isCommandKey(press(true, true), true)).toBe(false)
  })
})

describe('isBackKey', () => {
  const press = (key: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  })

  it('takes Alt+Left on Windows and Linux, and Command+[ on a Mac', () => {
    expect(isBackKey(press('ArrowLeft', { altKey: true }), false)).toBe(true)
    expect(isBackKey(press('[', { metaKey: true }), true)).toBe(true)
    expect(isBackKey(press('BrowserBack'), false)).toBe(true)
  })

  it('leaves Left alone, and Left with other keys held', () => {
    expect(isBackKey(press('ArrowLeft'), false)).toBe(false)
    expect(isBackKey(press('ArrowLeft', { altKey: true, shiftKey: true }), false)).toBe(false)
    expect(isBackKey(press('ArrowLeft', { altKey: true }), true)).toBe(false)
    expect(isBackKey(press('[', { metaKey: true }), false)).toBe(false)
  })
})
