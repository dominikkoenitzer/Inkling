import type { KeyboardEvent } from 'react'
import { NodeSelection, type Transaction } from '@tiptap/pm/state'

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Whether a window-level single-key shortcut should leave this keystroke alone: it is
 * going into a field, an open overlay owns the keyboard, or a handler already took it.
 */
export function ignoresShortcut(e: { target: EventTarget | null; defaultPrevented: boolean }, overlayOpen: boolean): boolean {
  if (e.defaultPrevented || overlayOpen) return true
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null
  return !!el && (el.isContentEditable === true || TEXT_ENTRY.has(el.tagName ?? ''))
}

/** Whether a key lands on a focused button, which Space and Enter press by themselves. */
export function onButton(e: { target: EventTarget | null }): boolean {
  return (e.target as { tagName?: string } | null)?.tagName === 'BUTTON'
}

/**
 * Enter and Space on a focused `role="button"` element, the way a real button behaves. Keys
 * that start on a control nested inside it are left to that control.
 */
export function onActivateKey(run: () => void): (e: KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      run()
    }
  }
}

interface Row<T> {
  nextElementSibling: Row<T> | null
  previousElementSibling: Row<T> | null
  querySelector(selector: string): T | null
}

/** Where focus goes when `row` leaves a list: the `pick` control in the nearest row after it, else before it. */
export function nextInList<T>(row: Row<T> | null, pick: string): T | null {
  for (let r = row?.nextElementSibling; r; r = r.nextElementSibling) {
    const found = r.querySelector(pick)
    if (found) return found
  }
  for (let r = row?.previousElementSibling; r; r = r.previousElementSibling) {
    const found = r.querySelector(pick)
    if (found) return found
  }
  return null
}

/** A keydown in a text field: Enter commits it, and Escape cancels its edit when `cancel` is given. */
export function editKey(
  e: KeyboardEvent<HTMLInputElement>,
  commit: (field: HTMLInputElement) => void,
  cancel?: (field: HTMLInputElement) => void
): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    commit(e.currentTarget)
  } else if (e.key === 'Escape' && cancel) {
    e.preventDefault()
    cancel(e.currentTarget)
  }
}

/**
 * Ctrl+Enter in a note: ticks or unticks the to-do the cursor is in, on `tr` when `dispatch`
 * is set. False leaves the key to the editor.
 */
export function tickTodo(tr: Transaction, dispatch: boolean): boolean {
  const { selection } = tr
  // A selected to-do is the one meant, not the to-do it sits in.
  if (selection instanceof NodeSelection && selection.node.type.name === 'taskItem') {
    const { node } = selection
    if (dispatch) tr.setNodeMarkup(selection.from, undefined, { ...node.attrs, checked: !node.attrs.checked })
    return true
  }
  const { $from } = selection
  // In a code block the key leaves the block, as it always did.
  if ($from.parent.type.spec.code) return false
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    // A bullet or numbered item under a to-do keeps the key's hard break.
    if (node.type.name === 'listItem') return false
    if (node.type.name !== 'taskItem') continue
    if (dispatch) tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked })
    return true
  }
  return false
}
