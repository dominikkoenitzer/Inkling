import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { EditorState, NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { editKey, ignoresShortcut, isCommandKey, keyLabel, onActivateKey, tickTodo } from '../src/renderer/src/lib/keys'

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

describe('editKey', () => {
  const press = (key: string, cancels = true): { committed: unknown; cancelled: unknown; prevented: boolean } => {
    let committed: unknown = null
    let cancelled: unknown = null
    let prevented = false
    const field = {}
    editKey(
      { key, currentTarget: field, preventDefault: () => (prevented = true) } as never,
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
