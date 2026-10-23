import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { mergeDocs, replaceChanged, type DocJson } from '../src/renderer/src/lib/mergeDoc'

const p = (text?: string): DocJson => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const item = (text: string, taskId: number, checked = false): DocJson => ({ type: 'taskItem', attrs: { checked, taskId }, content: [p(text)] })
const list = (...items: DocJson[]): DocJson => ({ type: 'taskList', content: items })
const doc = (...blocks: DocJson[]): DocJson => ({ type: 'doc', content: blocks })

describe('mergeDocs', () => {
  it('takes the side that changed when the other did not', () => {
    const base = doc(p('One'))
    expect(mergeDocs(base, base, doc(p('One'), p('Two')))).toEqual(doc(p('One'), p('Two')))
    expect(mergeDocs(base, doc(p('Uno')), base)).toEqual(doc(p('Uno')))
  })

  it('keeps an edit in the note and the text appended after it', () => {
    const base = doc(p('Intro'), list(item('Old task', 1)), p())
    const mine = doc(p('Intro line'), list(item('Old task', 1)), p())
    const theirs = doc(p('Intro'), list(item('Old task', 1)), p('More'), list(item('Call back', 2)))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(p('Intro line'), list(item('Old task', 1)), p('More'), list(item('Call back', 2))))
  })

  it('keeps an edit of the last line and the text appended after it', () => {
    const base = doc(p('Intro'), p('Last'))
    const theirs = doc(p('Intro'), p('Last'), p('More'))
    expect(mergeDocs(base, doc(p('Intro'), p('Last line')), theirs)).toEqual(doc(p('Intro'), p('Last line'), p('More')))
  })

  it('keeps a line typed into the empty end and the text appended in its place', () => {
    const base = doc(p('Intro'), p())
    expect(mergeDocs(base, doc(p('Intro'), p('Typed')), doc(p('Intro'), p('More')))).toEqual(doc(p('Intro'), p('Typed'), p('More')))
  })

  it('keeps a tick from one side and an edit of another to-do from the other', () => {
    const base = doc(list(item('Buy agar', 1), item('Book the room', 2)))
    const mine = doc(list(item('Buy more agar', 1), item('Book the room', 2)))
    const theirs = doc(list(item('Buy agar', 1), item('Book the room', 2, true)))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(list(item('Buy more agar', 1), item('Book the room', 2, true))))
  })

  it('keeps a tick on a to-do whose text the editor changed', () => {
    const base = doc(list(item('Buy agar', 1)))
    expect(mergeDocs(base, doc(list(item('Buy more agar', 1))), doc(list(item('Buy agar', 1, true))))).toEqual(
      doc(list(item('Buy more agar', 1, true)))
    )
  })

  it('keeps a tick next to a to-do the editor added, with no copies', () => {
    const base = doc(list(item('Buy agar', 1), item('Book the room', 2)))
    const mine = doc(list(item('Buy agar', 1), item('Book the room', 2), item('Call Anna', 3)))
    const theirs = doc(list(item('Buy agar', 1), item('Book the room', 2, true)))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(list(item('Buy agar', 1), item('Book the room', 2, true), item('Call Anna', 3))))
  })

  it('keeps both versions of a line both sides changed, the editor one first', () => {
    const base = doc(p('Intro'), p('Plan'), p('End'))
    const mine = doc(p('Intro'), p('Plan for Monday'), p('End'))
    const theirs = doc(p('Intro'), p('Plan for Friday'), p('End'))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(p('Intro'), p('Plan for Monday'), p('Plan for Friday'), p('End')))
  })

  it('keeps both versions of a to-do line both sides reworded, inside its item', () => {
    const base = doc(list(item('Call', 1)))
    const merged = mergeDocs(base, doc(list(item('Call Anna', 1))), doc(list(item('Call Ben', 1))))
    expect(merged).toEqual(doc(list({ type: 'taskItem', attrs: { checked: false, taskId: 1 }, content: [p('Call Anna'), p('Call Ben')] })))
  })

  it('adds a change made the same way on both sides once', () => {
    const base = doc(p('Intro'))
    expect(mergeDocs(base, doc(p('Intro'), p('Same')), doc(p('Intro'), p('Same')))).toEqual(doc(p('Intro'), p('Same')))
  })

  it('keeps what one side deleted deleted', () => {
    const base = doc(p('A'), p('B'), p('C'), p('D'))
    expect(mergeDocs(base, doc(p('A'), p('C'), p('D')), doc(p('A'), p('B'), p('C'), p('D'), p('E')))).toEqual(doc(p('A'), p('C'), p('D'), p('E')))
    expect(mergeDocs(base, doc(p('A'), p('B'), p('C'), p('D2')), doc(p('A'), p('C'), p('D')))).toEqual(doc(p('A'), p('C'), p('D2')))
  })
})

describe('replaceChanged', () => {
  const schema = getSchema([StarterKit, TaskList, TaskItem.configure({ nested: true })])
  const stateOf = (json: DocJson, cursor: number): EditorState => {
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(json) })
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor)))
  }

  it('adds text at the end and leaves the cursor where it was', () => {
    const state = stateOf(doc(p('Hello'), p('World')), 3)
    const next = schema.nodeFromJSON(doc(p('Hello'), p('World'), p('More')))
    const after = state.apply(replaceChanged(state, next)!)
    expect(after.doc.eq(next)).toBe(true)
    expect(after.selection.from).toBe(3)
  })

  it('ticks a to-do below the cursor and leaves the cursor where it was', () => {
    const json = doc(p('Hello'), list({ type: 'taskItem', attrs: { checked: false }, content: [p('Buy agar')] }))
    const state = stateOf(json, 4)
    const next = schema.nodeFromJSON(doc(p('Hello'), list({ type: 'taskItem', attrs: { checked: true }, content: [p('Buy agar')] })))
    const after = state.apply(replaceChanged(state, next)!)
    expect(after.doc.eq(next)).toBe(true)
    expect(after.selection.from).toBe(4)
  })

  it('makes no change when the two are the same', () => {
    const state = stateOf(doc(p('Hello')), 2)
    expect(replaceChanged(state, schema.nodeFromJSON(doc(p('Hello'))))).toBeNull()
  })
})
