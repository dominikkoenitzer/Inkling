import type { Node } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/**
 * Stamp database ids onto nodes of one type, in document order, matching the order the
 * main process returned for `read`. Kept out of the undo history so Ctrl+Z cannot un-assign an id.
 * Null when every node already has its id, or when the doc changed since `read`, as the ids
 * are by position in it and would land on the wrong nodes.
 */
export function stampNodeIds(state: EditorState, nodeType: string, attr: string, ids: number[], read: Node): Transaction | null {
  if (state.doc !== read) return null
  const tr = state.tr
  let i = 0
  let changed = false
  state.doc.descendants((node, pos) => {
    if (node.type.name === nodeType) {
      const want = ids[i++]
      if (want !== undefined && want > 0 && node.attrs[attr] !== want) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: want })
        changed = true
      }
    }
    return true
  })
  if (!changed) return null
  tr.setMeta('addToHistory', false)
  return tr
}
