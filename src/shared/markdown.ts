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

function renderInline(nodes: PMNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type !== 'text') return renderInline(n.content)
      let t = n.text ?? ''
      const marks = n.marks ?? []
      const has = (m: string): boolean => marks.some((x) => x.type === m)
      // inline code can't contain other markdown, so return early
      if (has('code')) return '`' + t + '`'
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
    const firstPara = kids.find((k) => k.type === 'paragraph')
    const text = firstPara ? renderInline(firstPara.content) : renderInline(item.content)
    out += `${indent}${marker(i, item)}${text}\n`
    // nested lists are indented two spaces per level
    for (const k of kids) {
      if (k.type === 'bulletList' || k.type === 'orderedList' || k.type === 'taskList') {
        out += renderBlock(k, indent + '  ')
      }
    }
  })
  return out + '\n'
}

function renderBlock(node: PMNode, indent = ''): string {
  switch (node.type) {
    case 'paragraph':
      return `${indent}${renderInline(node.content)}\n\n`
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
