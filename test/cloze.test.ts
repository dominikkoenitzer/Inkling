import { describe, it, expect } from 'vitest'
import { clozeNumbers, hasCloze, renderCloze, separatorIndex } from '../src/shared/cloze'

describe('clozeNumbers', () => {
  it('lists each cloze number once, in order', () => {
    expect(clozeNumbers('{{c2::b}} and {{c1::a}} and {{c2::c}}')).toEqual([1, 2])
  })
  it('is empty for plain text and for broken or empty markup', () => {
    expect(clozeNumbers('Mitochondria :: the powerhouse')).toEqual([])
    expect(clozeNumbers('{{c1::}} {{c0::x}} {{c1:x}} {{cx::y}}')).toEqual([])
    expect(hasCloze('{{c1::x}}')).toBe(true)
  })
})

describe('renderCloze', () => {
  const text = 'The {{c1::mitochondria}} is the {{c2::powerhouse::what?}} of the cell'

  it('hides only the asked cloze and shows the others as text', () => {
    expect(renderCloze(text, 1, false)).toEqual([
      { text: 'The ', kind: 'plain' },
      { text: '[…]', kind: 'blank' },
      { text: ' is the powerhouse of the cell', kind: 'plain' }
    ])
  })
  it('shows the hint in the blank', () => {
    expect(renderCloze(text, 2, false)[1]).toEqual({ text: '[what?]', kind: 'blank' })
  })
  it('reveals the answer in place', () => {
    expect(renderCloze(text, 2, true)).toEqual([
      { text: 'The mitochondria is the ', kind: 'plain' },
      { text: 'powerhouse', kind: 'answer' },
      { text: ' of the cell', kind: 'plain' }
    ])
  })
  it('hides every span of the same number', () => {
    const parts = renderCloze('{{c1::a}}, {{c1::b}}', 1, false)
    expect(parts.filter((p) => p.kind === 'blank')).toHaveLength(2)
  })
})

describe('separatorIndex', () => {
  it('skips the :: inside cloze markup', () => {
    const line = 'The {{c1::cell}} wall :: plants only'
    expect(separatorIndex(line)).toBe(line.indexOf(' :: ') + 1)
    expect(separatorIndex('{{c1::a::hint}} only')).toBe(-1)
  })
  it('finds a plain separator', () => {
    expect(separatorIndex('Term :: Definition')).toBe(5)
  })
})
