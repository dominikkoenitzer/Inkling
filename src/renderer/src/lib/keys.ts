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
    if (node.type.name !== 'taskItem') continue
    if (dispatch) tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked })
    return true
  }
  return false
}
