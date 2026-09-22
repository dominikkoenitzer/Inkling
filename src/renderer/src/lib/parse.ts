/** Small shared parsing helpers: flashcard pairs, note task extraction, quick-add dates, fuzzy match. */
import type { NoteTaskItem } from '@shared/types'

/* ---- `Term :: Definition` lines inside a note → flashcard pairs (§7) ---- */
export function extractFlashcardPairs(tiptapJson: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  try {
    const doc = JSON.parse(tiptapJson)
    const walk = (n: { type?: string; text?: string; content?: unknown[] }): void => {
      if (n.type === 'paragraph' && Array.isArray(n.content)) {
        const text = n.content
          .map((c) => (c as { text?: string }).text ?? '')
          .join('')
          .trim()
        const idx = text.indexOf('::')
        if (idx > 0 && idx < text.length - 2) {
          const front = text.slice(0, idx).trim()
          const back = text.slice(idx + 2).trim()
          if (front && back) pairs.push([front, back])
        }
      }
      if (Array.isArray(n.content)) n.content.forEach((c) => walk(c as never))
    }
    walk(doc)
  } catch {
    /* ignore malformed docs */
  }
  return pairs
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
