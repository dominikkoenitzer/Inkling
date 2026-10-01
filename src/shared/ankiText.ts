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
  quot: '"',
  amp: '&',
  apos: "'",
  lt: '<',
  gt: '>',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  zwj: '‍',
  zwnj: '‌',
  bull: '•',
  euro: '€'
}

// HTML's names for U+00A0 to U+00FF in order, then the Greek letters.
const LATIN_1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para ' +
  'middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave ' +
  'Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc ' +
  'Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc ' +
  'iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
const GREEK = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho Sigmaf Sigma Tau Upsilon Phi Chi Psi Omega'
LATIN_1.split(' ').forEach((name, i) => (NAMED[name] = String.fromCharCode(0xa0 + i)))
NAMED.shy = ''
GREEK.split(' ').forEach((name, i) => {
  // There is no capital final sigma; U+03A2 is unassigned.
  if (name !== 'Sigmaf') NAMED[name] = String.fromCharCode(0x391 + i)
  NAMED[name.toLowerCase()] = String.fromCharCode(0x3b1 + i)
})

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? whole
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
    // Whitespace between two blocks is source formatting, not a line of its own.
    .replace(/\0[ \t]+(?=\0)/g, '\0')
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
