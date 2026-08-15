import { describe, it, expect } from 'vitest'
import { detectDelimiter, splitRow, looksLikeHeader, parseDeckFile, nameFromPath } from '../src/shared/deckImport'

describe('detectDelimiter', () => {
  it('finds tabs, semicolons, commas and ::', () => {
    expect(detectDelimiter('a\tb\nc\td')).toBe('\t')
    expect(detectDelimiter('a;b\nc;d')).toBe(';')
    expect(detectDelimiter('a,b\nc,d')).toBe(',')
    expect(detectDelimiter('a :: b\nc :: d')).toBe('::')
  })

  it('prefers tabs over commas when a field contains prose commas', () => {
    // Every row splits on tab into 2; splitting on comma would cut the answers apart.
    expect(detectDelimiter('Mitochondria\tThe powerhouse, roughly\nOsmosis\tWater, moving')).toBe('\t')
  })

  it('falls back to tab on empty input', () => {
    expect(detectDelimiter('')).toBe('\t')
    expect(detectDelimiter('\n \n')).toBe('\t')
  })
})

describe('splitRow', () => {
  it('splits plain rows', () => {
    expect(splitRow('a,b,c', ',')).toEqual(['a', 'b', 'c'])
  })

  it('honours quoted fields containing the delimiter', () => {
    expect(splitRow('"one, two",three', ',')).toEqual(['one, two', 'three'])
  })

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(splitRow('"say ""hi""",x', ',')).toEqual(['say "hi"', 'x'])
  })

  it('splits :: on the first occurrence only, so the answer can contain ::', () => {
    expect(splitRow('Term :: def :: more', '::')).toEqual(['Term ', ' def :: more'])
  })

  it('returns a single cell when the delimiter is absent', () => {
    expect(splitRow('lonely', ',')).toEqual(['lonely'])
    expect(splitRow('lonely', '::')).toEqual(['lonely'])
  })
})

describe('looksLikeHeader', () => {
  it('recognises common export headers', () => {
    expect(looksLikeHeader(['Front', 'Back'])).toBe(true)
    expect(looksLikeHeader(['term', 'definition'])).toBe(true)
    expect(looksLikeHeader(['Question', 'Answer'])).toBe(true)
  })

  it('does not mistake a real card for a header', () => {
    expect(looksLikeHeader(['Mitochondria', 'The powerhouse of the cell'])).toBe(false)
    expect(looksLikeHeader(['Front'])).toBe(false)
  })
})

describe('parseDeckFile', () => {
  it('parses a simple CSV and reports the delimiter it used', () => {
    const r = parseDeckFile('a,1\nb,2')
    expect(r.pairs).toEqual([
      ['a', '1'],
      ['b', '2']
    ])
    expect(r.delimiter).toBe(',')
    expect(r.skipped).toBe(0)
  })

  it('drops a header row', () => {
    const r = parseDeckFile('Front,Back\nMitochondria,Powerhouse')
    expect(r.pairs).toEqual([['Mitochondria', 'Powerhouse']])
  })

  it('counts rows with no usable pair as skipped rather than importing blanks', () => {
    const r = parseDeckFile('a,1\nlonely\n,2\nb,3')
    expect(r.pairs).toEqual([
      ['a', '1'],
      ['b', '3']
    ])
    expect(r.skipped).toBe(2)
  })

  it('folds extra columns into the answer instead of dropping them', () => {
    const r = parseDeckFile('term\tdef\ttag\n', '\t')
    expect(r.pairs).toEqual([['term', 'def · tag']])
  })

  it('handles `Term :: Definition` lines, the syntax notes already use', () => {
    const r = parseDeckFile('Photosynthesis :: Light into energy\nOsmosis :: Water moving')
    expect(r.delimiter).toBe('::')
    expect(r.pairs).toEqual([
      ['Photosynthesis', 'Light into energy'],
      ['Osmosis', 'Water moving']
    ])
  })

  it('ignores blank lines and trims whitespace', () => {
    const r = parseDeckFile('\n a , 1 \n\n b , 2 \n')
    expect(r.pairs).toEqual([
      ['a', '1'],
      ['b', '2']
    ])
  })

  it('survives CRLF line endings', () => {
    expect(parseDeckFile('a,1\r\nb,2\r\n').pairs).toEqual([
      ['a', '1'],
      ['b', '2']
    ])
  })

  it('returns nothing usable for an empty file', () => {
    expect(parseDeckFile('').pairs).toEqual([])
  })
})

describe('nameFromPath', () => {
  it('strips the directory and extension', () => {
    expect(nameFromPath('C:\\Users\\me\\biology-ch4.csv')).toBe('biology-ch4')
    expect(nameFromPath('/home/me/notes/deck.tsv')).toBe('deck')
    expect(nameFromPath('plain')).toBe('plain')
  })

  it('falls back rather than returning an empty name', () => {
    expect(nameFromPath('.csv')).toBe('Imported')
  })
})
