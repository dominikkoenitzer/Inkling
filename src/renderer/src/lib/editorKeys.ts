import { NodeSelection, type Transaction } from '@tiptap/pm/state'

/**
 * Ctrl+Enter in a note: ticks or unticks the to-do the cursor is in, on `tr` when `dispatch`
 * is set. False leaves the key to the editor.
 */
export function tickTodo(tr: Transaction, dispatch: boolean): boolean {
  const { selection } = tr
  // A selected to-do is the one meant, not the to-do it sits in.
  if (selection instanceof NodeSelection && selection.node.type.name === 'taskItem') {
    const { node } = selection
    if (dispatch) tr.setNodeMarkup(selection.from, undefined, { ...node.attrs, checked: !node.attrs.checked })
    return true
  }
  const { $from } = selection
  // In a code block the key leaves the block, as it always did.
  if ($from.parent.type.spec.code) return false
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    // A bullet or numbered item under a to-do keeps the key's hard break.
    if (node.type.name === 'listItem') return false
    if (node.type.name !== 'taskItem') continue
    if (dispatch) tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked })
    return true
  }
  return false
}
