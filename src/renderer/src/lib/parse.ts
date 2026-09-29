/** Small shared parsing helpers: note card lines, note task extraction, fuzzy match. */
import { hasCloze, separatorIndex } from '@shared/cloze'
import type { NoteCardLine, NoteTaskItem } from '@shared/types'

/* ---- `Term :: Definition` and cloze lines inside a note → flashcards (§7) ---- */

/**
 * Reads one paragraph as a card line: `Term :: Definition`, or text with `{{c1::cloze}}`
 * markup, optionally followed by `:: extra` shown on the back. Null for anything else.
 */
export function parseCardLine(line: string): { front: string; back: string } | null {
  const text = line.trim()
  const idx = separatorIndex(text)
  const front = (idx === -1 ? text : text.slice(0, idx)).trim()
  const back = idx === -1 ? '' : text.slice(idx + 2).trim()
  if (!front) return null
  if (hasCloze(front)) return { front, back }
  return back ? { front, back } : null
}

/** Plain text of a paragraph node, marks dropped. */
export function paragraphText(n: { content?: unknown[] }): string {
  return (n.content ?? []).map((c) => (c as { text?: string }).text ?? '').join('')
}

/** The card lines of a TipTap doc in document order, with the line id an earlier sync stamped. */
export function extractNoteCardLines(doc: Record<string, unknown>): NoteCardLine[] {
  const lines: NoteCardLine[] = []
  const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): void => {
    if (n.type === 'paragraph') {
      const card = parseCardLine(paragraphText(n))
      if (card) lines.push({ lineId: typeof n.attrs?.cardLine === 'number' ? n.attrs.cardLine : null, ...card })
    }
    if (Array.isArray(n.content)) n.content.forEach((c) => walk(c as never))
  }
  walk(doc as never)
  return lines
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
