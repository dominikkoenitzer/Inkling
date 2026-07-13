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
          // don't descend into a nested checklist — that child taskItem is its own task,
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

/* ---- Quick-add natural-ish date detection ---- */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export interface QuickParse {
  text: string
  when: Date | null
  hint: string | null
}

export function parseQuickText(raw: string): QuickParse {
  const st: QuickParse = { text: raw.trim(), when: null, hint: null }
  const lower = st.text.toLowerCase()

  const setDay = (d: Date, label: string, matched: string): void => {
    st.when = d
    st.hint = label
    const i = lower.indexOf(matched)
    st.text = (st.text.slice(0, i) + st.text.slice(i + matched.length)).replace(/\s{2,}/g, ' ').trim()
  }

  if (lower.includes('tomorrow')) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    setDay(d, 'tomorrow 9:00', 'tomorrow')
  } else if (lower.includes('today')) {
    const d = new Date()
    d.setHours(17, 0, 0, 0)
    setDay(d, 'today 17:00', 'today')
  } else {
    for (let i = 0; i < 7; i++) {
      const name = WEEKDAYS[i]
      if (lower.includes(name)) {
        const d = new Date()
        let delta = (i - d.getDay() + 7) % 7
        if (delta === 0) delta = 7
        d.setDate(d.getDate() + delta)
        d.setHours(9, 0, 0, 0)
        setDay(d, `${name} 9:00`, name)
        break
      }
    }
  }

  const at = st.text.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (at) {
    let h = parseInt(at[1], 10)
    const min = at[2] ? parseInt(at[2], 10) : 0
    if (at[3]?.toLowerCase() === 'pm' && h < 12) h += 12
    if (at[3]?.toLowerCase() === 'am' && h === 12) h = 0
    const base = st.when ?? new Date()
    base.setHours(h, min, 0, 0)
    if (!st.when && base < new Date()) base.setDate(base.getDate() + 1)
    st.when = base
    st.hint = `${st.hint ? st.hint.split(' ')[0] + ' ' : ''}${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    st.text = st.text.replace(at[0], '').replace(/\s{2,}/g, ' ').trim()
  }

  // If the whole input was just a date/time phrase, the stripped text is empty — fall back to a
  // neutral title rather than re-inserting the very date words we just consumed.
  if (!st.text) st.text = st.when ? 'Untitled' : raw.trim()
  return st
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
