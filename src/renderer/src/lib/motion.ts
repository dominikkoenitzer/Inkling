import { useCallback, useLayoutEffect, useRef, useState } from 'react'

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

/**
 * Calls `gone` when the element's exit animation ends, or at once when it runs none (reduced
 * motion off in tests, or the element hidden). Returns the props for that element.
 */
export function useExit<T extends HTMLElement>(
  closing: boolean,
  gone: () => void
): { ref: React.RefObject<T | null>; onAnimationEnd: (e: React.AnimationEvent<T>) => void } {
  const ref = useRef<T | null>(null)
  useLayoutEffect(() => {
    if (closing && ref.current && ref.current.getAnimations().length === 0) gone()
  }, [closing, gone])
  const onAnimationEnd = (e: React.AnimationEvent<T>): void => {
    if (closing && e.target === e.currentTarget) gone()
  }
  return { ref, onAnimationEnd }
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
 * Rows for a list that animates what joins and leaves it. Spread `list` on the element around
 * the rows and `row(r)` on each row, which carries the motion-row class.
 */
export function useRows<T, E extends HTMLElement = HTMLElement>(
  items: T[] | null,
  keyOf: (item: T) => RowKey
): {
  rows: Row<T>[] | null
  list: { ref: React.RefObject<E | null>; onAnimationEnd: (e: React.AnimationEvent<E>) => void }
  row: (r: Row<T>) => { 'data-row': string; 'data-motion'?: RowState; inert?: boolean }
} {
  const [state, setState] = useState(() => ({ items, rows: nextRows<T>(null, items, keyOf) }))
  if (state.items !== items) setState({ items, rows: nextRows(state.rows, items, keyOf) })
  const settle = useCallback((key: RowKey) => setState((s) => (s.rows ? { ...s, rows: settleRow(s.rows, key) } : s)), [])

  const ref = useRef<E | null>(null)
  // A row whose animation never started (say, hidden) settles at once.
  useLayoutEffect(() => {
    for (const el of ref.current?.querySelectorAll<HTMLElement>('[data-motion]') ?? []) {
      if (el.getAnimations().length === 0 && el.dataset.row !== undefined) settle(el.dataset.row)
    }
  })
  const onAnimationEnd = (e: React.AnimationEvent<E>): void => {
    const el = e.target as HTMLElement
    if (el.dataset.motion && el.dataset.row !== undefined) settle(el.dataset.row)
  }
  const row = (r: Row<T>): { 'data-row': string; 'data-motion'?: RowState; inert?: boolean } => ({
    'data-row': String(r.key),
    'data-motion': r.state === 'shown' ? undefined : r.state,
    inert: r.state === 'leaving' ? true : undefined
  })
  return { rows: state.rows, list: { ref, onAnimationEnd }, row }
}
