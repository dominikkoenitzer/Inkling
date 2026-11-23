/**
 * Convert a TipTap / ProseMirror document (as produced by editor.getJSON()) into
 * Markdown. Pure, so it runs in either process.
 */
import { delimiterRow, imageEnd } from './markdownToDoc'

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}
interface PMNode {
  type?: string
  text?: string
  marks?: PMMark[]
  attrs?: Record<string, unknown>
  content?: PMNode[]
}

// Stands in for an image while the text around it is escaped; text already holding it is escaped whole.
const SHIELD = '\uE000'

/** The text with each image swapped for SHIELD, the images in order in `images`. */
function shieldImages(text: string, images: string[]): string {
  if (text.includes(SHIELD)) return text
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const end = imageEnd(text, i)
    if (end === -1) {
      out += text[i]
      continue
    }
    images.push(text.slice(i, end))
    out += SHIELD
    i = end - 1
  }
  return out
}

// escape characters that are meaningful inline so literal text survives a round-trip
function escapeInline(t: string): string {
  return t.replace(/([\\`*_[\]])/g, '\\$1')
}
// a ~ or = run opens or closes strike or highlight when two long beside a non-space, at any place when longer, or when it touches a delimiter it joins
function escapeRuns(t: string, joinsBefore: boolean, joinsAfter: boolean): string {
  return t.replace(/~+|=+/g, (run: string, at: number) => {
    const start = at === 0
    const end = at + run.length === t.length
    const spaced = (start || /\s/.test(t[at - 1])) && (end || /\s/.test(t[at + run.length]))
    return (start && joinsBefore) || (end && joinsAfter) || run.length > 2 || (run.length === 2 && !spaced) ? run.replace(/./g, '\\$&') : run
  })
}
// escape a leading block marker so a line of plain text isn't reparsed as a heading, quote,
// list item, rule, ~~~ fence, or the dash/equals underline that turns the line above into a heading
function escapeLeadingBlock(line: string): string {
  return line
    .replace(/^(\s*)([#>])/, '$1\\$2')
    .replace(/^(\s*)(~)(?=~~)/, '$1\\$2')
    .replace(/^(\s*)([-+])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)(-)(?=[-\s]*$)/, '$1\\$2')
    .replace(/^(\s*)(=)(?=[=\s]*$)/, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3')
    // a row of dashes and pipes would turn the line above into a table header
    .replace(/^(\s*)(\S)(.*)$/, (line: string, pad: string, first: string, rest: string) => (delimiterRow(line) ? `${pad}\\${first}${rest}` : line))
}

// a hard break starts a new line, and every line can start a block
function escapeBlockLines(text: string): string {
  return text.split('\n').map(escapeLeadingBlock).join('\n')
}

// fence inline code with one more backtick than its longest run, padded when the code
// starts or ends with a backtick, or with a space on both sides that a parser would strip
function codeSpan(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = /^`|`$/.test(code) || (code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') ? ' ' : ''
  return fence + pad + code + pad + fence
}

// in a table cell a line break is <br>, so typed <br> text keeps a backslash
function renderInline(nodes: PMNode[] | undefined, cell = false): string {
  if (!nodes) return ''
  return nodes
    .map((n, i) => {
      if (n.type === 'hardBreak') return cell ? '<br>' : '  \n'
      if (n.type !== 'text') return renderInline(n.content, cell)
      const marks = n.marks ?? []
      const has = (m: string): boolean => marks.some((x) => x.type === m)
      // inline code can't contain other markdown, so keep it raw and return early
      if (has('code')) return codeSpan(n.text ?? '')
      const href = marks.find((x) => x.type === 'link')?.attrs?.href
      const linked = typeof href === 'string' && href !== ''
      // a delimiter next to a space neither opens nor closes, so the edge spaces go outside it
      // an image stays exactly as typed, so it is kept out of the escaping
      const images: string[] = []
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(escapeInline(shieldImages(n.text ?? '', images)))!
      const marked = core !== '' && ['bold', 'italic', 'strike', 'highlight'].some(has)
      // a marked run touches its own delimiters, a plain one those of the nodes beside it, a link label neither
      const joins = (k: number): boolean => k >= 0 && k < nodes.length && (cell || nodes[k].type !== 'hardBreak')
      let t = escapeRuns(core, marked || (!linked && !lead && joins(i - 1)), marked || (!linked && !trail && joins(i + 1)))
      if (cell) t = t.replace(/<(br\s*\/?>)/gi, '\\<$1')
      t = t.replace(new RegExp(SHIELD, 'g'), () => images.shift()!)
      if (t && has('bold')) t = `**${t}**`
      if (t && has('italic')) t = `*${t}*`
      if (t && has('strike')) t = `~~${t}~~`
      if (t && has('highlight')) t = `==${t}==`
      t = lead + t + trail
      if (linked) t = `[${t}](${href})`
      return t
    })
    .join('')
}

function renderList(node: PMNode, marker: (index: number, item: PMNode) => string): string {
  const items = node.content ?? []
  let out = ''
  let loose = false
  items.forEach((item, i) => {
    const kids = item.content ?? []
    // the leading paragraph sits on the marker line; every OTHER block child (a second
    // paragraph, code block, blockquote, nested list) is emitted indented so nothing is lost
    const firstParaIdx = kids.findIndex((k) => k.type === 'paragraph')
    const firstText = escapeBlockLines(firstParaIdx >= 0 ? renderInline(kids[firstParaIdx].content) : renderInline(item.content))
    const head = marker(i, item)
    // every line of the other blocks moves in past the list marker, though not past a task's box
    const pad = ' '.repeat(head.indexOf(' ') + 1)
    const blocks = renderBlocks(kids.filter((_k, ki) => ki !== firstParaIdx))
    // a rule right under the item's text would read as its heading underline; text dashes are escaped
    const gap = blocks.startsWith('---') ? '\n\n' : '\n'
    const indent = (text: string): string =>
      text
        .split('\n')
        .map((l) => (l ? pad + l : l))
        .join('\n')
    // an item holding more blocks than its first line is set off from the next by a blank line
    out += (i === 0 ? '' : loose ? '\n\n' : '\n') + head + firstText.replace(/\n[\s\S]*/, indent) + (blocks ? gap + indent(blocks) : '')
    loose = blocks !== ''
  })
  return out
}

// one line per cell, its blocks joined by <br>; every pipe in it is escaped, the one thing a cell cannot hold
function renderCell(cell: PMNode): string {
  return (cell.content ?? [])
    .map((block) => renderInline(block.content, true))
    .join('<br>')
    .replace(/\|/g, '\\|')
}

// the first row is the header, and its cells carry each column's alignment
function renderTable(node: PMNode): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map(renderCell))
  const width = Math.max(0, ...rows.map((r) => r.length))
  if (width === 0) return ''
  const head = node.content?.[0]?.content ?? []
  const line = (cells: string[]): string => `| ${Array.from({ length: width }, (_v, i) => cells[i] ?? '').join(' | ')} |`
  const rule = Array.from({ length: width }, (_v, i) => {
    const align = head[i]?.attrs?.align
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---'
  })
  return [line(rows[0]), `| ${rule.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

// blocks are joined by one blank line, so none is added inside a block; a code block ends in its fence
function renderBlocks(nodes: PMNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => renderBlock(n).replace(/\n+$/, ''))
    .filter((b) => b !== '')
    .join('\n\n')
}

function renderBlock(node: PMNode): string {
  switch (node.type) {
    case 'paragraph':
      return escapeBlockLines(renderInline(node.content))
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      return `${'#'.repeat(level)} ${renderInline(node.content)}`
    }
    case 'bulletList':
      return renderList(node, () => '- ')
    case 'orderedList': {
      // a list number is read only up to nine digits, so a list that would pass that counts from 1
      const start = Number(node.attrs?.start ?? 1)
      const last = start + (node.content ?? []).length - 1
      const first = Number.isInteger(start) && start >= 0 && last <= 999999999 ? start : 1
      return renderList(node, (i) => `${first + i}. `)
    }
    case 'taskList':
      return renderList(node, (_i, item) => (item.attrs?.checked ? '- [x] ' : '- [ ] '))
    case 'blockquote':
      return renderBlocks(node.content)
        .trimEnd()
        .split('\n')
        // trailing spaces are a hard break or part of the code, so only an empty line drops its space
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      // a line of three or more backticks inside closes a fence no longer than it
      const fence = '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((run) => run.length + 1)))
      return fence + lang + '\n' + code + '\n' + fence
    }
    case 'horizontalRule':
      return '---'
    case 'table':
      return renderTable(node)
    default:
      return renderBlocks(node.content)
  }
}

export function tiptapDocToMarkdown(doc: unknown): string {
  const root = doc as PMNode
  if (!root || !Array.isArray(root.content)) return ''
  const body = renderBlocks(root.content).trimEnd()
  return body ? body + '\n' : ''
}
