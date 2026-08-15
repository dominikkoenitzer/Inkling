/**
 * Flashcard import: CSV, TSV, or the `Term :: Definition` lines Inkling already understands
 * inside notes. Between them these cover what Quizlet, Anki, and a plain text file export.
 *
 * The delimiter is detected rather than asked for — a dialog asking "is this comma or tab
 * separated?" is a question the file can answer itself.
 *
 * Pure and dependency-free.
 */

export type DeckDelimiter = ',' | ';' | '\t' | '::'

export interface ParsedDeck {
  pairs: Array<[string, string]>
  delimiter: DeckDelimiter
  /** Rows that had no usable front/back pair, so the UI can say how many were skipped. */
  skipped: number
}

/**
 * Pick the delimiter that yields the most two-column rows. Tabs and `::` win ties over
 * commas, because prose fronts ("The powerhouse of the cell, roughly") contain commas far
 * more often than tabs.
 */
export function detectDelimiter(text: string): DeckDelimiter {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, 50)
  if (lines.length === 0) return '\t'

  const candidates: DeckDelimiter[] = ['\t', '::', ';', ',']
  let best: DeckDelimiter = '\t'
  let bestScore = -1
  for (const d of candidates) {
    const score = lines.filter((l) => splitRow(l, d).filter((c) => c.trim() !== '').length >= 2).length
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/**
 * Split one row, honouring RFC-4180 double-quoting for the single-character delimiters.
 * Quizlet and Anki both quote fields containing the delimiter, so ignoring this would
 * split a card in half mid-sentence.
 */
export function splitRow(line: string, delimiter: DeckDelimiter): string[] {
  if (delimiter === '::') {
    const idx = line.indexOf('::')
    return idx < 0 ? [line] : [line.slice(0, idx), line.slice(idx + 2)]
  }

  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field.trim() === '') {
      quoted = true
      field = ''
    } else if (ch === delimiter) {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

const HEADER_WORDS = new Set(['front', 'back', 'term', 'definition', 'question', 'answer', 'word', 'meaning'])

/** True when the first row looks like column headers rather than a real card. */
export function looksLikeHeader(cells: string[]): boolean {
  if (cells.length < 2) return false
  return cells.slice(0, 2).every((c) => HEADER_WORDS.has(c.trim().toLowerCase()))
}

export function parseDeckFile(text: string, delimiter?: DeckDelimiter): ParsedDeck {
  const d = delimiter ?? detectDelimiter(text)
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '')

  const pairs: Array<[string, string]> = []
  let skipped = 0

  lines.forEach((line, i) => {
    const cells = splitRow(line, d).map((c) => c.trim())
    if (i === 0 && looksLikeHeader(cells)) return
    const front = cells[0] ?? ''
    // Anything past the second column is extra metadata (Anki tags, Quizlet ids); fold it
    // back into the answer rather than dropping it.
    const back = cells
      .slice(1)
      .filter((c) => c !== '')
      .join(' · ')
    if (!front || !back) {
      skipped++
      return
    }
    pairs.push([front, back])
  })

  return { pairs, delimiter: d, skipped }
}

/** Strip a path down to a usable deck/note name: "biology-ch4.csv" → "biology-ch4". */
export function nameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '').trim() || 'Imported'
}
