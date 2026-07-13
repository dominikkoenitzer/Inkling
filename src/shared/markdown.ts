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
// escape a leading block marker so a plain paragraph isn't reparsed as a list/heading/quote
function escapeLeadingBlock(line: string): string {
  return line
    .replace(/^(\s*)([#>])/, '$1\\$2')
    .replace(/^(\s*)([-+])(\s)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s)/, '$1$2\\$3$4')
}

function renderInline(nodes: PMNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type !== 'text') return renderInline(n.content)
      const marks = n.marks ?? []
      const has = (m: string): boolean => marks.some((x) => x.type === m)
      // inline code can't contain other markdown, so keep it raw and return early
      if (has('code')) return '`' + (n.text ?? '') + '`'
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

function renderList(node: PMNode, indent: string, marker: (index: number, item: PMNode) => string): string {
  const items = node.content ?? []
  let out = ''
  items.forEach((item, i) => {
    const kids = item.content ?? []
    // the leading paragraph sits on the marker line; every OTHER block child (a second
    // paragraph, code block, blockquote, nested list, …) is emitted indented so nothing is lost
    const firstParaIdx = kids.findIndex((k) => k.type === 'paragraph')
    const firstText = firstParaIdx >= 0 ? renderInline(kids[firstParaIdx].content) : renderInline(item.content)
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
      return `${indent}${escapeLeadingBlock(renderInline(node.content))}\n\n`
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
