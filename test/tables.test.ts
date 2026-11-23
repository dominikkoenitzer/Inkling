import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { history, undo } from '@tiptap/pm/history'
import { markdownToDoc } from '../src/shared/markdownToDoc'
import { tiptapDocToMarkdown } from '../src/shared/markdown'
import { KNOWN_MARKS, KNOWN_NODES, unknownType } from '../src/shared/docTypes'
import { isEmptyNote } from '../src/shared/emptyNote'
import { cellDown, dropEmptyTable, oneLineCell, tableExtensions } from '../src/renderer/src/lib/tables'
import { openNote } from '../src/renderer/src/lib/noteDoc'

// The editor's own extensions, as PageEditor lists them.
const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Highlight, TaskList, TaskItem, ...tableExtensions])

type Node = Record<string, unknown>
const t = (text: string, ...marks: Node[]): Node => (marks.length ? { type: 'text', text, marks } : { type: 'text', text })
const p = (...content: Node[]): Node => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const cell = (type: string, align: string | null, ...content: Node[]): Node => ({ type, ...(align ? { attrs: { align } } : {}), content: [p(...content)] })
const th = (...content: Node[]): Node => cell('tableHeader', null, ...content)
const td = (...content: Node[]): Node => cell('tableCell', null, ...content)
const tr = (...content: Node[]): Node => ({ type: 'tableRow', content })
const table = (...content: Node[]): Node => ({ type: 'table', content })
const doc = (...content: Node[]): Node => ({ type: 'doc', content })
const br = { type: 'hardBreak' }

/** Markdown in, then out again. */
const round = (md: string): string => tiptapDocToMarkdown(markdownToDoc(md))

describe('Markdown tables come in as tables', () => {
  it('reads the header, the rows and each column alignment', () => {
    const md = '| Name | Qty | Note |\n| :--- | ---: | :---: |\n| Agar | 2 | for **Monday** |'
    expect(markdownToDoc(md)).toEqual(
      doc(
        table(
          tr(cell('tableHeader', 'left', t('Name')), cell('tableHeader', 'right', t('Qty')), cell('tableHeader', 'center', t('Note'))),
          tr(cell('tableCell', 'left', t('Agar')), cell('tableCell', 'right', t('2')), cell('tableCell', 'center', t('for '), t('Monday', { type: 'bold' })))
        )
      )
    )
  })

  it('reads rows without the outer pipes and fills short rows', () => {
    expect(markdownToDoc('a | b\n--- | ---\n1 |')).toEqual(doc(table(tr(th(t('a')), th(t('b'))), tr(td(t('1')), td()))))
  })

  it('ends the table at a line with no pipe, which stays text', () => {
    expect(markdownToDoc('a | b\n--- | ---\nafter')).toEqual(doc(table(tr(th(t('a')), th(t('b')))), p(t('after'))))
  })

  it('reads an escaped pipe as a pipe in its cell, and <br> as a line break', () => {
    expect(markdownToDoc('| a |\n| --- |\n| x \\| y<br>z |')).toEqual(doc(table(tr(th(t('a'))), tr(td(t('x | y'), br, t('z'))))))
  })

  it('ends the table at a blank line, and reads the text after it as text', () => {
    expect(markdownToDoc('| a |\n| - |\n| 1 |\n\nAfter')).toEqual(doc(table(tr(th(t('a'))), tr(td(t('1')))), p(t('After'))))
  })

  it('starts a table on the line after a paragraph', () => {
    expect(markdownToDoc('Intro\n| a |\n| - |')).toEqual(doc(p(t('Intro')), table(tr(th(t('a'))))))
  })

  it('keeps lines that are no table as text, nothing dropped', () => {
    // no row of dashes, a row of dashes with another count, a row wider than the header
    for (const md of ['| a | b |\n| 1 | 2 |', '| a | b |\n| --- |', '| a |\n| --- |\n| 1 | 2 |']) {
      const back = markdownToDoc(md)
      expect(JSON.stringify(back)).not.toContain('"table"')
      for (const word of md.split(/[\s|]+/).filter((w) => w && !/^-+$/.test(w))) expect(JSON.stringify(back)).toContain(word)
    }
  })
})

describe('tables go out as Markdown tables', () => {
  it('writes the header, the alignment row and the rows', () => {
    const md = tiptapDocToMarkdown(
      doc(table(tr(cell('tableHeader', 'center', t('Name')), cell('tableHeader', 'right', t('Qty')), th(t('Note'))), tr(td(t('Agar')), td(t('2')), td())))
    )
    expect(md).toBe('| Name | Qty | Note |\n| :---: | ---: | --- |\n| Agar | 2 |  |\n')
  })

  it('gives back what came in, alignment included', () => {
    for (const md of [
      '| Name | Qty |\n| :--- | ---: |\n| Agar | 2 |\n',
      '| a | b | c |\n| :---: | --- | ---: |\n| **bold** | `co\\|de` | [link](https://example.com) |\n',
      '| a |\n| --- |\n| one<br>two |\n',
      '| a |\n| --- |\n| x \\| y |\n',
      '| a |\n| --- |\n| typed \\<br> text |\n',
      'Before\n\n| a |\n| --- |\n| 1 |\n\nAfter\n'
    ]) {
      expect(round(md)).toBe(md)
    }
  })

  it('keeps every character of a cell through a round trip', () => {
    const tricky = ['a | b', 'back\\slash', 'x\\', '<br> typed', '<BR/>', '*not bold*', '==not==', '`tick', '| lead', '---', ':--', '![alt](pic.png)']
    for (const text of tricky) {
      const d = doc(table(tr(th(t('h'))), tr(td(t(text)))))
      expect(markdownToDoc(tiptapDocToMarkdown(d))).toEqual(d)
    }
    const broken = doc(table(tr(th(t('h'))), tr(td(t('one'), br, t('two <br> three')))))
    expect(markdownToDoc(tiptapDocToMarkdown(broken))).toEqual(broken)
  })

  it('keeps paragraphs of pipes as text, so a note saved before tables reads as it did', () => {
    const old = doc(p(t('| a | b |'), { type: 'hardBreak' }, t('| --- | --- |')), p(t('| 1 | 2 |')))
    const md = tiptapDocToMarkdown(old)
    expect(JSON.stringify(markdownToDoc(md))).not.toContain('"table"')
    expect(markdownToDoc(md)).toEqual(old)
  })

  it('keeps a lone row of dashes in a paragraph as text', () => {
    const d = doc(p(t('Header')), p(t('| --- |')))
    expect(markdownToDoc(tiptapDocToMarkdown(d))).toEqual(d)
  })
})

describe('images stay as typed', () => {
  const images = ['![alt](pic.png)', '![a_b*c](x_y*z.png)', '![](https://example.com/a_b.png "Title")', '![alt [x]](p.png)']

  it('come in as plain text, exactly as typed', () => {
    for (const img of images) expect(markdownToDoc(`See ${img} here`)).toEqual(doc(p(t(`See ${img} here`))))
  })

  it('go out byte for byte, in a paragraph and in a cell', () => {
    for (const img of images) {
      expect(round(`See ${img} here\n`)).toBe(`See ${img} here\n`)
      const inCell = `| a |\n| --- |\n| ${img} |\n`
      expect(round(inCell)).toBe(inCell)
    }
  })

  it('keep the text around them escaped', () => {
    expect(round('*star* ![a](b.png) *x*\n')).toBe('*star* ![a](b.png) *x*\n')
    expect(tiptapDocToMarkdown(doc(p(t('a_b ![a](b.png) c*d'))))).toBe('a\\_b ![a](b.png) c\\*d\n')
  })
})

describe('the editor schema', () => {
  it('knows the same node and mark types as the assistant tools check for', () => {
    expect(new Set(Object.keys(schema.nodes))).toEqual(KNOWN_NODES)
    expect(new Set(Object.keys(schema.marks))).toEqual(KNOWN_MARKS)
  })

  it('takes every table the Markdown reader makes', () => {
    const d = markdownToDoc('| a | b |\n| :-: | --- |\n| 1<br>2 | **x** |\n| 3 |')
    expect(() => schema.nodeFromJSON(d).check()).not.toThrow()
    expect(unknownType(d)).toBeNull()
  })

  it('holds one paragraph per cell', () => {
    const twoLines = doc(table(tr({ type: 'tableHeader', content: [p(t('a')), p(t('b'))] })))
    expect(() => schema.nodeFromJSON(twoLines).check()).toThrow()
  })
})

describe('unknownType', () => {
  it('names the first node or mark this build does not know', () => {
    expect(unknownType(markdownToDoc('# a\n\n- [ ] b\n\n| c |\n| - |'))).toBeNull()
    expect(unknownType(doc(p(t('a')), { type: 'gallery' }))).toBe('gallery')
    expect(unknownType(doc(p(t('a', { type: 'glow' }))))).toBe('glow')
  })
})

describe('isEmptyNote', () => {
  it('counts a table, even an empty one, and a newer node as something', () => {
    expect(isEmptyNote(null, JSON.stringify(doc(table(tr(th())))))).toBe(false)
    expect(isEmptyNote(null, JSON.stringify(doc({ type: 'gallery' })))).toBe(false)
  })
})

describe('openNote', () => {
  it('opens a note this build can read as it is, ready to edit', () => {
    const content = JSON.stringify(markdownToDoc('Text\n\n| a |\n| - |\n| 1 |'))
    expect(openNote(content, schema)).toEqual({ doc: JSON.parse(content), editable: true })
    expect(openNote('', schema).editable).toBe(true)
  })

  it('opens a note holding a node this build does not know read-only, with all its text', () => {
    const content = JSON.stringify(doc(p(t('First')), { type: 'gallery', content: [p(t('Caption'))] }, { type: 'callout', content: [p(t('One'), br, t('Two'))] }))
    const opened = openNote(content, schema)
    expect(opened.editable).toBe(false)
    expect(opened.doc).toEqual(doc(p(t('First')), p(t('Caption')), p(t('One')), p(t('Two'))))
    expect(() => schema.nodeFromJSON(opened.doc).check()).not.toThrow()
  })

  it('opens content that is no doc read-only, as its text', () => {
    const opened = openNote('plain words\nsecond line', schema)
    expect(opened).toEqual({ doc: doc(p(t('plain words')), p(t('second line'))), editable: false })
    expect(openNote('[1, 2]', schema).editable).toBe(false)
  })
})

/* ---------------------------------- Keys ---------------------------------- */

const state = (d: Node, pos: (n: PMNode) => number): EditorState => {
  const node = schema.nodeFromJSON(d)
  return EditorState.create({ doc: node, selection: TextSelection.create(node, pos(node)), plugins: [history()] })
}

/** The position just inside the text of the n-th cell (header cells first). */
const inCell = (n: number, offset = 0) => (node: PMNode): number => {
  const cells: number[] = []
  node.descendants((child, pos) => {
    if (child.type.name === 'tableCell' || child.type.name === 'tableHeader') cells.push(pos + 2)
    return true
  })
  return cells[n] + offset
}

const press = (s: EditorState, command: (tr: Transaction, dispatch: boolean) => boolean): EditorState | null => {
  const tx = s.tr
  return command(tx, true) ? s.apply(tx) : null
}

/** The text of the textblock the caret is in, and whether that block sits in a table. */
const caret = (s: EditorState): { text: string; inTable: boolean } => {
  const $from = s.selection.$from
  let inTable = false
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') inTable = true
  return { text: $from.parent.textContent, inTable }
}

const grid = doc(table(tr(th(t('h1')), th(t('h2'))), tr(td(t('a1')), td(t('a2'))), tr(td(t('b1')), td(t('b2')))), p(t('after')))

describe('Enter in a table', () => {
  it('moves to the end of the cell below, in the same column', () => {
    const next = press(state(grid, inCell(1)), cellDown)!
    expect(caret(next)).toEqual({ text: 'a2', inTable: true })
    expect(next.selection.$from.parentOffset).toBe(2)
    expect(next.doc.eq(state(grid, inCell(1)).doc)).toBe(true)
  })

  it('leaves the table from the last row, onto the line under it', () => {
    const next = press(state(grid, inCell(4, 1)), cellDown)!
    expect(caret(next)).toEqual({ text: 'after', inTable: false })
    expect(next.selection.$from.parentOffset).toBe(0)
  })

  it('makes the line under the table when there is none', () => {
    const last = doc(p(t('x')), table(tr(th(t('h'))), tr(td(t('a')))))
    const next = press(state(last, inCell(1)), cellDown)!
    expect(caret(next)).toEqual({ text: '', inTable: false })
    expect(next.doc.lastChild!.type.name).toBe('paragraph')
  })

  it('does nothing outside a table', () => {
    expect(press(state(doc(p(t('x'))), () => 1), cellDown)).toBeNull()
  })
})

describe('Backspace in an empty table', () => {
  const empty = doc(p(t('before')), table(tr(th(), th()), tr(td(), td())), p(t('after')))

  it('takes the table away from its first cell, and undo brings it back', () => {
    const start = state(empty, inCell(0))
    const next = press(start, dropEmptyTable)!
    expect(next.doc.toJSON()).toEqual(doc(p(t('before')), p(), p(t('after'))))
    expect(caret(next)).toEqual({ text: '', inTable: false })
    let undone: EditorState | null = null
    undo(next, (tx) => (undone = next.apply(tx)))
    expect(undone!.doc.eq(start.doc)).toBe(true)
  })

  it('leaves a table with text, and every other cell, to the usual Backspace', () => {
    expect(press(state(empty, inCell(1)), dropEmptyTable)).toBeNull()
    expect(press(state(grid, inCell(0)), dropEmptyTable)).toBeNull()
  })
})

describe('a pasted cell', () => {
  it('keeps text that sits straight in the cell, as most web pages write it', () => {
    expect(oneLineCell(Fragment.from(schema.text('Step')), schema).firstChild!.toJSON()).toEqual(p(t('Step')))
    const mixed = Fragment.from([
      schema.text('Lead', [schema.marks.bold.create()]),
      schema.text(' in'),
      schema.nodes.paragraph.create(null, schema.text('Middle')),
      schema.text('  '),
      schema.nodes.paragraph.create(null, schema.text('Last'))
    ])
    expect(oneLineCell(mixed, schema).firstChild!.toJSON()).toEqual(p(t('Lead', { type: 'bold' }), t(' in'), br, t('Middle'), br, t('Last')))
  })

  it('keeps every line of its text as one line with breaks', () => {
    const blocks = Fragment.from([
      schema.nodes.paragraph.create(null, schema.text('One')),
      schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('Two', [schema.marks.bold.create()])))),
      schema.nodes.codeBlock.create(null, schema.text('three\nfour'))
    ])
    const cell = oneLineCell(blocks, schema)
    expect(cell.childCount).toBe(1)
    expect(cell.firstChild!.toJSON()).toEqual(p(t('One'), br, t('Two', { type: 'bold' }), br, t('three'), br, t('four')))
    expect(tiptapDocToMarkdown(doc(table(tr(th(t('h'))), tr({ type: 'tableCell', content: [cell.firstChild!.toJSON()] }))))).toBe(
      '| h |\n| --- |\n| One<br>**Two**<br>three<br>four |\n'
    )
  })
})
