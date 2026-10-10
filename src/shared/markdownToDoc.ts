/**
 * Markdown to a TipTap doc, for the subset the editor knows. Pure, so it runs in either process.
 * Every line outside lists, quotes and code is its own paragraph, as Enter makes one in the editor.
 * The inverse of `tiptapDocToMarkdown` in `markdown.ts`.
 */

type Node = Record<string, unknown>
type Mark = { type: string; attrs?: Record<string, unknown> }

/** The order the editor's schema keeps marks in. */
const MARK_ORDER = ['link', 'bold', 'code', 'italic', 'strike', 'highlight']
const PUNCT = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u
// The app only opens these, so nothing else becomes a link.
const SAFE_HREF = /^(https?:|mailto:)/i

export function markdownToDoc(md: string): { type: 'doc'; content: Record<string, unknown>[] } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const content = parseBlocks(lines)
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}

/* --------------------------------- Blocks --------------------------------- */

const isBlank = (line: string): boolean => line.trim() === ''

function withContent(node: Node, content: Node[]): Node {
  if (content.length > 0) node.content = content
  return node
}

/** Leading whitespace in columns, a tab counting four. */
function indentOf(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

/** Removes up to `cols` columns of leading whitespace. */
function stripIndent(line: string, cols: number): string {
  let n = 0
  let i = 0
  while (i < line.length && n < cols) {
    if (line[i] === ' ') n++
    else if (line[i] === '\t') n += 4
    else break
    i++
  }
  return line.slice(i)
}

function dedent(lines: string[]): string[] {
  const widths = lines.filter((l) => !isBlank(l)).map(indentOf)
  const cut = widths.length > 0 ? Math.min(...widths) : 0
  return lines.map((l) => (isBlank(l) ? '' : stripIndent(l, cut)))
}

/** Two trailing spaces or an unescaped trailing backslash: the next line is a hard break away. */
function endsWithBreak(line: string): boolean {
  if (/ {2,}$/.test(line)) return true
  const run = /\\+$/.exec(line)
  return !!run && run[0].length % 2 === 1
}

const stripBreak = (line: string): string => (/ {2,}$/.test(line) ? line.replace(/ +$/, '') : line.slice(0, -1))

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/
const QUOTE = /^ {0,3}>/

function fenceOf(line: string): RegExpExecArray | null {
  const m = FENCE.exec(line)
  // A backtick fence cannot have a backtick in its info string.
  return m && !(m[2][0] === '`' && m[3].includes('`')) ? m : null
}

function startsBlock(line: string): boolean {
  return !!fenceOf(line) || RULE.test(line) || HEADING.test(line) || QUOTE.test(line) || !!listItem(line)
}

/** The first line plus any lines joined to it by hard breaks. */
function takeParagraph(lines: string[], first: string, from: number): { para: string[]; next: number } {
  const para = [first]
  let i = from
  while (endsWithBreak(para[para.length - 1]) && i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
    para.push(lines[i].trimStart())
    i++
  }
  return { para, next: i }
}

function paragraph(lines: string[]): Node {
  const content: Node[] = []
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    content.push(...inline(i === lines.length - 1 ? line.replace(/\s+$/, '') : stripBreak(line), []))
  })
  return withContent({ type: 'paragraph' }, content)
}

function parseBlocks(lines: string[]): Node[] {
  const out: Node[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }

    const fence = fenceOf(line)
    if (fence) {
      const [, pad, marker, info] = fence
      const body: string[] = []
      i++
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i])
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
          i++
          break
        }
        body.push(stripIndent(lines[i], pad.length))
        i++
      }
      const code = body.join('\n')
      const language = info.trim().split(/\s+/)[0] || null
      out.push(withContent({ type: 'codeBlock', attrs: { language } }, code ? [{ type: 'text', text: code }] : []))
      continue
    }

    if (RULE.test(line)) {
      out.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      // A closing run of #s is decoration, not text.
      const text = (heading[2] ?? '').replace(/(^|[ \t]+)#+[ \t]*$/, '').trim()
      out.push(withContent({ type: 'heading', attrs: { level: Math.min(heading[1].length, 3) } }, inline(text, [])))
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(/^ {0,3}> ?/, ''))
      const blocks = parseBlocks(inner)
      out.push({ type: 'blockquote', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] })
      continue
    }

    if (listItem(line)) {
      i = parseList(lines, i, out)
      continue
    }

    // Leading spaces stay: an indented line under a card line continues its answer.
    const { para, next } = takeParagraph(lines, line, i + 1)
    out.push(paragraph(para))
    i = next
  }
  return out
}

/* ---------------------------------- Lists --------------------------------- */

interface Item {
  indent: number
  kind: 'bullet' | 'ordered' | 'task'
  checked: boolean
  start: number
  text: string
}

function listItem(line: string): Item | null {
  const m = /^([ \t]*)([-*+]|(\d{1,9})[.)])(?:[ \t]+(.*))?$/.exec(line)
  if (!m) return null
  const indent = indentOf(m[1])
  const text = m[4] ?? ''
  if (m[3] !== undefined) return { indent, kind: 'ordered', checked: false, start: Number(m[3]), text }
  const task = /^\[([ xX])\](?:[ \t]+(.*))?$/.exec(text)
  if (task) return { indent, kind: 'task', checked: task[1] !== ' ', start: 1, text: task[2] ?? '' }
  return { indent, kind: 'bullet', checked: false, start: 1, text }
}

/** Reads one list from `start` into `out` and returns the line after it. */
function parseList(lines: string[], start: number, out: Node[]): number {
  const first = listItem(lines[start])!
  const base = first.indent
  // Same kind, same level. Anything indented two past the marker belongs to the item above.
  const isSibling = (it: Item | null): it is Item => !!it && it.kind === first.kind && it.indent >= base && it.indent < base + 2
  const items: Node[] = []
  let i = start
  while (i < lines.length) {
    const it = listItem(lines[i])
    if (!isSibling(it)) break
    const { para, next } = takeParagraph(lines, it.text, i + 1)
    i = next

    const child: string[] = []
    while (i < lines.length) {
      if (isBlank(lines[i])) {
        let j = i
        while (j < lines.length && isBlank(lines[j])) j++
        if (j < lines.length && indentOf(lines[j]) >= base + 2) {
          for (; i < j; i++) child.push('')
          continue
        }
        break
      }
      if (indentOf(lines[i]) < base + 2) break
      child.push(lines[i++])
    }

    const content = [paragraph(para), ...parseBlocks(dedent(child))]
    items.push(
      first.kind === 'task' ? { type: 'taskItem', attrs: { checked: it.checked, taskId: null }, content } : { type: 'listItem', content }
    )

    // Blank lines between items keep the list going.
    let j = i
    while (j < lines.length && isBlank(lines[j])) j++
    if (j > i && j < lines.length && isSibling(listItem(lines[j]))) i = j
  }

  const type = first.kind === 'task' ? 'taskList' : first.kind === 'ordered' ? 'orderedList' : 'bulletList'
  const list: Node = { type, content: items }
  if (first.kind === 'ordered' && first.start !== 1) list.attrs = { start: first.start }
  out.push(list)
  return i
}

/* --------------------------------- Inline --------------------------------- */

interface Delim {
  d: string
  mark: string
}

// Longer delimiters first, so *** opens bold and then italic.
const DELIMS: Delim[] = [
  { d: '**', mark: 'bold' },
  { d: '__', mark: 'bold' },
  { d: '~~', mark: 'strike' },
  { d: '==', mark: 'highlight' },
  { d: '*', mark: 'italic' },
  { d: '_', mark: 'italic' }
]

type Parsed = { nodes: Node[]; end: number }
/** Memo per position, and a work budget: past it, markers stay plain text. */
type Ctx = { memo: Map<string, Parsed | null>; steps: number }
const STEP_BUDGET = 200_000

function textNode(text: string, marks: Mark[]): Node {
  const node: Node = { type: 'text', text }
  if (marks.length > 0) node.marks = [...marks].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type))
  return node
}

function inline(src: string, marks: Mark[]): Node[] {
  return mergeText(seq(src, 0, null, marks, { memo: new Map(), steps: 0 })!.nodes)
}

function mergeText(nodes: Node[]): Node[] {
  const out: Node[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (prev && prev.type === 'text' && n.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      out[out.length - 1] = { ...prev, text: (prev.text as string) + (n.text as string) }
    } else {
      out.push(n)
    }
  }
  return out
}

function canOpen(src: string, pos: number, d: string): boolean {
  const after = src[pos + d.length]
  if (after === undefined || /\s/.test(after)) return false
  // No intraword underscores: snake_case stays as it is.
  return !(d[0] === '_' && pos > 0 && WORD.test(src[pos - 1]))
}

function canClose(src: string, pos: number, d: string): boolean {
  const before = src[pos - 1]
  if (before === undefined || /\s/.test(before)) return false
  const after = src[pos + d.length]
  return !(d[0] === '_' && after !== undefined && WORD.test(after))
}

function runAt(src: string, pos: number): number {
  let j = pos
  while (src[j] === '`') j++
  return j - pos
}

/** Start of the next backtick run of exactly `len`, or -1. */
function findRun(src: string, from: number, len: number): number {
  let i = from
  while (i < src.length) {
    if (src[i] !== '`') {
      i++
      continue
    }
    const run = runAt(src, i)
    if (run === len) return i
    i += run
  }
  return -1
}

function parseLink(src: string, pos: number): { label: string; href: string; end: number } | null {
  let depth = 0
  let j = pos
  for (; j < src.length; j++) {
    const c = src[j]
    if (c === '\\') {
      j++
    } else if (c === '`') {
      const run = runAt(src, j)
      const close = findRun(src, j + run, run)
      j = (close === -1 ? j : close) + run - 1
    } else if (c === '[') {
      depth++
    } else if (c === ']' && --depth === 0) {
      break
    }
  }
  if (j >= src.length || src[j + 1] !== '(') return null
  let k = j + 2
  let parens = 1
  for (; k < src.length; k++) {
    if (src[k] === '(') parens++
    else if (src[k] === ')' && --parens === 0) break
  }
  if (k >= src.length) return null
  let href = src
    .slice(j + 2, k)
    .trim()
    .replace(/\s+"[^"]*"$/, '')
  if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1)
  if (!href || /\s/.test(href)) return null
  return { label: src.slice(pos + 1, j), href, end: k + 1 }
}

/**
 * Inline text from `pos` until `closer`, or to the end when there is none. Null when the
 * closer never comes, so the opener falls back to plain text. Memoised per position.
 */
function seq(src: string, pos: number, closer: Delim | null, marks: Mark[], ctx: Ctx): Parsed | null {
  const key = `${pos}|${closer?.d ?? ''}|${marks.map((m) => m.type).join()}`
  const hit = ctx.memo.get(key)
  if (hit !== undefined) return hit

  const nodes: Node[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) nodes.push(textNode(buf, marks))
    buf = ''
  }
  let result: Parsed | null = null
  let i = pos
  scan: while (i < src.length) {
    ctx.steps++
    if (closer && (buf || nodes.length > 0) && src.startsWith(closer.d, i) && canClose(src, i, closer.d)) {
      flush()
      result = { nodes, end: i + closer.d.length }
      break
    }
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const run = runAt(src, i)
      const close = findRun(src, i + run, run)
      if (close === -1) {
        buf += src.slice(i, i + run)
        i += run
        continue
      }
      let code = src.slice(i + run, close)
      if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1)
      flush()
      // Code takes no other marks in the editor.
      if (code) nodes.push(textNode(code, [{ type: 'code' }]))
      i = close + run
      continue
    }
    if (ch === '[' && !marks.some((m) => m.type === 'link')) {
      const link = parseLink(src, i)
      if (link) {
        const inner = inline(link.label, SAFE_HREF.test(link.href) ? [...marks, { type: 'link', attrs: { href: link.href } }] : marks)
        if (inner.length > 0) {
          flush()
          nodes.push(...inner)
          i = link.end
          continue
        }
      }
    }
    for (const del of ctx.steps < STEP_BUDGET ? DELIMS : []) {
      if (!src.startsWith(del.d, i) || marks.some((m) => m.type === del.mark) || !canOpen(src, i, del.d)) continue
      const inner = seq(src, i + del.d.length, del, [...marks, { type: del.mark }], ctx)
      if (inner && inner.nodes.length > 0) {
        flush()
        nodes.push(...inner.nodes)
        i = inner.end
        continue scan
      }
    }
    buf += ch
    i++
  }
  if (!closer) {
    flush()
    result = { nodes, end: i }
  }
  ctx.memo.set(key, result)
  return result
}
