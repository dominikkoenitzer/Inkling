/** Checkbox lines of a TipTap doc and the task ids stamped on them. Used by the editor and the MCP server. */
import type { NoteTaskItem } from './types'

type DocNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] }

const NESTED_LISTS = new Set(['taskList', 'taskItem', 'bulletList', 'orderedList', 'listItem'])

/** Every task item of a doc in document order, with the task id an earlier sync stamped. */
export function extractNoteTaskItems(doc: Record<string, unknown>): NoteTaskItem[] {
  const items: NoteTaskItem[] = []
  const textOf = (n: DocNode): string => {
    const parts: string[] = []
    const walk = (m: DocNode): void => {
      if (typeof m.text === 'string') parts.push(m.text)
      if (m.type === 'hardBreak') parts.push(' ')
      if (Array.isArray(m.content)) {
        m.content.forEach((c) => {
          // A nested list is lines of its own; its text stays out of this item's title.
          const child = c as DocNode
          if (child.type && NESTED_LISTS.has(child.type)) return
          walk(child)
          // Blocks inside the item are separate lines, so their words stay apart.
          if (Array.isArray(child.content)) parts.push(' ')
        })
      }
    }
    walk(n)
    return parts.join('').replace(/\s+/g, ' ').trim()
  }
  const walk = (n: DocNode): void => {
    if (n.type === 'taskItem') {
      items.push({
        taskId: typeof n.attrs?.taskId === 'number' ? (n.attrs.taskId as number) : null,
        checked: !!n.attrs?.checked,
        title: textOf(n)
      })
    }
    if (Array.isArray(n.content)) n.content.forEach((c) => walk(c as DocNode))
  }
  walk(doc as DocNode)
  return items
}

/** Stamps task ids onto the task items of a doc, in document order, as `syncNoteTasks` returned them. */
export function stampTaskIds<T extends Record<string, unknown>>(doc: T, ids: number[]): T {
  let i = 0
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== 'object') return n
    const node = n as DocNode
    const next: DocNode = { ...node }
    if (node.type === 'taskItem') {
      const want = ids[i++]
      if (want !== undefined && want > 0) next.attrs = { ...node.attrs, taskId: want }
    }
    if (Array.isArray(node.content)) next.content = node.content.map(walk)
    return next
  }
  return walk(doc) as T
}
