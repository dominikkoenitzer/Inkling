import { describe, expect, it } from 'vitest'

import { tiptapToText } from '../src/main/repos/search'

const text = (value: string, bold = false): object => (bold ? { type: 'text', text: value, marks: [{ type: 'bold' }] } : { type: 'text', text: value })
const paragraph = (...content: object[]): object => ({ type: 'paragraph', content })
const doc = (...content: object[]): string => JSON.stringify({ type: 'doc', content })

describe('tiptapToText', () => {
  it('keeps a partly formatted word in one piece', () => {
    expect(tiptapToText(doc(paragraph(text('Photo', true), text('synthesis'))))).toBe('Photosynthesis')
  })

  it('keeps words apart across paragraphs, list items and line breaks', () => {
    const json = doc(
      paragraph(text('cell')),
      paragraph(text('wall'), { type: 'hardBreak' }, text('membrane')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('nucleus'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph(text('stain'))] }] }
    )
    expect(tiptapToText(json).split(/\s+/)).toEqual(['cell', 'wall', 'membrane', 'nucleus', 'stain'])
  })

  it('reads nothing out of an empty or broken document', () => {
    expect(tiptapToText(doc(paragraph()))).toBe('')
    expect(tiptapToText('not json')).toBe('')
  })
})

describe('tiptapToText in a table', () => {
  it('keeps the words of neighbouring cells apart', () => {
    const cell = (type: string, ...content: object[]): object => ({ type, content: [paragraph(...content)] })
    const json = doc({
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', text('Organ')), cell('tableHeader', text('Role'))] },
        { type: 'tableRow', content: [cell('tableCell', text('Liver')), cell('tableCell', text('filters'), { type: 'hardBreak' }, text('stores'))] }
      ]
    })
    expect(tiptapToText(json).split(/\s+/)).toEqual(['Organ', 'Role', 'Liver', 'filters', 'stores'])
  })
})
