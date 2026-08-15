/**
 * Markdown → TipTap/ProseMirror document.
 *
 * The mirror image of `markdown.ts`, and deliberately scoped to exactly what that exporter
 * emits plus the handful of things people actually paste in: headings, bullet/ordered/task
 * lists, blockquotes, fenced and indented code, horizontal rules, and the inline marks
 * (bold, italic, strike, highlight, code, links, `[[wiki-links]]`). Anything unrecognised
 * survives as plain text rather than being dropped — a lossy import that silently eats a
 * paragraph is worse than one that keeps it unstyled.
 *
 * Pure and dependency-free, so it runs in either process and is unit-testable.
 */

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}
export interface PMNode {
  type?: string
  text?: string
  marks?: PMMark[]
  attrs?: Record<string, unknown>
  content?: PMNode[]
}

const EMPTY_PARAGRAPH: PMNode = { type: 'paragraph' }

/** A markdown document plus the title lifted from a leading `# Heading`, if there was one. */
export interface ImportedNote {
  title: string | null
  doc: PMNode
}

/**
 * Parse a whole markdown file. When the document opens with a single H1, that becomes the
 * note's title (Inkling stores titles separately) instead of being repeated in the body.
 */
export function markdownToNote(markdown: string, fallbackTitle?: string): ImportedNote {
  const doc = markdownToDoc(markdown)
  const blocks = doc.content ?? []
  let title: string | null = fallbackTitle ?? null

  const first = blocks[0]
  if (first?.type === 'heading' && first.attrs?.level === 1) {
    const text = plainText(first)
    if (text.trim()) {
      title = text.trim()
      blocks.shift()
    }
  }
  if (blocks.length === 0) blocks.push({ ...EMPTY_PARAGRAPH })
  return { title, doc: { type: 'doc', content: blocks } }
}

export function markdownToDoc(markdown: string): PMNode {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const content = parseBlocks(lines, 0)
  return { type: 'doc', content: content.length > 0 ? content : [{ ...EMPTY_PARAGRAPH }] }
}

/* --------------------------------- blocks --------------------------------- */

const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const FENCE = /^\s*```(\w*)\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/

/** Indentation of a list line, used to decide nesting. */
function indentOf(line: string): number {
  const m = line.match(/^(\s*)/)
  return m ? m[1].replace(/\t/g, '  ').length : 0
}

function parseBlocks(lines: string[], baseIndent: number): PMNode[] {
  const out: PMNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const language = fence[1] || null
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++ // consume the closing fence
      out.push({
        type: 'codeBlock',
        attrs: { language },
        content: body.length > 0 ? [{ type: 'text', text: body.join('\n') }] : undefined
      })
      continue
    }

    if (RULE.test(line)) {
      out.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      // The editor only enables levels 1–3; deeper headings clamp rather than vanish.
      const level = Math.min(3, heading[1].length)
      out.push({ type: 'heading', attrs: { level }, content: inline(heading[2]) })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() !== '' && body.length > 0 && !isBlockStart(lines[i])))) {
        const m = lines[i].match(QUOTE)
        body.push(m ? m[1] : lines[i].trim())
        i++
      }
      out.push({ type: 'blockquote', content: parseBlocks(body, 0) })
      continue
    }

    if (TASK.test(line) || BULLET.test(line) || ORDERED.test(line)) {
      const consumed = parseList(lines, i, indentOf(line))
      out.push(consumed.node)
      i = consumed.next
      continue
    }

    // Plain paragraph: gather until a blank line or the start of another block.
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) para.push(lines[i++].trim())
    if (para.length > 0) out.push({ type: 'paragraph', content: inline(para.join(' ')) })
    else i++ // a block-start line we somehow didn't consume; don't spin
  }

  void baseIndent
  return out
}

function isBlockStart(line: string): boolean {
  return (
    HEADING.test(line) ||
    QUOTE.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    TASK.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  )
}

/**
 * One list, including nested sublists. A run of task items becomes a taskList (whose items
 * become real tasks on the next save); anything else becomes a bullet or ordered list.
 */
function parseList(lines: string[], start: number, indent: number): { node: PMNode; next: number } {
  const isTask = TASK.test(lines[start])
  const isOrdered = !isTask && ORDERED.test(lines[start])
  const items: PMNode[] = []
  let i = start

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      // A blank line inside a list only ends it if the next content is not deeper.
      const next = lines[i + 1]
      if (next === undefined || next.trim() === '' || indentOf(next) < indent || !isListLine(next)) break
      i++
      continue
    }
    if (!isListLine(line) || indentOf(line) < indent) break

    // A deeper line belongs to the previous item, not this list.
    if (indentOf(line) > indent) {
      const sub = parseList(lines, i, indentOf(line))
      const last = items[items.length - 1]
      if (last) (last.content ??= []).push(sub.node)
      else items.push({ type: 'listItem', content: [sub.node] })
      i = sub.next
      continue
    }

    // A different list kind at the same level starts a new list.
    const lineIsTask = TASK.test(line)
    const lineIsOrdered = !lineIsTask && ORDERED.test(line)
    if (lineIsTask !== isTask || lineIsOrdered !== isOrdered) break

    if (isTask) {
      const m = line.match(TASK)!
      items.push({
        type: 'taskItem',
        attrs: { checked: m[2].toLowerCase() === 'x', taskId: null },
        content: [{ type: 'paragraph', content: inline(m[3]) }]
      })
    } else {
      const m = (isOrdered ? line.match(ORDERED) : line.match(BULLET))!
      const text = isOrdered ? m[3] : m[2]
      items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(text) }] })
    }
    i++
  }

  const type = isTask ? 'taskList' : isOrdered ? 'orderedList' : 'bulletList'
  const node: PMNode = { type, content: items }
  if (isOrdered) {
    const m = lines[start].match(ORDERED)
    node.attrs = { start: m ? Number(m[2]) : 1 }
  }
  return { node, next: i }
}

function isListLine(line: string): boolean {
  return TASK.test(line) || BULLET.test(line) || ORDERED.test(line)
}

/* --------------------------------- inline --------------------------------- */

/**
 * Inline marks, matched longest-delimiter-first so `**bold**` isn't mistaken for two
 * italics. Escapes written by the exporter (`\*`) are unescaped back to literal text.
 */
const INLINE_PATTERNS: Array<{ re: RegExp; build: (m: RegExpExecArray) => PMNode }> = [
  { re: /`([^`]+)`/, build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'code' }] }) },
  { re: /\[\[([^[\]]+)\]\]/, build: (m) => ({ type: 'noteLink', attrs: { noteId: null, label: m[1].trim() } }) },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href: m[2] } }] })
  },
  { re: /\*\*([^*]+)\*\*/, build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'bold' }] }) },
  { re: /__([^_]+)__/, build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'bold' }] }) },
  { re: /~~([^~]+)~~/, build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'strike' }] }) },
  { re: /==([^=]+)==/, build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'highlight' }] }) },
  { re: /\*([^*]+)\*/, build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'italic' }] }) },
  { re: /_([^_]+)_/, build: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'italic' }] }) }
]

function unescape(text: string): string {
  return text.replace(/\\([\\`*_[\]#>+-])/g, '$1')
}

export function inline(text: string): PMNode[] {
  if (!text) return []
  const out: PMNode[] = []
  let rest = text

  while (rest.length > 0) {
    let best: { index: number; length: number; node: PMNode } | null = null

    for (const { re, build } of INLINE_PATTERNS) {
      // Ignore a delimiter that was escaped — the exporter writes `\*` for a literal star.
      const m = re.exec(rest)
      if (!m || m.index === undefined) continue
      if (m.index > 0 && rest[m.index - 1] === '\\') continue
      if (!best || m.index < best.index) best = { index: m.index, length: m[0].length, node: build(m) }
    }

    if (!best) {
      pushText(out, unescape(rest))
      break
    }
    if (best.index > 0) pushText(out, unescape(rest.slice(0, best.index)))
    out.push(best.node)
    rest = rest.slice(best.index + best.length)
  }

  return out
}

function pushText(out: PMNode[], text: string): void {
  if (text) out.push({ type: 'text', text })
}

function plainText(node: PMNode): string {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(plainText).join('')
}
