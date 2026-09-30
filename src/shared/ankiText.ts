/**
 * Anki stores fields as HTML. Inkling cards are plain text with its own cloze markup, so
 * an imported field is flattened: line breaks and blocks become newlines, other tags
 * go, entities are decoded. Images, audio and video cannot come along; they are removed
 * and counted so the import summary can say so. MathJax (`\(...\)`, `\[...\]`) is plain
 * text already and stays as written. Anki's cloze markup `{{c1::answer::hint}}` is the same
 * as Inkling's and passes through untouched.
 */

export interface AnkiText {
  text: string
  /** Images, sounds and videos removed from the field. */
  media: number
}

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  shy: '',
  zwj: '\u200d',
  zwnj: '\u200c',
  times: '×',
  divide: '÷',
  deg: '°',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  euro: '€'
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

export function ankiHtmlToText(html: string): AnkiText {
  let media = 0
  const count = (): string => {
    media++
    return ''
  }
  const text = html
    .replace(/\r\n?/g, '\n')
    // Newlines in the HTML source are not line breaks when Anki renders the field.
    .replace(/\n/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(audio|video)\b[\s\S]*?<\/\1\s*>/gi, count)
    .replace(/<img\b[^>]*>/gi, count)
    .replace(/\[sound:[^\]]*\]/g, count)
    .replace(/<br\s*\/?>/gi, '\n')
    // A block starts and ends a line; back-to-back blocks share one break, and a <br>
    // that ends a block adds no line of its own, as when Anki renders the field.
    .replace(/<\/?(div|p|li)\b[^>]*>/gi, '\0')
    .replace(/\n?\0+/g, '\n')
    .replace(/<[^>]*>/g, '')
  const decoded = decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: decoded, media }
}
