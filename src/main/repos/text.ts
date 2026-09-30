/**
 * Plain text of a TipTap doc for the search index. Text nodes of one block join as they
 * are, so a word split by formatting (**Photo**synthesis) stays one word; blocks and line
 * breaks become a space. No database import here: the v13 migration in `db.ts` uses it.
 */
export function tiptapToText(json: string): string {
  try {
    const doc = JSON.parse(json)
    let out = ''
    const gap = (): void => {
      if (out && !out.endsWith(' ')) out += ' '
    }
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      const node = n as { type?: string; text?: string; content?: unknown[] }
      if (typeof node.text === 'string') out += node.text
      else if (node.type === 'hardBreak') gap()
      if (Array.isArray(node.content)) {
        node.content.forEach(walk)
        gap()
      }
    }
    walk(doc)
    return out.trimEnd()
  } catch {
    return ''
  }
}
