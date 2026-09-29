/**
 * Cloze deletions: `{{c1::answer}}` or `{{c1::answer::hint}}` inside a card's text.
 * Each cloze number is its own card; asking card n hides every `cN` span and shows
 * the others as plain text. Pure, so both processes use it and it is unit-tested.
 */

const CLOZE = /\{\{c(\d+)::([\s\S]*?)\}\}/g

interface ClozeSpan {
  start: number
  end: number
  n: number
  answer: string
  hint: string | null
}

function spans(text: string): ClozeSpan[] {
  const out: ClozeSpan[] = []
  for (const m of text.matchAll(CLOZE)) {
    const n = Number(m[1])
    const inner = m[2]
    const cut = inner.indexOf('::')
    const answer = (cut === -1 ? inner : inner.slice(0, cut)).trim()
    const hint = cut === -1 ? null : inner.slice(cut + 2).trim() || null
    if (n < 1 || !answer) continue
    out.push({ start: m.index, end: m.index + m[0].length, n, answer, hint })
  }
  return out
}

/** The cloze numbers in `text`, ascending and without repeats. Empty for a plain card. */
export function clozeNumbers(text: string): number[] {
  return [...new Set(spans(text).map((s) => s.n))].sort((a, b) => a - b)
}

export function hasCloze(text: string): boolean {
  return spans(text).length > 0
}

export interface ClozePart {
  text: string
  /** `blank` is a hidden answer, `answer` the same span once revealed. */
  kind: 'plain' | 'blank' | 'answer'
}

/**
 * Split `text` for asking cloze `n`. Spans of `n` come back as `blank` (the hint, or an
 * ellipsis) or, when `reveal` is set, as `answer`; other clozes read as plain text.
 */
export function renderCloze(text: string, n: number, reveal: boolean): ClozePart[] {
  const parts: ClozePart[] = []
  const push = (t: string, kind: ClozePart['kind']): void => {
    if (!t) return
    const last = parts[parts.length - 1]
    if (last && last.kind === 'plain' && kind === 'plain') last.text += t
    else parts.push({ text: t, kind })
  }
  let at = 0
  for (const s of spans(text)) {
    push(text.slice(at, s.start), 'plain')
    if (s.n !== n) push(s.answer, 'plain')
    else if (reveal) push(s.answer, 'answer')
    else push(s.hint ? `[${s.hint}]` : '[…]', 'blank')
    at = s.end
  }
  push(text.slice(at), 'plain')
  return parts
}

/**
 * Where `::` separates front from back, ignoring the ones inside cloze markup.
 * -1 when the line has no separator of its own.
 */
export function separatorIndex(text: string): number {
  let from = 0
  for (const s of spans(text)) {
    const idx = text.slice(from, s.start).indexOf('::')
    if (idx !== -1) return from + idx
    from = s.end
  }
  const idx = text.slice(from).indexOf('::')
  return idx === -1 ? -1 : from + idx
}
