import type { KeyboardEvent } from 'react'

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
