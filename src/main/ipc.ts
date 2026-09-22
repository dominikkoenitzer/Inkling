import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import * as repos from './repos'

type Handler = (...args: never[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (_event, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
}

export function registerIpc(): void {
  handle('notebooks.list', repos.listNotebooks)
  handle('notebooks.create', repos.createNotebook)
  handle('notebooks.update', repos.updateNotebook)
  handle('notebooks.remove', repos.removeNotebook)

  handle('notes.list', repos.listNotes)
  handle('notes.get', repos.getNote)
  handle('notes.create', repos.createNote)
  handle('notes.update', repos.updateNote)
  handle('notes.remove', repos.removeNote)
  handle('notes.restore', repos.restoreNote)
  handle('notes.syncTasks', repos.syncNoteTasks)

  handle('tasks.list', repos.listTasks)
  handle('tasks.smart', repos.smartTasks)
  handle('tasks.forNote', repos.tasksForNote)
  handle('tasks.get', repos.getTask)
  handle('tasks.create', repos.createTask)
  handle('tasks.update', repos.updateTask)
  handle('tasks.remove', repos.removeTask)

  handle('decks.list', repos.listDecks)
  handle('decks.create', repos.createDeck)
  handle('decks.rename', repos.renameDeck)
  handle('decks.remove', repos.removeDeck)
  handle('decks.cards', repos.listCards)
  handle('decks.dueCards', repos.dueCards)
  handle('decks.addCard', repos.addCard)
  handle('decks.updateCard', repos.updateCard)
  handle('decks.removeCard', repos.removeCard)
  handle('decks.review', repos.reviewCard)
  handle('decks.createFromPairs', repos.createDeckFromPairs)

  handle('focus.start', repos.startFocus)
  handle('focus.complete', repos.completeFocus)
  handle('focus.todayMinutes', repos.todayFocusMinutes)

  handle('streak.get', repos.getStreak)
  handle('streak.bump', repos.bumpStreak)

  handle('settings.all', repos.allSettings)
  handle('settings.set', repos.setSetting)

  handle('search.query', repos.searchQuery)

  handle('stats.overview', repos.statsOverview)
  handle('stats.activity', repos.activity)

  handle('grades.list', repos.listGrades)
  handle('grades.all', repos.listAllGrades)
  handle('grades.create', repos.createGrade)
  handle('grades.update', repos.updateGrade)
  handle('grades.remove', repos.removeGrade)

  ipcMain.handle('app.setTitlebar', (event, colors: { color: string; symbolColor: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      win?.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 36 })
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
