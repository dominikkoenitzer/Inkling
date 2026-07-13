import { describe, it, expect } from 'vitest'
import { extractFlashcardPairs, extractNoteTaskItems, parseQuickText, fuzzyScore } from '../src/renderer/src/lib/parse'

const doc = (content: unknown[]): string => JSON.stringify({ type: 'doc', content })
const para = (text: string): unknown => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('extractFlashcardPairs', () => {
  it('pulls "Term :: Definition" lines into pairs', () => {
    const json = doc([para('Photosynthesis :: converts light into energy'), para('just a normal line'), para('Mitochondria :: the powerhouse of the cell')])
    expect(extractFlashcardPairs(json)).toEqual([
      ['Photosynthesis', 'converts light into energy'],
      ['Mitochondria', 'the powerhouse of the cell']
    ])
  })
  it('ignores lines without a term or definition', () => {
    expect(extractFlashcardPairs(doc([para(':: no term'), para('no definition ::')]))).toEqual([])
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

describe('parseQuickText', () => {
  it('strips a trailing date word, keeping the real title', () => {
    const r = parseQuickText('buy milk friday')
    expect(r.text).toBe('buy milk')
    expect(r.when).toBeInstanceOf(Date)
  })

  it('falls back to a neutral title when the input is only a date/time (regression)', () => {
    expect(parseQuickText('at 5pm').text).toBe('Untitled')
    expect(parseQuickText('friday').text).toBe('Untitled')
    expect(parseQuickText('tomorrow').text).toBe('Untitled')
  })

  it('leaves plain text untouched with no date', () => {
    const r = parseQuickText('write the essay')
    expect(r.text).toBe('write the essay')
    expect(r.when).toBeNull()
  })

  it('interprets "at 5pm" as 17:00', () => {
    expect(parseQuickText('meeting at 5pm').when?.getHours()).toBe(17)
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
