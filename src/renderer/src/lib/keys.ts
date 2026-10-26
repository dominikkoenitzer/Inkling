import type { KeyboardEvent } from 'react'
import { NodeSelection, type Transaction } from '@tiptap/pm/state'
import type { AppCommand } from '@shared/api'

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** On a Mac the app's shortcuts sit on Command and read as the system's glyphs. */
export const isMac = typeof navigator !== 'undefined' && /^Mac/.test(navigator.platform)

// Control, Option, Shift and Command, in the order the system writes them; Ctrl in a label means Command there.
const MAC_MODIFIERS: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' }
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']
const MAC_KEYS: Record<string, string> = { Enter: '↩' }

/** A shortcut written as "Ctrl+Shift+8", as this keyboard labels it: unchanged, or "⇧⌘8" on a Mac. */
export function keyLabel(combo: string, mac = isMac): string {
  if (!mac || !combo.includes('+')) return combo
  const parts = combo.split('+')
  const key = parts.pop() as string
  const mods = parts.map((m) => MAC_MODIFIERS[m] ?? m).sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b))
  return mods.join('') + (MAC_KEYS[key] ?? key)
}

/** A shortcut written as "Ctrl+K", in the names `aria-keyshortcuts` takes: "Meta+K" on a Mac. */
export function ariaKeys(combo: string, mac = isMac): string {
  return combo
    .split('+')
    .map((part) => (part === 'Ctrl' ? (mac ? 'Meta' : 'Control') : part))
    .join('+')
}

/** The key for the shortcuts list: F1, or Command and slash on a Mac, whose F1 needs fn. */
export function shortcutsKey(mac = isMac): string {
  return mac ? 'Ctrl+/' : 'F1'
}

/** The modifier of the app's own shortcuts: Command on a Mac, where Control edits text, and Ctrl elsewhere. */
export function isCommandKey(e: { ctrlKey: boolean; metaKey: boolean }, mac = isMac): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey || e.metaKey
}

/**
 * Whether a keydown closes the sheet in front: Escape, and on a Mac also Command+W, which there
 * closes the frontmost panel before any window. Escape that drops a half-typed word stays with the input method.
 */
export function closesSheet(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean },
  mac = isMac
): boolean {
  if (e.isComposing) return false
  if (e.key === 'Escape') return true
  return mac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'w'
}

const COMMAND_KEYS: Record<string, AppCommand> = { k: 'search', n: 'new-note', '1': 'today', '2': 'study', ',': 'settings' }

/**
 * A window keydown that is one of the app's shortcuts is taken from the page and runs once. A
 * held key is taken too, or a Mac hands each repeat on to the menu, which runs it again.
 */
export function takeShortcut(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; preventDefault(): void },
  run: (command: AppCommand) => void,
  mac = isMac
): void {
  let command: AppCommand | undefined
  if (e.key === 'F1') command = 'shortcuts'
  else if (isCommandKey(e, mac) && !e.altKey) command = mac && e.key === '/' ? 'shortcuts' : COMMAND_KEYS[e.key.toLowerCase()]
  if (!command) return
  e.preventDefault()
  if (!e.repeat) run(command)
}

/**
 * Whether a window-level single-key shortcut should leave this keystroke alone: it is
 * going into a field, an open overlay owns the keyboard, a handler already took it, or it
 * is held with a modifier and so belongs to some other shortcut.
 */
export function ignoresShortcut(
  e: { target: EventTarget | null; defaultPrevented: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  overlayOpen: boolean
): boolean {
  if (e.defaultPrevented || overlayOpen || e.ctrlKey || e.metaKey || e.altKey) return true
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null
  return !!el && (el.isContentEditable === true || TEXT_ENTRY.has(el.tagName ?? ''))
}

/** Every element that might take focus from Tab; `canTab` says which really do. */
export const TAB_STOPS = 'a[href], button, input, select, textarea, [tabindex]'

/** Whether Tab reaches the element: in the order, not disabled, not inside something inert. */
export function canTab(el: { tabIndex: number; disabled?: boolean; closest: (selector: string) => unknown }): boolean {
  return el.tabIndex >= 0 && !el.disabled && !el.closest('[inert]')
}

/** On the last screen of a review, Escape or Enter ends it; Enter on a button stays with the button. */
export function endsReview(e: { key: string; target: EventTarget | null }): boolean {
  if (e.key === 'Escape') return true
  const tag = (e.target as { tagName?: string } | null)?.tagName
  return e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A'
}

/** The row Up or Down moves to from row `at` of `count`; null when the key is not for the rows. */
export function nextRow(at: number, count: number, key: string): number | null {
  if (at < 0 || (key !== 'ArrowDown' && key !== 'ArrowUp')) return null
  return Math.max(0, Math.min(count - 1, at + (key === 'ArrowDown' ? 1 : -1)))
}

/**
 * Up and Down between the `[data-row]` rows inside the element, onto the control in the same
 * place in the next row, or its last one when it has fewer.
 */
export function stepRows(e: KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const from = e.target as HTMLElement
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row]')).filter((r) => !r.closest('[inert]'))
  const row = from.closest<HTMLElement>('[data-row]')
  const to = row ? nextRow(rows.indexOf(row), rows.length, e.key) : null
  if (to === null || !row) return
  e.preventDefault()
  const stops = (r: HTMLElement): HTMLElement[] => Array.from(r.querySelectorAll<HTMLElement & { disabled?: boolean }>(TAB_STOPS)).filter(canTab)
  const next = stops(rows[to])
  next[Math.min(Math.max(stops(row).indexOf(from), 0), next.length - 1)]?.focus()
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

/** A keydown in a text field: Enter commits it, and Escape cancels its edit when `cancel` is given. */
export function editKey(
  e: KeyboardEvent<HTMLInputElement>,
  commit: (field: HTMLInputElement) => void,
  cancel?: (field: HTMLInputElement) => void
): void {
  // Enter that ends a word in an input method belongs to the input method.
  if (e.nativeEvent.isComposing) return
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
