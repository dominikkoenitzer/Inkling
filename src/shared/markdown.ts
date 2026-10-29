/**
 * Convert a TipTap / ProseMirror document (as produced by editor.getJSON()) into
 * Markdown. Pure and dependency-free so it runs in either process.
 */

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

// escape characters that are meaningful inline so literal text survives a round-trip
function escapeInline(t: string): string {
  return t.replace(/([\\`*_[\]])/g, '\\$1')
}
// escape a leading block marker so a line of plain text isn't reparsed as a heading, quote,
// list item, rule, or the dash/equals underline that turns the line above into a heading
function escapeLeadingBlock(line: string): string {
  return line
    .replace(/^(\s*)([#>])/, '$1\\$2')
    .replace(/^(\s*)([-+])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)(-)(?=[-\s]*$)/, '$1\\$2')
    .replace(/^(\s*)(=)(?=[=\s]*$)/, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3')
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

function renderInline(nodes: PMNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      // A [[wiki-link]] is an atom with no child content; export the syntax verbatim so
      // the exported Markdown round-trips into other wiki-style tools.
      if (n.type !== 'text') return renderInline(n.content)
      const marks = n.marks ?? []
      const has = (m: string): boolean => marks.some((x) => x.type === m)
      // inline code can't contain other markdown, so keep it raw and return early
      if (has('code')) return codeSpan(n.text ?? '')
      let t = escapeInline(n.text ?? '')
      if (has('bold')) t = `**${t}**`
      if (has('italic')) t = `*${t}*`
      if (has('strike')) t = `~~${t}~~`
      if (has('highlight')) t = `==${t}==`
      const link = marks.find((x) => x.type === 'link')
      const href = link?.attrs?.href
      if (typeof href === 'string' && href) t = `[${t}](${href})`
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
        .map((l) => `> ${l}`.trimEnd())
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
