import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import * as repos from './repos'
import { CHROME, TITLEBAR_HEIGHT, themeOf } from './window'
import { RATINGS } from '@shared/fsrs'
import type { ReviewGrade } from '@shared/types'

/** The only setting the renderer writes; the rest are read-only from there. */
const WRITABLE_SETTINGS = new Set(['theme'])
const GRADES = new Set(Object.keys(RATINGS))

type Handler = (...args: never[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (_event, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
}

export function registerIpc(): void {
  handle('notebooks.home', repos.homeNotebookId)

  handle('notes.list', repos.listNotes)
  handle('notes.get', repos.getNote)
  handle('notes.create', repos.createNote)
  handle('notes.update', repos.updateNote)
  handle('notes.remove', repos.removeNote)
  handle('notes.restore', repos.restoreNote)
  handle('notes.syncTasks', repos.syncNoteTasks)
  handle('notes.syncCards', repos.syncNoteCards)

  handle('tasks.open', repos.openTasks)
  handle('tasks.setDone', repos.setTaskDone)

  handle('decks.list', repos.listDecks)
  handle('decks.create', repos.createDeck)
  handle('decks.rename', repos.renameDeck)
  handle('decks.remove', repos.removeDeck)
  handle('decks.cards', repos.listCards)
  handle('decks.dueCards', repos.dueCards)
  handle('decks.addCard', repos.addCard)
  handle('decks.updateCard', repos.updateCard)
  handle('decks.removeCard', repos.removeCard)
  handle('decks.review', (cardId: number, grade: ReviewGrade) => {
    if (!GRADES.has(grade)) throw new Error(`unknown grade: ${String(grade)}`)
    return repos.reviewCard(cardId, grade)
  })

  handle('settings.all', repos.allSettings)
  handle('settings.set', (key: string, value: string) => {
    if (!WRITABLE_SETTINGS.has(key) || typeof value !== 'string') throw new Error(`setting cannot be written: ${String(key)}`)
    repos.setSetting(key, value)
  })

  handle('search.query', repos.searchQuery)

  ipcMain.handle('app.setTitlebar', (event, theme: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      win?.setTitleBarOverlay({ ...CHROME[themeOf(theme)], height: TITLEBAR_HEIGHT })
      win?.setBackgroundColor(CHROME[themeOf(theme)].color)
    } catch {
      /* not supported on this platform */
    }
  })

  // Native "save as" for exporting text (e.g. a note as Markdown).
  ipcMain.handle('app.saveFile', async (event, defaultName: string, contents: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    try {
      fs.writeFileSync(result.filePath, contents, 'utf8')
      return { saved: true, path: result.filePath }
    } catch (err) {
      console.error('saveFile failed', err)
      return { saved: false, path: null, error: String(err) }
    }
  })
}
