/** The node and mark types this build's editor knows. A note holding any other was written by a newer Inkling. */
export const KNOWN_NODES = new Set([
  'doc',
  'text',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell'
])

export const KNOWN_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link', 'underline', 'highlight'])

type Json = { type?: unknown; content?: unknown; marks?: unknown }

/** The first node or mark type in `doc` this build does not know, or null when it knows them all. */
export function unknownType(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const node = doc as Json
  if (typeof node.type === 'string' && !KNOWN_NODES.has(node.type)) return node.type
  if (Array.isArray(node.marks)) {
    for (const m of node.marks) {
      const type = (m as Json | null)?.type
      if (typeof type === 'string' && !KNOWN_MARKS.has(type)) return type
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const found = unknownType(child)
      if (found) return found
    }
  }
  return null
}
