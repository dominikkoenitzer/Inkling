import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

type Params = Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'misspelledWord' | 'dictionarySuggestions'> & {
  editFlags: Pick<ContextMenuParams['editFlags'], 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'>
}

/** The right-click menu: spelling suggestions for a misspelt word, then the edit commands that apply. */
export function contextMenu(
  params: Params,
  replace: (word: string) => void,
  learn: (word: string) => void,
  mac = process.platform === 'darwin'
): MenuItemConstructorOptions[] {
  const menu: MenuItemConstructorOptions[] = []
  if (params.misspelledWord) {
    for (const word of params.dictionarySuggestions) menu.push({ label: word, click: () => replace(word) })
    if (!params.dictionarySuggestions.length) menu.push({ label: 'No Guesses Found', enabled: false })
    menu.push({ type: 'separator' }, { label: mac ? 'Learn Spelling' : 'Add to Dictionary', click: () => learn(params.misspelledWord) }, { type: 'separator' })
  }
  const flags = params.editFlags
  if (params.isEditable) {
    menu.push(
      { role: 'cut', enabled: flags.canCut },
      { role: 'copy', enabled: flags.canCopy },
      { role: 'paste', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: flags.canSelectAll }
    )
  } else if (params.selectionText.trim()) {
    menu.push({ role: 'copy' })
  }
  return menu
}
