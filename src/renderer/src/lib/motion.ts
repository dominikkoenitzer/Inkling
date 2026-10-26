import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** For an overlay that has no exit to report. */
export const noop = (): void => {}

/** How long the animations of a computed style take in ms: the longest delay plus duration. */
export function animationTime(duration: string, delay: string): number {
  const ms = (t: string): number => {
    const n = parseFloat(t)
    return Number.isFinite(n) ? (t.trim().endsWith('ms') ? n : n * 1000) : 0
  }
  const delays = delay.split(',')
  return Math.max(0, ...duration.split(',').map((d, i) => ms(d) + ms(delays[i % delays.length])))
}

// Slack past an animation's own time before a timer ends it in its place.
const MARGIN = 31

/**
 * Calls `done` once the animations on `el` should be over, for a window that never draws them or
 * never reports their end. One held on purpose (paused) is waited out. Returns what cancels it.
 */
function afterMotion(el: HTMLElement, done: () => void): () => void {
  const style = getComputedStyle(el)
  const time = animationTime(style.animationDuration, style.animationDelay) + MARGIN
  let t = 0
  const arm = (): void => {
    t = window.setTimeout(() => (el.getAnimations().some((a) => a.playState === 'paused') ? arm() : done()), time)
  }
  arm()
  return () => window.clearTimeout(t)
}

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
 * Calls `gone` when the exit animation of the element in `ref` ends, at once when it runs none
 * or the page is hidden, and when its time is up if the end never comes. Returns the element's
 * onAnimationEnd.
 */
export function useExit(ref: React.RefObject<HTMLElement | null>, closing: boolean, gone: () => void): (e: React.AnimationEvent) => void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!closing || !el) return
    if (document.hidden || el.getAnimations().length === 0) return gone()
    const cancel = afterMotion(el, gone)
    const onHide = (): void => {
      if (document.hidden) gone()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      cancel()
      document.removeEventListener('visibilitychange', onHide)
    }
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
/** What a row element carries so its list can tell its motion. */
export interface RowProps {
  'data-row': string
  'data-motion'?: RowState
  inert?: boolean
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
 * Settles each moving row in `root` at once when it runs no animation or the page is hidden, and
 * otherwise gives it a timer per motion in case its end never comes. Timers of settled rows go.
 */
function sweepRows(root: HTMLElement | null, timers: Map<string, () => void>, settle: (key: RowKey) => void): void {
  const live = new Set<string>()
  for (const el of root?.querySelectorAll<HTMLElement>('[data-motion]') ?? []) {
    const key = el.dataset.row
    if (key === undefined) continue
    if (document.hidden || el.getAnimations().length === 0) {
      settle(key)
      continue
    }
    const id = `${key}:${el.dataset.motion}`
    live.add(id)
    if (!timers.has(id)) timers.set(id, afterMotion(el, () => settle(key)))
  }
  for (const [id, cancel] of timers) {
    if (live.has(id)) continue
    cancel()
    timers.delete(id)
  }
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Focus inside a row of `root` that just started to leave moves on before the row turns inert:
 * to the same control in the next row, else in the one before, else to `home`.
 */
function passFocus(root: HTMLElement | null, home: HTMLElement | null | undefined): void {
  const active = document.activeElement
  if (!root || !(active instanceof HTMLElement)) return
  const leaving = active.closest<HTMLElement>('[data-motion="leaving"]')
  if (!leaving || !root.contains(leaving)) return
  const label = active.getAttribute('aria-label')
  const same = (row: HTMLElement): HTMLElement | null =>
    active === leaving
      ? row.matches(FOCUSABLE)
        ? row
        : null
      : (label && row.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`)) || row.querySelector<HTMLElement>(FOCUSABLE)
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-row]'))
  const at = rows.indexOf(leaving)
  for (const row of [...rows.slice(at + 1), ...rows.slice(0, at).reverse()]) {
    const target = row.dataset.motion === 'leaving' ? null : same(row)
    if (target) return target.focus()
  }
  home?.focus()
}

/**
 * Rows for a list that animates what joins and leaves it. `list` is the element around the
 * rows; give it `onAnimationEnd`, and spread `row(r)` on each row, which carries motion-row.
 * Focus in a row that leaves goes to a row beside it, else to `home`.
 */
export function useRows<T>(
  items: T[] | null,
  keyOf: (item: T) => RowKey,
  list: React.RefObject<HTMLElement | null>,
  home?: React.RefObject<HTMLElement | null>
): {
  rows: Row<T>[] | null
  onAnimationEnd: (e: React.AnimationEvent) => void
  row: (r: Pick<Row<T>, 'key' | 'state'>) => RowProps
} {
  const [state, setState] = useState(() => ({ items, rows: nextRows<T>(null, items, keyOf) }))
  if (state.items !== items) setState({ items, rows: nextRows(state.rows, items, keyOf) })
  const settle = useCallback((key: RowKey) => setState((s) => (s.rows ? { ...s, rows: settleRow(s.rows, key) } : s)), [])

  const timers = useRef(new Map<string, () => void>())
  useLayoutEffect(() => {
    passFocus(list.current, home?.current)
    sweepRows(list.current, timers.current, settle)
  })
  useEffect(() => {
    const all = timers.current
    const onHide = (): void => sweepRows(list.current, all, settle)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      for (const cancel of all.values()) cancel()
      all.clear()
    }
  }, [list, settle])
  const onAnimationEnd = (e: React.AnimationEvent): void => {
    const el = e.target as HTMLElement
    if (el.dataset.motion && el.dataset.row !== undefined) settle(el.dataset.row)
  }
  const row = (r: Pick<Row<T>, 'key' | 'state'>): RowProps => ({
    'data-row': String(r.key),
    'data-motion': r.state === 'shown' ? undefined : r.state,
    inert: r.state === 'leaving' ? true : undefined
  })
  return { rows: state.rows, onAnimationEnd, row }
}
