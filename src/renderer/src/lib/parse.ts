/** Small shared parsing helpers: note card lines, note task extraction, fuzzy match. */
import { hasCloze, separatorIndex } from '@shared/cloze'
import type { NoteCardLine } from '@shared/types'

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
export { extractNoteTaskItems } from '@shared/noteTasks'
