import { describe, expect, it } from 'vitest'
import { contextMenu } from '../src/main/context-menu'

const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

describe('contextMenu', () => {
  it('offers the spelling suggestions for a misspelt word first, and replaces it with the one picked', () => {
    const picked: string[] = []
    const menu = contextMenu(
      { isEditable: true, selectionText: '', misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], editFlags: flags },
      (word) => picked.push(word),
      () => {}
    )
    expect(menu.slice(0, 2).map((i) => i.label)).toEqual(['the', 'ten'])
    ;(menu[1].click as () => void)()
    expect(picked).toEqual(['ten'])
    expect(menu.map((i) => i.role).filter(Boolean)).toEqual(['cut', 'copy', 'paste', 'selectAll'])
  })

  it('learns a misspelt word so it is no longer marked, named as each system names it', () => {
    const learnt: string[] = []
    const params = { isEditable: true, selectionText: '', misspelledWord: 'Inkling', dictionarySuggestions: ['Inking'], editFlags: flags }
    const mac = contextMenu(params, () => {}, (word) => learnt.push(word), true)
    const item = mac.find((i) => i.label === 'Learn Spelling')
    expect(item).toBeDefined()
    ;(item!.click as () => void)()
    expect(learnt).toEqual(['Inkling'])
    expect(contextMenu(params, () => {}, () => {}, false).some((i) => i.label === 'Add to Dictionary')).toBe(true)
  })

  it('says so when the spell checker has no suggestion', () => {
    const menu = contextMenu({ isEditable: true, selectionText: '', misspelledWord: 'qzxv', dictionarySuggestions: [], editFlags: flags }, () => {})
    expect(menu[0]).toMatchObject({ label: 'No Guesses Found', enabled: false })
  })

  it('offers the edit commands in a field, each only when it can act', () => {
    const menu = contextMenu(
      { isEditable: true, selectionText: '', misspelledWord: '', dictionarySuggestions: [], editFlags: { ...flags, canCut: false, canCopy: false } },
      () => {}
    )
    expect(menu.map((i) => [i.role, i.enabled])).toEqual([
      ['cut', false],
      ['copy', false],
      ['paste', true],
      [undefined, undefined],
      ['selectAll', true]
    ])
  })

  it('offers Copy for selected text outside a field, and nothing on a bare spot', () => {
    expect(contextMenu({ isEditable: false, selectionText: 'word', misspelledWord: '', dictionarySuggestions: [], editFlags: flags }, () => {}).map((i) => i.role)).toEqual(['copy'])
    expect(contextMenu({ isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [], editFlags: flags }, () => {})).toEqual([])
  })
})
