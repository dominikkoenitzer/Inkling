import { Extension } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { DOMParser as DocParser, Fragment, type Node as PMNode, type ResolvedPos, type Schema } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'

/** How deep the cell holding `$pos` sits, or -1 outside a table. */
function cellDepth($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return depth
  }
  return -1
}

/**
 * Enter in a cell: the caret goes to the end of the cell below, and from the last row to the
 * line under the table, made when there is none. False outside a table.
 */
export function cellDown(tr: Transaction, dispatch: boolean): boolean {
  const { $from } = tr.selection
  const depth = cellDepth($from)
  if (depth < 0) return false
  const table = $from.node(depth - 2)
  const rowIndex = $from.index(depth - 2)
  if (rowIndex + 1 < table.childCount) {
    let pos = $from.start(depth - 2)
    for (let r = 0; r <= rowIndex; r++) pos += table.child(r).nodeSize
    const row = table.child(rowIndex + 1)
    const column = Math.min($from.index(depth - 1), row.childCount - 1)
    pos += 1
    for (let c = 0; c < column; c++) pos += row.child(c).nodeSize
    if (dispatch) tr.setSelection(TextSelection.near(tr.doc.resolve(pos + row.child(column).nodeSize - 2), -1)).scrollIntoView()
    return true
  }
  if (dispatch) {
    const after = $from.after(depth - 2)
    const next = tr.doc.nodeAt(after)
    if (!next || !next.isTextblock) tr.insert(after, tr.doc.type.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1))).scrollIntoView()
  }
  return true
}

/** Backspace at the start of an empty table's first cell takes the table away; undo brings it back. */
export function dropEmptyTable(tr: Transaction, dispatch: boolean): boolean {
  const { $from, empty } = tr.selection
  if (!empty || $from.parentOffset !== 0) return false
  const depth = cellDepth($from)
  if (depth < 0 || $from.index(depth - 2) !== 0 || $from.index(depth - 1) !== 0 || $from.index(depth) !== 0) return false
  const table = $from.node(depth - 2)
  if (table.textContent !== '') return false
  if (dispatch) {
    const start = $from.before(depth - 2)
    tr.replaceWith(start, start + table.nodeSize, tr.doc.type.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)))
  }
  return true
}

/** A cell's blocks as one line: each block's text after a line break, marks kept. */
export function oneLineCell(blocks: Fragment, schema: Schema): Fragment {
  const inline: PMNode[] = []
  let first = true
  blocks.descendants((node) => {
    if (!node.isTextblock) return true
    if (!first) inline.push(schema.nodes.hardBreak.create())
    first = false
    node.content.forEach((child) => {
      // Code keeps its lines as breaks, since a cell holds one line.
      if (!child.isText || !child.text!.includes('\n')) return void inline.push(child)
      child.text!.split('\n').forEach((part, i) => {
        if (i > 0) inline.push(schema.nodes.hardBreak.create())
        if (part) inline.push(schema.text(part, child.marks))
      })
    })
    return false
  })
  return Fragment.from(schema.nodes.paragraph.create(null, inline))
}

/** Pasted cells keep every line of their text, in the one line a cell holds. */
const pastedCell = (tag: string): Array<{ tag: string; getContent: (dom: Node, schema: Schema) => Fragment }> => [
  { tag, getContent: (dom, schema) => oneLineCell(DocParser.fromSchema(schema).parseSlice(dom).content, schema) }
]

// A cell holds one line, so every table has a Markdown form.
const NoteTableCell = TableCell.extend({ content: 'paragraph', parseHTML: () => pastedCell('td') })
const NoteTableHeader = TableHeader.extend({ content: 'paragraph', parseHTML: () => pastedCell('th') })

const TableKeys = Extension.create({
  name: 'tableKeys',
  // Ahead of the editor's own Enter and the table's Backspace.
  priority: 102,
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.command(({ tr, dispatch }) => cellDown(tr, !!dispatch)),
      Backspace: () => this.editor.commands.command(({ tr, dispatch }) => dropEmptyTable(tr, !!dispatch))
    }
  }
})

/** Tables in a note: header row first, one line per cell, alignment per cell. */
export const tableExtensions = [Table.configure({ resizable: false }), TableRow, NoteTableHeader, NoteTableCell, TableKeys]
