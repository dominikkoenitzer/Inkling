import { describe, it, expect } from 'vitest'
import { extractTags } from '../src/shared/tags'

describe('extractTags', () => {
  it('finds a tag at the start of the text and after whitespace', () => {
    expect(extractTags('#biology is fun')).toEqual(['biology'])
    expect(extractTags('revising #biology tonight')).toEqual(['biology'])
  })

  it('finds tags after an opening bracket or brace', () => {
    expect(extractTags('(#exam)')).toEqual(['exam'])
    expect(extractTags('[#lab]')).toEqual(['lab'])
  })

  it('lower-cases and de-duplicates', () => {
    expect(extractTags('#Bio #bio #BIO')).toEqual(['bio'])
  })

  it('allows digits, underscores and hyphens after the first letter', () => {
    expect(extractTags('#chapter-4 #unit_2 #week3')).toEqual(['chapter-4', 'unit_2', 'week3'])
  })

  it('is unicode-aware', () => {
    expect(extractTags('#biologie #物理 #übung')).toEqual(['biologie', '物理', 'übung'])
  })

  it('requires a letter first, so a bare number is not a tag', () => {
    expect(extractTags('#1 #2026 issue')).toEqual([])
  })

  it('ignores a hash glued to the end of a word, so a hex colour is not a tag', () => {
    expect(extractTags('colour is #fff and code#1')).toEqual(['fff'])
    expect(extractTags('code#1')).toEqual([])
  })

  it('stops at punctuation', () => {
    expect(extractTags('due #exam, then #lab.')).toEqual(['exam', 'lab'])
  })

  it('returns nothing for text with no tags', () => {
    expect(extractTags('plain text with a # on its own')).toEqual([])
    expect(extractTags('')).toEqual([])
  })

  it('caps a runaway tag rather than storing an entire paragraph', () => {
    const long = 'a'.repeat(200)
    const [tag] = extractTags(`#${long}`)
    expect(tag.length).toBe(50)
  })
})
