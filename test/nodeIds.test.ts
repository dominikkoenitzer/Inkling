import { describe, expect, it } from 'vitest'
import { Extension, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { stampNodeIds } from '../src/renderer/src/lib/nodeIds'
import type { DocJson } from '../src/renderer/src/lib/mergeDoc'

const Linked = TaskItem.extend({ addAttributes: () => ({ checked: { default: false }, taskId: { default: null } }) })
const CardLine = Extension.create({
  name: 'cardLine',
  addGlobalAttributes: () => [{ types: ['paragraph'], attributes: { cardLine: { default: null } } }]
})
const schema = getSchema([StarterKit, TaskList, Linked.configure({ nested: true }), CardLine])

const p = (text: string, cardLine: number | null = null): DocJson => ({ type: 'paragraph', attrs: { cardLine }, content: [{ type: 'text', text }] })
const item = (text: string, taskId: number | null): DocJson => ({ type: 'taskItem', attrs: { checked: false, taskId }, content: [p(text)] })
const list = (...items: DocJson[]): DocJson => ({ type: 'taskList', content: items })
const doc = (...blocks: DocJson[]): DocJson => ({ type: 'doc', content: blocks })

const stateOf = (json: DocJson): EditorState => EditorState.create({ schema, doc: schema.nodeFromJSON(json) })
const node = (json: DocJson) => schema.nodeFromJSON(json)

/** The attribute on every node of a type, in document order, with the text it sits on. */
const lines = (state: EditorState, type: string, attr: string): [string, unknown][] => {
  const out: [string, unknown][] = []
  state.doc.descendants((n) => {
    if (n.type.name === type) out.push([n.textContent, n.attrs[attr]])
    return true
  })
  return out
}

const stamp = (state: EditorState, type: string, attr: string, ids: number[], read: EditorState): EditorState => {
  const tr = stampNodeIds(state, type, attr, ids, read.doc)
  return tr ? state.apply(tr) : state
}

describe('stampNodeIds on to-dos', () => {
  it('stamps new to-dos in order when nothing changed during the save', () => {
    const read = stateOf(doc(list(item('Call Anna', null), item('Call Ben', 2))))
    const after = stamp(read, 'taskItem', 'taskId', [1, 2], read)
    expect(lines(after, 'taskItem', 'taskId')).toEqual([
      ['Call Anna', 1],
      ['Call Ben', 2]
    ])
  })

  it('stamps after a cursor move during the save', () => {
    const read = stateOf(doc(list(item('Call Anna', null), item('Call Ben', null))))
    const moved = read.apply(read.tr.setSelection(TextSelection.create(read.doc, 5)))
    const after = stamp(moved, 'taskItem', 'taskId', [3, 4], read)
    expect(lines(after, 'taskItem', 'taskId')).toEqual([
      ['Call Anna', 3],
      ['Call Ben', 4]
    ])
  })

  it('keeps the ids on their lines when a to-do was added during the save', () => {
    const read = stateOf(doc(list(item('Call Anna', 1), item('Call Ben', 2))))
    const added = read.apply(read.tr.insert(1, node(item('Call Cleo', null))))
    const after = stamp(added, 'taskItem', 'taskId', [1, 2], read)
    expect(lines(after, 'taskItem', 'taskId')).toEqual([
      ['Call Cleo', null],
      ['Call Anna', 1],
      ['Call Ben', 2]
    ])
  })

  it('leaves a new to-do without an id when one was added above it during the save', () => {
    const read = stateOf(doc(list(item('Call Anna', 1), item('Call Ben', null))))
    const added = read.apply(read.tr.insert(1, node(item('Call Cleo', null))))
    const after = stamp(added, 'taskItem', 'taskId', [1, 7], read)
    expect(lines(after, 'taskItem', 'taskId')).toEqual([
      ['Call Cleo', null],
      ['Call Anna', 1],
      ['Call Ben', null]
    ])
  })
})

describe('stampNodeIds on card lines', () => {
  // Stamped by paragraph position, so a paragraph that is not a card line has a hole.
  const perParagraph = (...ids: (number | undefined)[]): number[] => {
    const out: number[] = []
    ids.forEach((id, i) => {
      if (id !== undefined) out[i] = id
    })
    return out
  }

  it('stamps card lines by paragraph when nothing changed during the sync', () => {
    const read = stateOf(doc(p('Agar :: a gel'), p('Some notes'), p('Brine :: salt water')))
    const after = stamp(read, 'paragraph', 'cardLine', perParagraph(5, undefined, 6), read)
    expect(lines(after, 'paragraph', 'cardLine')).toEqual([
      ['Agar :: a gel', 5],
      ['Some notes', null],
      ['Brine :: salt water', 6]
    ])
  })

  it('keeps card line ids on their paragraphs when a line was added during the sync', () => {
    const read = stateOf(doc(p('Agar :: a gel', 5), p('Brine :: salt water', 6)))
    const added = read.apply(read.tr.insert(0, node(p('Some notes'))))
    const after = stamp(added, 'paragraph', 'cardLine', perParagraph(5, 6), read)
    expect(lines(after, 'paragraph', 'cardLine')).toEqual([
      ['Some notes', null],
      ['Agar :: a gel', 5],
      ['Brine :: salt water', 6]
    ])
  })
})
