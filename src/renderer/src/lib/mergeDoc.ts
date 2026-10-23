import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/** A TipTap doc or one of its nodes, as JSON. */
export type DocJson = { type?: string; attrs?: Record<string, unknown>; content?: DocJson[]; marks?: unknown[]; text?: string }

const key = (v: unknown): string => JSON.stringify(v) ?? ''

/**
 * Three-way merge of a note: `base` is the version the editor loaded, `mine` the editor's and
 * `theirs` the one stored since (an assistant wrote it). A change made on one side is taken as
 * it is. Where both sides changed the same blocks, the editor's come first, then every block of
 * the stored version the editor does not have, so no text of either side is lost.
 */
export function mergeDocs(base: DocJson, mine: DocJson, theirs: DocJson): DocJson {
  return mergeNode(base, mine, theirs) ?? { ...mine, content: [...(mine.content ?? []), ...unseen(base.content ?? [], mine.content ?? [], theirs.content ?? [])] }
}

/** The nodes of `theirs` found in neither `base` nor `mine`. */
function unseen(base: DocJson[], mine: DocJson[], theirs: DocJson[]): DocJson[] {
  const known = new Set([...base, ...mine].map(key))
  return theirs.filter((n) => !known.has(key(n)))
}

const CONFLICT = Symbol('conflict')

/** One value changed on either side, or CONFLICT when both changed it differently. */
function pick<T>(base: T, mine: T, theirs: T): T | typeof CONFLICT {
  const m = key(mine)
  if (m === key(base)) return theirs
  if (key(theirs) === key(base) || m === key(theirs)) return mine
  return CONFLICT
}

/** A node changed on one or both sides, or null when the two changes cannot both be kept in it. */
function mergeNode(base: DocJson, mine: DocJson, theirs: DocJson): DocJson | null {
  const same = pick(base, mine, theirs)
  if (same !== CONFLICT) return same
  if (mine.type !== theirs.type) return null
  const out: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)]) as Set<keyof DocJson>) {
    let value: unknown
    if (k === 'content') {
      const content = mergeSeq(base.content ?? [], mine.content ?? [], theirs.content ?? [])
      if (!content) return null
      value = content
    } else if (k === 'attrs') {
      // An attribute both sides set differently keeps the editor's value; it holds no text.
      const attrs: Record<string, unknown> = {}
      for (const a of new Set([...Object.keys(mine.attrs ?? {}), ...Object.keys(theirs.attrs ?? {})])) {
        const v = pick(base.attrs?.[a], mine.attrs?.[a], theirs.attrs?.[a])
        attrs[a] = v === CONFLICT ? mine.attrs?.[a] : v
      }
      value = attrs
    } else {
      // Text is not merged by the character: the block holding it keeps both versions instead.
      value = pick(base[k], mine[k], theirs[k])
      if (value === CONFLICT) return null
    }
    if (value !== undefined) out[k] = value
  }
  return out as DocJson
}

/** Where `base[start, end)` became `side[from, to)`. */
interface Hunk {
  start: number
  end: number
  from: number
  to: number
}

/** Above this many compared pairs, the differing middle counts as replaced whole. */
const MAX_PAIRS = 4_000_000

/** The ranges where `side` differs from `base`, by a longest common subsequence. */
function hunks(base: string[], side: string[]): Hunk[] {
  let pre = 0
  while (pre < base.length && pre < side.length && base[pre] === side[pre]) pre++
  let post = 0
  while (post < base.length - pre && post < side.length - pre && base[base.length - 1 - post] === side[side.length - 1 - post]) post++
  const n = base.length - pre - post
  const m = side.length - pre - post
  if (n === 0 && m === 0) return []
  if (n * m > MAX_PAIRS) return [{ start: pre, end: pre + n, from: pre, to: pre + m }]
  // lcs[i * w + j]: the common length of base[pre + i..] and side[pre + j..] within the middle.
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = base[pre + i] === side[pre + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }
  const out: Hunk[] = []
  let open: Hunk | null = null
  for (let i = 0, j = 0; i < n || j < m; ) {
    if (i < n && j < m && base[pre + i] === side[pre + j]) {
      open = null
      i++
      j++
      continue
    }
    if (!open) {
      open = { start: pre + i, end: pre + i, from: pre + j, to: pre + j }
      out.push(open)
    }
    if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
      j++
      open.to++
    } else {
      i++
      open.end++
    }
  }
  return out
}

/** Whether a hunk touches the base range [start, end); two inserts at one place do too. */
const overlaps = (h: Hunk, start: number, end: number): boolean =>
  (h.start < end && h.end > start) || (h.start === h.end && start === end && h.start === start)

/** What one side made of base[start, end), given its hunks in that range. */
function sideOf(base: DocJson[], side: DocJson[], hs: Hunk[], start: number, end: number): DocJson[] {
  if (hs.length === 0) return base.slice(start, end)
  const first = hs[0]
  const last = hs[hs.length - 1]
  return side.slice(first.from - (first.start - start), last.to + (end - last.end))
}

const isInline = (n: DocJson): boolean => n.text !== undefined || n.type === 'hardBreak'

/** Three-way merge of a node's children, or null when inline content changed on both sides. */
function mergeSeq(base: DocJson[], mine: DocJson[], theirs: DocJson[]): DocJson[] | null {
  const kb = base.map(key)
  const changes = [
    ...hunks(kb, mine.map(key)).map((h) => ({ h, mine: true })),
    ...hunks(kb, theirs.map(key)).map((h) => ({ h, mine: false }))
  ].sort((a, b) => a.h.start - b.h.start || a.h.end - b.h.end)
  const inline = [...base, ...mine, ...theirs].some(isInline)
  const out: DocJson[] = []
  let done = 0
  for (let k = 0; k < changes.length; ) {
    const { start } = changes[k].h
    let end = changes[k].h.end
    const group = [changes[k++]]
    while (k < changes.length && overlaps(changes[k].h, start, end)) {
      end = Math.max(end, changes[k].h.end)
      group.push(changes[k++])
    }
    out.push(...base.slice(done, start))
    done = end
    const own = group.filter((c) => c.mine).map((c) => c.h)
    const other = group.filter((c) => !c.mine).map((c) => c.h)
    const b = base.slice(start, end)
    const m = sideOf(base, mine, own, start, end)
    const t = sideOf(base, theirs, other, start, end)
    if (other.length === 0 || key(m) === key(t)) {
      out.push(...m)
      continue
    }
    if (own.length === 0) {
      out.push(...t)
      continue
    }
    // Both sides changed these nodes: one by one when each side kept their number.
    const each = m.length === b.length && t.length === b.length ? b.map((n, i) => mergeNode(n, m[i], t[i])) : null
    if (each && each.every((n) => n !== null)) out.push(...(each as DocJson[]))
    else if (inline) return null
    else out.push(...m, ...unseen(b, m, t))
  }
  out.push(...base.slice(done))
  return out
}

/**
 * A transaction that turns the editor's doc into `next` by replacing only the range that
 * differs, so a cursor outside it stays put; null when the two are the same.
 */
export function replaceChanged(state: EditorState, next: PMNode): Transaction | null {
  const { doc } = state
  const start = doc.content.findDiffStart(next.content)
  if (start == null) return null
  let { a: endA, b: endB } = doc.content.findDiffEnd(next.content)!
  // Repeated content can put the end before the start; ProseMirror's own input moves it the same way.
  if (endA < start && doc.content.size < next.content.size) {
    endB += start - endA
    endA = start
  } else if (endB < start) {
    endA += start - endB
    endB = start
  }
  return state.tr.replace(start, endA, next.slice(start, endB))
}
