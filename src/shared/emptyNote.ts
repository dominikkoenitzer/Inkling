interface DocNode {
  type?: string
  text?: string
  content?: DocNode[]
}

/** Nodes that are something on the page even without any text. */
const SOLID = new Set(['taskItem', 'horizontalRule', 'image'])

function holdsSomething(node: DocNode): boolean {
  if (node.type && SOLID.has(node.type)) return true
  if (typeof node.text === 'string' && node.text.trim() !== '') return true
  return (node.content ?? []).some(holdsSomething)
}

/**
 * A note with no title and no body: nothing but whitespace and empty lines. A body that
 * cannot be read counts as something, so it is never thrown away.
 */
export function isEmptyNote(title: string | null, content: string | null): boolean {
  if ((title ?? '').trim() !== '') return false
  if (!content) return true
  try {
    return !holdsSomething(JSON.parse(content) as DocNode)
  } catch {
    return false
  }
}
