/** Checkbox lines of a TipTap doc and the task ids stamped on them. Used by the editor and the MCP server. */
import type { NoteTaskItem } from './types'

type DocNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] }

/** Every task item of a doc in document order, with the task id an earlier sync stamped. */
export function extractNoteTaskItems(doc: Record<string, unknown>): NoteTaskItem[] {
  const items: NoteTaskItem[] = []
  const textOf = (n: DocNode): string => {
    const parts: string[] = []
    const walk = (m: DocNode): void => {
      if (typeof m.text === 'string') parts.push(m.text)
      if (Array.isArray(m.content)) {
        m.content.forEach((c) => {
          // A nested checklist is its own task; its text stays out of this item's title.
          const type = (c as DocNode).type
          if (type === 'taskList' || type === 'taskItem') return
          walk(c as DocNode)
        })
      }
    }
    walk(n)
    return parts.join('')
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
