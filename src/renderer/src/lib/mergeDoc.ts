import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/** A TipTap doc or one of its nodes, as JSON. */
export type DocJson = { type?: string; attrs?: Record<string, unknown>; content?: DocJson[]; marks?: unknown[]; text?: string }

const key = (v: unknown): string => JSON.stringify(v) ?? ''

/**
 * Three-way merge of a note: `base` is the version the editor loaded, `mine` the editor's and
 * `theirs` the one stored since (an assistant wrote it). A change made on one side is taken as
 * it is. Where both sides changed the same blocks, they are merged block by block, and a line both
 * sides changed differently is kept in both versions, the editor's first, so no text of either
 * side is lost.
 */
export function mergeDocs(base: DocJson, mine: DocJson, theirs: DocJson): DocJson {
  ;[mine, theirs] = carryTodos(base, mine, theirs)
  const merged = mergeNode(base, mine, theirs) ?? { ...mine, content: [...(mine.content ?? []), ...unseen(base.content ?? [], mine.content ?? [], theirs.content ?? [])] }
  // A note needs one line, even when the two sides deleted every line between them.
  return merged.content?.length ? merged : { ...merged, content: [{ type: 'paragraph' }] }
}

/** The title, merged from the same three versions: the editor's once it changed it, else the stored one. */
export function mergeTitle(base: string | null, mine: string | null, theirs: string | null): string | null {
  return (mine ?? '') === (base ?? '') ? theirs : mine
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
    if (!inline) {
      out.push(...mergeBlocks(b, m, t))
      continue
    }
    // Both sides changed this text: piece by piece when each side kept their number.
    const each = m.length === b.length && t.length === b.length ? b.map((n, i) => mergeNode(n, m[i], t[i])) : null
    if (each && each.every((n) => n !== null)) out.push(...(each as DocJson[]))
    else return null
  }
  out.push(...base.slice(done))
  return out
}

const taskId = (n: DocJson): unknown => n.attrs?.taskId ?? null

/** The to-dos with a task id in `n`, inner ones before the to-do holding them. */
function todos(n: DocJson, out: DocJson[] = []): DocJson[] {
  n.content?.forEach((c) => todos(c, out))
  if (n.type === 'taskItem' && taskId(n) !== null) out.push(n)
  return out
}

/** Each task id's to-do in `n`, or null for an id on more than one. */
function todosById(n: DocJson): Map<unknown, DocJson | null> {
  const at = new Map<unknown, DocJson | null>()
  for (const t of todos(n)) at.set(taskId(t), at.has(taskId(t)) ? null : t)
  return at
}

/** The first to-do of task `id` in `n`, in document order: the copy that keeps the task row. */
function firstTodo(n: DocJson, id: unknown): DocJson | undefined {
  if (n.type === 'taskItem' && taskId(n) === id) return n
  for (const c of n.content ?? []) {
    const t = firstTodo(c, id)
    if (t) return t
  }
  return undefined
}

/** `n` with its first to-do of task `id` replaced by `to`. */
function swap(n: DocJson, id: unknown, to: DocJson): DocJson {
  let done = false
  const walk = (x: DocJson): DocJson => {
    if (done) return x
    if (x.type === 'taskItem' && taskId(x) === id) {
      done = true
      return to
    }
    return x.content ? { ...x, content: x.content.map(walk) } : x
  }
  return walk(n)
}

/**
 * A to-do changed on the stored side (an assistant ticked it) gets that change on the editor's
 * side, wherever the editor moved it, and its base version back on the stored side. Merged by
 * position, a moved to-do would come out twice: moved without the tick, and ticked in its old place.
 */
function carryTodos(base: DocJson, mine: DocJson, theirs: DocJson): [DocJson, DocJson] {
  const inBase = todosById(base)
  for (const changed of todos(theirs)) {
    const id = taskId(changed)
    const b = inBase.get(id)
    if (!b || key(b) === key(changed)) continue
    const m = firstTodo(mine, id)
    const t = todosById(theirs).get(id)
    const merged = m && t ? mergeNode(b, m, t) : null
    if (!merged) continue
    mine = swap(mine, id, merged)
    theirs = swap(theirs, id, b)
  }
  return [mine, theirs]
}

/** A block with the texts and task ids inside it counted, by which two versions of it can be told alike. */
interface Traced {
  node: DocJson
  key: string
  size: number
  traits: Map<string, number>
}

function trace(node: DocJson): Traced {
  const traits = new Map<string, number>()
  let size = 0
  const walk = (n: DocJson): void => {
    const id = taskId(n)
    for (const t of [n.text === undefined ? null : `t${n.text}`, id === null ? null : `i${String(id)}`]) {
      if (t === null) continue
      traits.set(t, (traits.get(t) ?? 0) + 1)
      size++
    }
    n.content?.forEach(walk)
  }
  walk(node)
  return { node, key: key(node), size, traits }
}

/** How well two blocks line up as one changed block: 0 across types or task ids (a new to-do has none), most when equal, else 1 plus what they share. */
function likeness(a: Traced, b: Traced): number {
  if (a.node.type !== b.node.type || taskId(a.node) !== taskId(b.node)) return 0
  if (a.key === b.key) return 2 + a.size
  let shared = 0
  for (const [t, n] of a.traits) shared += Math.min(n, b.traits.get(t) ?? 0)
  return 1 + shared
}

/** For each base block, the index of the side's block it became, or -1, keeping the order. */
function align(blocks: DocJson[], into: DocJson[]): number[] {
  const n = blocks.length
  const m = into.length
  const at = new Array<number>(n).fill(-1)
  if (n * m > MAX_PAIRS) return at
  const base = blocks.map(trace)
  const side = into.map(trace)
  // best[i * w + j]: the highest likeness total of base[i..] and side[j..].
  const w = m + 1
  const best = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = likeness(base[i], side[j])
      best[i * w + j] = Math.max(s ? best[(i + 1) * w + j + 1] + s : 0, best[(i + 1) * w + j], best[i * w + j + 1])
    }
  }
  for (let i = 0, j = 0; i < n && j < m; ) {
    const s = likeness(base[i], side[j])
    if (s && best[i * w + j] === best[(i + 1) * w + j + 1] + s) at[i++] = j++
    else if (best[i * w + j] === best[(i + 1) * w + j]) i++
    else j++
  }
  return at
}

/** Blocks both sides changed: each base block merged with what it became on either side, added blocks in place, the editor's first. */
function mergeBlocks(b: DocJson[], m: DocJson[], t: DocJson[]): DocJson[] {
  const inMine = align(b, m)
  const inTheirs = align(b, t)
  const known = new Set([...b, ...m].map(key))
  const out: DocJson[] = []
  let j = 0
  let k = 0
  const added = (mineTo: number, theirsTo: number): void => {
    out.push(...m.slice(j, mineTo), ...t.slice(k, theirsTo).filter((n) => !known.has(key(n))))
    j = mineTo
    k = theirsTo
  }
  for (let i = 0; i < b.length; i++) {
    const mi = inMine[i]
    const ti = inTheirs[i]
    added(mi < 0 ? j : mi, ti < 0 ? k : ti)
    const mn = mi < 0 ? null : m[mi]
    const tn = ti < 0 ? null : t[ti]
    if (mi >= 0) j = mi + 1
    if (ti >= 0) k = ti + 1
    if (mn && tn) {
      const merged = mergeNode(b[i], mn, tn)
      // A list or other container whose blocks the two sides deleted between them goes too.
      if (merged?.content?.length === 0 && b[i].content?.some((n) => !isInline(n))) continue
      // Two versions of one line that cannot be combined: both stay.
      out.push(...(merged ? [merged] : [mn, ...(known.has(key(tn)) ? [] : [tn])]))
      continue
    }
    // A block one side deleted stays when the other side changed it.
    if (mn && key(mn) !== key(b[i])) out.push(mn)
    else if (tn && key(tn) !== key(b[i]) && !known.has(key(tn))) out.push(tn)
  }
  added(m.length, t.length)
  // A block both sides ended up with, each its own way, comes out no more often than one side has it.
  const tally = (ns: DocJson[]): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const n of ns) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1)
    return counts
  }
  const left = tally(m)
  for (const [s, c] of tally(t)) left.set(s, Math.max(c, left.get(s) ?? 0))
  return out.filter((n) => {
    const s = key(n)
    const c = left.get(s)
    if (c === undefined) return true
    left.set(s, c - 1)
    return c > 0
  })
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
