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
    .map((n, i) => {
      if (n.type === 'hardBreak') return '  \n'
      // A [[wiki-link]] is an atom with no child content; export the syntax verbatim so
      // the exported Markdown round-trips into other wiki-style tools.
      if (n.type !== 'text') return renderInline(n.content)
      const marks = n.marks ?? []
      const has = (m: string): boolean => marks.some((x) => x.type === m)
      // inline code can't contain other markdown, so keep it raw and return early
      if (has('code')) return codeSpan(n.text ?? '')
      const href = marks.find((x) => x.type === 'link')?.attrs?.href
      const linked = typeof href === 'string' && href !== ''
      // a delimiter next to a space neither opens nor closes, so the edge spaces go outside it
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(escapeInline(n.text ?? ''))!
      const marked = core !== '' && ['bold', 'italic', 'strike', 'highlight'].some(has)
      // a marked run touches its own delimiters, a plain one those of the nodes beside it, a link label neither
      const joins = (k: number): boolean => k >= 0 && k < nodes.length && nodes[k].type !== 'hardBreak'
      let t = escapeRuns(core, marked || (!linked && !lead && joins(i - 1)), marked || (!linked && !trail && joins(i + 1)))
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

function renderList(node: PMNode, indent: string, marker: (index: number, item: PMNode) => string): string {
  const items = node.content ?? []
  let out = ''
  items.forEach((item, i) => {
    const kids = item.content ?? []
    // the leading paragraph sits on the marker line; every OTHER block child (a second
    // paragraph, code block, blockquote, nested list) is emitted indented so nothing is lost
    const firstParaIdx = kids.findIndex((k) => k.type === 'paragraph')
    const firstText = escapeBlockLines(firstParaIdx >= 0 ? renderInline(kids[firstParaIdx].content) : renderInline(item.content))
    out += `${indent}${marker(i, item)}${firstText}\n`
    kids.forEach((k, ki) => {
      if (ki === firstParaIdx) return
      out += renderBlock(k, indent + '  ')
    })
  })
  return out + '\n'
}

function renderBlock(node: PMNode, indent = ''): string {
  switch (node.type) {
    case 'paragraph':
      return `${indent}${escapeBlockLines(renderInline(node.content))}\n\n`
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      return `${'#'.repeat(level)} ${renderInline(node.content)}\n\n`
    }
    case 'bulletList':
      return renderList(node, indent, () => '- ')
    case 'orderedList':
      return renderList(node, indent, (i) => `${i + 1}. `)
    case 'taskList':
      return renderList(node, indent, (_i, item) => (item.attrs?.checked ? '- [x] ' : '- [ ] '))
    case 'blockquote':
      return (
        (node.content ?? [])
          .map((c) => renderBlock(c, indent))
          .join('')
          .trimEnd()
          .split('\n')
          .map((l) => `> ${l}`.trimEnd())
          .join('\n') + '\n\n'
      )
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      return '```' + lang + '\n' + code + '\n```\n\n'
    }
    case 'horizontalRule':
      return '---\n\n'
    default:
      return (node.content ?? []).map((c) => renderBlock(c, indent)).join('')
  }
}

export function tiptapDocToMarkdown(doc: unknown): string {
  const root = doc as PMNode
  if (!root || !Array.isArray(root.content)) return ''
  const body = root.content
    .map((n) => renderBlock(n))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return body ? body + '\n' : ''
}
