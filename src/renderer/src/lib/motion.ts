import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** For an overlay that has no exit to report. */
export const noop = (): void => {}

/**
 * Keeps an overlay on screen for its exit after `open` turns false. `closing` is true for
 * that stretch; `gone` ends it. Each opening gets a new `generation`, so reopening during an
 * exit mounts a fresh overlay rather than reviving the leaving one.
 */
export function usePresence(open: boolean): { present: boolean; closing: boolean; generation: number; gone: () => void } {
  const [state, setState] = useState({ open, shown: open, generation: open ? 1 : 0 })
  if (state.open !== open) setState({ open, shown: open || state.shown, generation: open ? state.generation + 1 : state.generation })
  const gone = useCallback(() => setState((s) => (s.open ? s : { ...s, shown: false })), [])
  return { present: open || state.shown, closing: !open && state.shown, generation: state.generation, gone }
}

/** Set on an overlay while it plays its exit; `onGone` removes it once that is over. */
export interface Exit {
  closing?: boolean
  onGone?: () => void
}

/**
 * Calls `gone` when the exit animation of the element in `ref` ends, or at once when it runs
 * none. Returns the element's onAnimationEnd.
 */
export function useExit(ref: React.RefObject<HTMLElement | null>, closing: boolean, gone: () => void): (e: React.AnimationEvent) => void {
  useLayoutEffect(() => {
    if (closing && ref.current && ref.current.getAnimations().length === 0) gone()
  }, [ref, closing, gone])
  return (e) => {
    if (closing && e.target === e.currentTarget) gone()
  }
}

/**
 * Remembers what had focus when an overlay opened and gives it back the moment the overlay
 * starts to close, so the keys work on what is behind it during the exit. `target` takes focus
 * on open unless it already holds it.
 */
export function useReturnFocus(closing: boolean, target: React.RefObject<HTMLElement | null>): void {
  const opener = useRef<HTMLElement | null>(null)
  const given = useRef(false)
  const giveBack = useCallback(() => {
    if (given.current) return
    given.current = true
    if (opener.current?.isConnected) opener.current.focus()
  }, [])
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    given.current = false
    if (!target.current?.contains(document.activeElement)) target.current?.focus()
    return giveBack
  }, [target, giveBack])
  useLayoutEffect(() => {
    if (closing) giveBack()
  }, [closing, giveBack])
}

export type RowKey = string | number
export type RowState = 'shown' | 'entering' | 'leaving'
export interface Row<T> {
  key: RowKey
  item: T
  state: RowState
}

/**
 * The rows to draw for `items`, given the rows drawn before. Rows that join are `entering`,
 * rows that went stay as `leaving` where they were until their exit ends, and a row that
 * comes back while leaving enters again. The first list to arrive just shows.
 */
export function nextRows<T>(prev: Row<T>[] | null, items: T[] | null, keyOf: (item: T) => RowKey): Row<T>[] | null {
  if (items === null) return prev
  if (prev === null) return items.map((item) => ({ key: keyOf(item), item, state: 'shown' }))
  const before = new Map(prev.map((r) => [r.key, r]))
  const rows: Row<T>[] = items.map((item) => {
    const key = keyOf(item)
    const old = before.get(key)
    return { key, item, state: old && old.state !== 'leaving' ? old.state : 'entering' }
  })
  const now = new Set(rows.map((r) => r.key))
  // Each row that went keeps its place: right after the row it followed, or first.
  let anchor: RowKey | null = null
  for (const r of prev) {
    if (now.has(r.key)) {
      anchor = r.key
      continue
    }
    const at = anchor === null ? 0 : rows.findIndex((x) => x.key === anchor) + 1
    rows.splice(at, 0, { ...r, state: 'leaving' })
    now.add(r.key)
    anchor = r.key
  }
  return rows
}

/** Ends a row's entry or exit: an entered row just shows, a left row is dropped. */
export function settleRow<T>(rows: Row<T>[], key: RowKey): Row<T>[] {
  const at = rows.findIndex((r) => String(r.key) === String(key))
  if (at < 0 || rows[at].state === 'shown') return rows
  return rows[at].state === 'leaving' ? rows.filter((_, i) => i !== at) : rows.map((r, i) => (i === at ? { ...r, state: 'shown' } : r))
}

/**
 * Rows for a list that animates what joins and leaves it. `list` is the element around the
 * rows; give it `onAnimationEnd`, and spread `row(r)` on each row, which carries motion-row.
 */
export function useRows<T>(
  items: T[] | null,
  keyOf: (item: T) => RowKey,
  list: React.RefObject<HTMLElement | null>
): {
  rows: Row<T>[] | null
  onAnimationEnd: (e: React.AnimationEvent) => void
  row: (r: Pick<Row<T>, 'key' | 'state'>) => { 'data-row': string; 'data-motion'?: RowState; inert?: boolean }
} {
  const [state, setState] = useState(() => ({ items, rows: nextRows<T>(null, items, keyOf) }))
  if (state.items !== items) setState({ items, rows: nextRows(state.rows, items, keyOf) })
  const settle = useCallback((key: RowKey) => setState((s) => (s.rows ? { ...s, rows: settleRow(s.rows, key) } : s)), [])

  // A row whose animation never started (say, hidden) settles at once.
  useLayoutEffect(() => {
    for (const el of list.current?.querySelectorAll<HTMLElement>('[data-motion]') ?? []) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- only rows no animation will ever settle
      if (el.getAnimations().length === 0 && el.dataset.row !== undefined) settle(el.dataset.row)
    }
  })
  const onAnimationEnd = (e: React.AnimationEvent): void => {
    const el = e.target as HTMLElement
    if (el.dataset.motion && el.dataset.row !== undefined) settle(el.dataset.row)
  }
  const row = (r: Pick<Row<T>, 'key' | 'state'>): { 'data-row': string; 'data-motion'?: RowState; inert?: boolean } => ({
    'data-row': String(r.key),
    'data-motion': r.state === 'shown' ? undefined : r.state,
    inert: r.state === 'leaving' ? true : undefined
  })
  return { rows: state.rows, onAnimationEnd, row }
}
