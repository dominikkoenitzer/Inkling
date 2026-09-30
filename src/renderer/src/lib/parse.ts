/** Small shared parsing helpers: note card lines, note task extraction, fuzzy match. */
import { hasCloze, separatorIndex } from '@shared/cloze'
import type { NoteCardLine, NoteTaskItem } from '@shared/types'

/* ---- `Term :: Definition` and cloze lines inside a note → flashcards (§7) ---- */

/**
 * Reads one paragraph as a card line: `Term :: Definition`, or text with `{{c1::cloze}}`
 * markup, optionally followed by `:: extra` shown on the back. Null for anything else.
 */
export function parseCardLine(line: string): { front: string; back: string } | null {
  const card = splitCardLine(line)
  return card && (card.back || hasCloze(card.front)) ? card : null
}

/** Like `parseCardLine`, but keeps `Term ::` with its answer still to come on the next lines. */
function splitCardLine(line: string): { front: string; back: string } | null {
  const text = line.trim()
  const idx = separatorIndex(text)
  const front = (idx === -1 ? text : text.slice(0, idx)).trim()
  const back = idx === -1 ? '' : text.slice(idx + 2).trim()
  if (!front || (idx === -1 && !hasCloze(front))) return null
  return { front, back }
}

/** Plain text of a paragraph node, marks dropped and hard breaks (Shift+Enter) as newlines. */
export function paragraphText(n: { content?: unknown[] }): string {
  return (n.content ?? [])
    .map((c) => {
      const node = c as { type?: string; text?: string }
      return node.type === 'hardBreak' ? '\n' : (node.text ?? '')
    })
    .join('')
}

/** A card line and the position of its paragraph among all the doc's paragraphs. */
export type NoteCardLineAt = NoteCardLine & { paragraph: number }

/**
 * The card lines of a TipTap doc in document order, with the line id an earlier sync
 * stamped. Indented paragraphs right after a card line continue its answer, one line each.
 */
export function extractNoteCardLines(doc: Record<string, unknown>): NoteCardLineAt[] {
  const lines: NoteCardLineAt[] = []
  let paragraph = 0
  const walk = (n: { content?: unknown[] }): void => {
    let last: NoteCardLineAt | null = null
    for (const child of n.content ?? []) {
      const c = child as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }
      if (c.type !== 'paragraph') {
        last = null
        walk(c)
        continue
      }
      const at = paragraph++
      const text = paragraphText(c)
      if (last && /^\s/.test(text) && text.trim()) {
        last.back = last.back ? `${last.back}\n${text.trim()}` : text.trim()
        continue
      }
      const card = splitCardLine(text)
      last = card ? { lineId: typeof c.attrs?.cardLine === 'number' ? c.attrs.cardLine : null, ...card, paragraph: at } : null
      if (last) lines.push(last)
    }
  }
  walk(doc)
  return lines.filter((l) => l.back || hasCloze(l.front))
}

/* ---- Task items inside a note's TipTap JSON (checkbox → real task, §7) ---- */
export function extractNoteTaskItems(doc: Record<string, unknown>): NoteTaskItem[] {
  const items: NoteTaskItem[] = []
  const textOf = (n: { text?: string; content?: unknown[] }): string => {
    const parts: string[] = []
    const walk = (m: { text?: string; content?: unknown[] }): void => {
      if (typeof m.text === 'string') parts.push(m.text)
      if (Array.isArray(m.content)) {
        m.content.forEach((c) => {
          // don't descend into a nested checklist; that child taskItem is its own task,
          // its text must not be folded into this item's title
          const type = (c as { type?: string }).type
          if (type === 'taskList' || type === 'taskItem') return
          walk(c as never)
        })
      }
    }
    walk(n)
    return parts.join('')
  }
  const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): void => {
    if (n.type === 'taskItem') {
      items.push({
        taskId: typeof n.attrs?.taskId === 'number' ? (n.attrs.taskId as number) : null,
        checked: !!n.attrs?.checked,
        title: textOf(n as never)
      })
    }
    if (Array.isArray(n.content)) n.content.forEach((c) => walk(c as never))
  }
  walk(doc as never)
  return items
}

type DocNode = { type?: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string }

const linkedTaskId = (n: DocNode): number | null =>
  n.type === 'taskItem' && typeof n.attrs?.taskId === 'number' ? n.attrs.taskId : null

/**
 * Carry checkbox tasks renamed, ticked or deleted elsewhere into a page with unsaved edits.
 * `base` holds the items as the page last loaded or synced them: an item whose stored title
 * or state moved away from it takes the stored one, an item gone from the stored note goes
 * (its sub-items move up, as the write-back does), and everything else stays as typed.
 */
export function mergeTaskWriteBacks(local: object, stored: object, base: NoteTaskItem[]): object {
  const storedItems = new Map<number, DocNode>()
  const collect = (n: DocNode): void => {
    const id = linkedTaskId(n)
    if (id !== null) storedItems.set(id, n)
    n.content?.forEach(collect)
  }
  collect(stored as DocNode)
  const was = new Map(base.flatMap((i) => (i.taskId === null ? [] : [[i.taskId, i] as const])))

  const merge = (n: DocNode): DocNode => {
    if (!Array.isArray(n.content)) return n
    const next: DocNode[] = []
    let removed = false
    for (const child of n.content) {
      const id = linkedTaskId(child)
      const before = id === null ? undefined : was.get(id)
      if (id === null || !before) {
        const kept = merge(child)
        // a checklist left without items goes too
        if (kept.type === 'taskList' && (kept.content ?? []).length === 0 && (child.content ?? []).length > 0) removed = true
        else next.push(kept)
        continue
      }
      const theirs = storedItems.get(id)
      if (!theirs) {
        for (const c of child.content ?? []) if (c.type === 'taskList') next.push(...(merge(c).content ?? []))
        removed = true
        continue
      }
      const current = extractNoteTaskItems({ type: 'doc', content: [theirs] })[0]
      const attrs = { ...child.attrs }
      if (current.checked !== before.checked) attrs.checked = current.checked
      const item: DocNode = { ...child, attrs }
      if (current.title !== before.title) {
        const own = (theirs.content ?? []).filter((c) => c.type !== 'taskList')
        item.content = [...own, ...(child.content ?? []).filter((c) => c.type === 'taskList')]
      }
      next.push(merge(item))
    }
    // any other block must hold something: one left empty by a removal gets a paragraph
    const empty = removed && next.length === 0 && n.type !== 'taskList'
    return { ...n, content: empty ? [{ type: 'paragraph' }] : next }
  }
  return merge(local as DocNode)
}

/* ---- Tiny fuzzy subsequence scorer for the command palette ---- */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 1
  if (t.includes(q)) return 100 - t.indexOf(q)
  let qi = 0
  let score = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 2
      qi++
    }
  }
  return qi === q.length ? score : -1
}
