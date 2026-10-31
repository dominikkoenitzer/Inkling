import type { EditorState, Transaction } from '@tiptap/pm/state'

/**
 * Stamp database ids onto nodes of one type, in document order, matching the order the
 * main process returned. Kept out of the undo history so Ctrl+Z cannot un-assign an id.
 * Null when every node already has its id.
 */
export function stampNodeIds(state: EditorState, nodeType: string, attr: string, ids: number[]): Transaction | null {
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
