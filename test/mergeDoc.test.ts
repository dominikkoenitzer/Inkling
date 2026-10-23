import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { mergeDocs, replaceChanged, type DocJson } from '../src/renderer/src/lib/mergeDoc'

const p = (text?: string): DocJson => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const item = (text: string, taskId: number | null, checked = false): DocJson => ({ type: 'taskItem', attrs: { checked, taskId }, content: [p(text)] })
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

  it('keeps a tick on a to-do the editor reworded above a new line, with no copies', () => {
    const base = doc(list(item('Buy agar', 1), item('Book the room', 2)))
    const mine = doc(list(item('Buy more agar', 1), item('Book the room', 2)), p('Notes'))
    const theirs = doc(list(item('Buy agar', 1, true), item('Book the room', 2)))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(list(item('Buy more agar', 1, true), item('Book the room', 2)), p('Notes')))
  })

  it('keeps a tick next to a to-do the editor added above a new line, with no copies', () => {
    const base = doc(list(item('Buy agar', 1), item('Book the room', 2)))
    const mine = doc(list(item('Buy agar', 1), item('Book the room', 2), item('Call Anna', 3)), p('Notes'))
    const theirs = doc(list(item('Buy agar', 1, true), item('Book the room', 2)))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(list(item('Buy agar', 1, true), item('Book the room', 2), item('Call Anna', 3)), p('Notes')))
  })

  it('leaves a stored tick on its to-do, not on a new one the editor typed in its place', () => {
    const base = doc(list(item('Buy agar', 1), item('Book the room', 2)))
    const mine = doc(list(item('Buy agar', 1), item('Call Anna', null)))
    const theirs = doc(list(item('Buy agar', 1), item('Book the room', 2, true)))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(list(item('Buy agar', 1), item('Book the room', 2, true), item('Call Anna', null))))
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

  it('lines a list up with the same list on the other side, not with a line next to it', () => {
    const base = doc(list(item('Buy agar', 1), item('Book the room', 2), item('Call Anna', 3)), p('End'))
    const mine = doc(list(item('Buy agar', 1), item('Book the room', 2)), p('Mine'), p('End'))
    const theirs = doc(p('Theirs'), list(item('Book the room', 2), item('Call Anna', 3)))
    expect(mergeDocs(base, mine, theirs)).toEqual(doc(p('Theirs'), list(item('Book the room', 2)), p('Mine')))
  })

  it('keeps a line both sides ended up with once, though one side made it from another line', () => {
    const h = (text: string): DocJson => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
    const base = doc(h('Title'), p('Plan'))
    expect(mergeDocs(base, doc(h('Title'), h('Plan')), doc(h('Plan')))).toEqual(doc(h('Plan')))
  })

  it('drops a list whose to-dos the two sides deleted between them', () => {
    const base = doc(p('Intro'), list(item('Buy agar', 1), item('Book the room', 2)))
    expect(mergeDocs(base, doc(p('Intro'), list(item('Buy agar', 1))), doc(p('Intro'), list(item('Book the room', 2))))).toEqual(doc(p('Intro')))
  })

  it('leaves one empty line when the two sides deleted every line between them', () => {
    const base = doc(p('A'), p('B'))
    expect(mergeDocs(base, doc(p('B')), doc(p('A')))).toEqual(doc(p()))
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

describe('mergeDocs on generated edits', () => {
  // To-dos carry the task id the editor stamps; one the editor adds has none until it is saved.
  const Linked = TaskItem.extend({ addAttributes: () => ({ checked: { default: false }, taskId: { default: null } }) })
  const schema = getSchema([StarterKit, TaskList, Linked.configure({ nested: true })])
  let seed = 1
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const any = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
  let uid = 0
  const fresh = (tag: string): string => `${tag}${uid++}`
  const todo = (tag: string): DocJson => ({ type: 'taskItem', attrs: { checked: false, taskId: tag === 'm' ? null : uid }, content: [p(fresh(tag))] })
  const norm = (d: DocJson): DocJson => schema.nodeFromJSON(d).toJSON() as DocJson
  const copy = (d: DocJson): DocJson => JSON.parse(JSON.stringify(d)) as DocJson

  const lines = (n: DocJson, out: string[] = []): string[] => {
    if (n.type === 'paragraph') out.push((n.content ?? []).map((c) => c.text ?? '').join(''))
    else for (const c of n.content ?? []) lines(c, out)
    return out
  }
  const ticks = (d: DocJson): Map<string, boolean> => {
    const out = new Map<string, boolean>()
    const walk = (n: DocJson): void => {
      if (n.type === 'taskItem') out.set(lines(n)[0], n.attrs!.checked as boolean)
      n.content?.forEach(walk)
    }
    walk(d)
    return out
  }
  const times = (a: string[], t: string): number => a.filter((x) => x === t).length

  // What the editor can do: edit, insert, delete, tick, add or reword to-dos, append.
  const edit = (d: DocJson, tag: string): DocJson => {
    const out = copy(d)
    const blocks = out.content!
    for (let k = 1 + Math.floor(rnd() * 3); k > 0; k--) {
      const op = any(['editP', 'insertP', 'delete', 'tick', 'addItem', 'editItem', 'append'])
      const i = Math.floor(rnd() * blocks.length)
      const b = blocks[i]
      if (op === 'append') blocks.push(rnd() < 0.5 ? p(fresh(tag)) : list(todo(tag)))
      else if (op === 'insertP') blocks.splice(i, 0, p(fresh(tag)))
      else if (op === 'delete' && blocks.length > 1) blocks.splice(i, 1)
      else if (op === 'editP' && b?.type === 'paragraph') blocks[i] = p(fresh(tag))
      else if (b?.type === 'taskList') {
        const items = b.content!
        const j = Math.floor(rnd() * items.length)
        if (op === 'tick') items[j].attrs = { ...items[j].attrs, checked: !items[j].attrs!.checked }
        else if (op === 'addItem') items.splice(j + (rnd() < 0.5 ? 1 : 0), 0, todo(tag))
        else if (op === 'editItem') items[j].content = [p(fresh(tag))]
      }
    }
    return out
  }

  // What the assistant can do: tick or untick a to-do, and append after dropping empty end lines.
  const assistant = (d: DocJson, tag: string): DocJson => {
    const out = copy(d)
    const blocks = out.content!
    const items: DocJson[] = []
    const walk = (n: DocJson): void => {
      if (n.type === 'taskItem') items.push(n)
      n.content?.forEach(walk)
    }
    walk(out)
    if (rnd() < 0.6 && items.length) {
      const it = any(items)
      it.attrs = { ...it.attrs, checked: !it.attrs!.checked }
    }
    if (rnd() < 0.6) {
      while (blocks.length && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content?.length) blocks.pop()
      blocks.push(rnd() < 0.5 ? p(fresh(tag)) : list(todo(tag)))
    }
    return out
  }

  const problems = (stored: (d: DocJson, tag: string) => DocJson): string[] => {
    const found: string[] = []
    for (let run = 0; run < 3000; run++) {
      seed = run + 1
      const blank = rnd() < 0.5 ? [{ type: 'paragraph' }] : []
      const base = norm(doc(p(fresh('b')), list(todo('b'), todo('b')), p(fresh('b')), list(todo('b')), ...blank))
      const mine = norm(edit(base, 'm'))
      const theirs = norm(stored(base, 't'))
      const merged = mergeDocs(base, mine, theirs)
      try {
        schema.nodeFromJSON(merged).check()
      } catch (e) {
        found.push(`run ${run}: invalid, ${(e as Error).message}`)
      }
      const [lb, lm, lt, lo] = [lines(base), lines(mine), lines(theirs), lines(merged)]
      for (const t of [...lm, ...lt]) if (!lb.includes(t) && !lo.includes(t)) found.push(`run ${run}: lost ${t}`)
      for (const t of lb) if (times(lo, t) > Math.max(times(lm, t), times(lt, t))) found.push(`run ${run}: ${t} copied`)
      const [kb, km, kt, ko] = [ticks(base), ticks(mine), ticks(theirs), ticks(merged)]
      for (const [t, v] of kb) {
        if (km.get(t) === v && kt.has(t) && kt.get(t) !== v && ko.has(t) && ko.get(t) !== kt.get(t)) found.push(`run ${run}: stored tick on ${t} dropped`)
        if (kt.get(t) === v && km.has(t) && km.get(t) !== v && ko.has(t) && ko.get(t) !== km.get(t)) found.push(`run ${run}: editor tick on ${t} dropped`)
      }
    }
    return found
  }

  it('loses no text, copies no line and drops no tick against what the assistant can do', () => {
    expect(problems(assistant)).toEqual([])
  })

  it('loses no text, copies no line and drops no tick against any stored edit', () => {
    expect(problems(edit)).toEqual([])
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
