import { describe, it, expect } from 'vitest'
import { extractNoteCardLines, extractNoteTaskItems, fuzzyScore, parseCardLine } from '../src/renderer/src/lib/parse'

const doc = (content: unknown[]): string => JSON.stringify({ type: 'doc', content })
const para = (text: string): unknown => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('extractNoteCardLines', () => {
  const lines = (content: unknown[]): Array<{ front: string }> => extractNoteCardLines(JSON.parse(doc(content)))

  it('pulls "Term :: Definition" lines into cards', () => {
    expect(lines([para('Photosynthesis :: converts light into energy'), para('just a normal line'), para('Mitochondria :: the powerhouse of the cell')])).toEqual([
      { lineId: null, front: 'Photosynthesis', back: 'converts light into energy', paragraph: 0 },
      { lineId: null, front: 'Mitochondria', back: 'the powerhouse of the cell', paragraph: 2 }
    ])
  })
  it('ignores lines without a term or definition', () => {
    expect(lines([para(':: no term'), para('no definition ::')])).toEqual([])
  })
  it('reads the line id an earlier sync stamped on the paragraph', () => {
    const stamped = { type: 'paragraph', attrs: { cardLine: 12 }, content: [{ type: 'text', text: 'Osmosis :: water' }] }
    expect(lines([stamped])).toEqual([{ lineId: 12, front: 'Osmosis', back: 'water', paragraph: 0 }])
  })
  it('takes a cloze line whole, with an optional extra after ::', () => {
    expect(lines([para('The {{c1::cell}} wall'), para('{{c1::Bern}} is a capital :: since 1848')])).toEqual([
      { lineId: null, front: 'The {{c1::cell}} wall', back: '', paragraph: 0 },
      { lineId: null, front: '{{c1::Bern}} is a capital', back: 'since 1848', paragraph: 1 }
    ])
  })
  it('joins text split across marks', () => {
    const marked = { type: 'paragraph', content: [{ type: 'text', text: 'Osmo', marks: [{ type: 'bold' }] }, { type: 'text', text: 'sis :: water' }] }
    expect(lines([marked])).toEqual([{ lineId: null, front: 'Osmosis', back: 'water', paragraph: 0 }])
  })

  describe('multi-line answers', () => {
    it('folds indented lines after a card line into its answer', () => {
      expect(lines([para('Krebs cycle :: in the mitochondria'), para('  makes NADH'), para('\tand FADH2'), para('Next line')])).toEqual([
        { lineId: null, front: 'Krebs cycle', back: 'in the mitochondria\nmakes NADH\nand FADH2', paragraph: 0 }
      ])
    })
    it('lets the answer start on the next line', () => {
      expect(lines([para('Krebs cycle ::'), para('  step one'), para('  step two')])).toEqual([
        { lineId: null, front: 'Krebs cycle', back: 'step one\nstep two', paragraph: 0 }
      ])
    })
    it('keeps an indented line that follows plain text as plain text', () => {
      expect(lines([para('Intro'), para('  Osmosis :: water')])).toEqual([{ lineId: null, front: 'Osmosis', back: 'water', paragraph: 1 }])
    })
    it('stops at a blank line, and an indented :: line after it is a card of its own', () => {
      expect(lines([para('A :: 1'), { type: 'paragraph' }, para('  B :: 2')]).map((l: { front: string }) => l.front)).toEqual(['A', 'B'])
    })
    it('reads Shift+Enter breaks as new lines of the answer', () => {
      const broken = { type: 'paragraph', content: [{ type: 'text', text: 'Osmosis :: water' }, { type: 'hardBreak' }, { type: 'text', text: 'across a membrane' }] }
      expect(lines([broken])).toEqual([{ lineId: null, front: 'Osmosis', back: 'water\nacross a membrane', paragraph: 0 }])
    })
    it('drops a Term :: line whose answer never comes', () => {
      expect(lines([para('Krebs cycle ::'), para('Next line')])).toEqual([])
    })
  })
})

describe('parseCardLine', () => {
  it('rejects plain text and a :: with nothing after it', () => {
    expect(parseCardLine('just text')).toBeNull()
    expect(parseCardLine('Term ::')).toBeNull()
  })
})

describe('extractNoteTaskItems', () => {
  const taskItem = (text: string, checked: boolean, extra: unknown[] = []): unknown => ({
    type: 'taskItem',
    attrs: { checked, taskId: null },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...extra]
  })

  it('extracts flat checklist items with their checked state', () => {
    const d = JSON.parse(doc([{ type: 'taskList', content: [taskItem('Read chapter 4', false), taskItem('Email group', true)] }]))
    const items = extractNoteTaskItems(d)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: 'Read chapter 4', checked: false })
    expect(items[1]).toMatchObject({ title: 'Email group', checked: true })
  })

  it('does NOT fold a nested subtask into its parent title (regression)', () => {
    const nested = { type: 'taskList', content: [taskItem('Milk', true)] }
    const d = JSON.parse(doc([{ type: 'taskList', content: [taskItem('Groceries', false, [nested])] }]))
    const items = extractNoteTaskItems(d)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Groceries') // not "GroceriesMilk"
    expect(items[1].title).toBe('Milk')
  })
})

describe('fuzzyScore', () => {
  it('rewards a direct substring match', () => {
    expect(fuzzyScore('cal', 'Calendar')).toBeGreaterThan(0)
  })
  it('matches subsequences and rejects non-matches', () => {
    expect(fuzzyScore('cnr', 'Calendar')).toBeGreaterThan(0)
    expect(fuzzyScore('xyz', 'Calendar')).toBe(-1)
  })
  it('an empty query matches anything', () => {
    expect(fuzzyScore('', 'anything')).toBe(1)
  })
})
