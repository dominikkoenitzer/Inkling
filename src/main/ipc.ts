import { ipcMain, BrowserWindow, dialog, app } from 'electron'
import fs from 'fs'
import { join } from 'path'
import * as repos from './repos'
import { printableDocument } from '@shared/tiptapHtml'
import type { QuickAddPayload } from '@shared/types'

/** Broadcast a data change to every window except the one that caused it. */
function broadcast(senderId: number, domain: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.id !== senderId && !win.isDestroyed()) {
      win.webContents.send('data:changed', domain)
    }
  }
}

type Handler = (...args: never[]) => unknown

function handle(channel: string, fn: Handler, mutates?: string): void {
  ipcMain.handle(channel, (event, ...args) => {
    const result = (fn as (...a: unknown[]) => unknown)(...args)
    if (mutates) broadcast(event.sender.id, mutates)
    return result
  })
}

export function registerIpc(hideQuickAdd: () => void): void {
  handle('notebooks.list', repos.listNotebooks)
  handle('notebooks.create', repos.createNotebook, 'notebooks')
  handle('notebooks.update', repos.updateNotebook, 'notebooks')
  handle('notebooks.remove', repos.removeNotebook, 'notebooks')

  handle('notes.list', repos.listNotes)
  handle('notes.get', repos.getNote)
  handle('notes.create', repos.createNote, 'notes')
  handle('notes.update', repos.updateNote, 'notes')
  handle('notes.remove', repos.removeNote, 'notes')
  handle('notes.syncTasks', repos.syncNoteTasks, 'tasks')

  handle('tasks.list', repos.listTasks)
  handle('tasks.smart', repos.smartTasks)
  handle('tasks.forNote', repos.tasksForNote)
  handle('tasks.get', repos.getTask)
  handle('tasks.create', repos.createTask, 'tasks')
  handle('tasks.update', repos.updateTask, 'tasks')
  handle('tasks.remove', repos.removeTask, 'tasks')

  handle('decks.list', repos.listDecks)
  handle('decks.create', repos.createDeck, 'decks')
  handle('decks.rename', repos.renameDeck, 'decks')
  handle('decks.remove', repos.removeDeck, 'decks')
  handle('decks.cards', repos.listCards)
  handle('decks.dueCards', repos.dueCards)
  handle('decks.addCard', repos.addCard, 'decks')
  handle('decks.updateCard', repos.updateCard, 'decks')
  handle('decks.removeCard', repos.removeCard, 'decks')
  handle('decks.review', repos.reviewCard, 'decks')
  handle('decks.createFromPairs', repos.createDeckFromPairs, 'decks')

  handle('focus.start', repos.startFocus)
  handle('focus.complete', repos.completeFocus, 'focus')
  handle('focus.todayMinutes', repos.todayFocusMinutes)

  handle('streak.get', repos.getStreak)
  handle('streak.bump', repos.bumpStreak, 'streak')

  handle('settings.all', repos.allSettings)
  handle('settings.set', repos.setSetting, 'settings')

  handle('search.query', repos.searchQuery)

  handle('grades.list', repos.listGrades)
  handle('grades.all', repos.listAllGrades)
  handle('grades.create', repos.createGrade, 'grades')
  handle('grades.update', repos.updateGrade, 'grades')
  handle('grades.remove', repos.removeGrade, 'grades')

  handle('app.completeOnboarding', repos.completeOnboarding, 'notebooks')

  ipcMain.handle('app.setTitlebar', (event, colors: { color: string; symbolColor: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      win?.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 36 })
    } catch {
      /* not supported on this platform */
    }
  })

  ipcMain.handle('app.quickAdd', (event, payload: QuickAddPayload) => {
    const notebooks = repos.listNotebooks()
    const nb = notebooks.find((n) => !n.is_journal) ?? notebooks[0]
    if (!nb) return
    if (payload.kind === 'task') {
      repos.createTask({ notebook_id: nb.id, title: payload.text, due_date: payload.due ?? null })
    } else {
      repos.createNote({
        notebook_id: nb.id,
        type: 'page',
        title: payload.text.slice(0, 80),
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: payload.text }] }] })
      })
    }
    broadcast(event.sender.id, payload.kind === 'task' ? 'tasks' : 'notes')
  })

  ipcMain.handle('app.hideQuickAdd', () => hideQuickAdd())

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

  // Export rendered note HTML to a PDF via a hidden print window. We render from a temp
  // file (not a data: URL) so large notebooks don't hit Chromium's ~2MB URL cap.
  ipcMain.handle('app.savePdf', async (event, bodyHtml: string, title: string, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const tmpPath = join(app.getPath('temp'), `inkling-print-${process.pid}-${Date.now()}.html`)
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    try {
      fs.writeFileSync(tmpPath, printableDocument(title, bodyHtml), 'utf8')
      await printer.loadFile(tmpPath)
      const pdf = await printer.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
      })
      fs.writeFileSync(result.filePath, pdf)
      return { saved: true, path: result.filePath }
    } catch (err) {
      console.error('savePdf failed', err)
      return { saved: false, path: null, error: String(err) }
    } finally {
      if (!printer.isDestroyed()) printer.destroy()
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* temp file may not exist */
      }
    }
  })
}
