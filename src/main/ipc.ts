import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
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

  handle('events.window', repos.eventsWindow)
  handle('events.create', repos.createEvent, 'events')
  handle('events.update', repos.updateEvent, 'events')
  handle('events.remove', repos.removeEvent, 'events')

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
    } else if (payload.kind === 'event') {
      const start = payload.start ?? new Date().toISOString()
      repos.createEvent({
        notebook_id: nb.id,
        title: payload.text,
        start_time: start,
        end_time: payload.end ?? new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString()
      })
    } else {
      repos.createNote({
        notebook_id: nb.id,
        type: 'page',
        title: payload.text.slice(0, 80),
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: payload.text }] }] })
      })
    }
    broadcast(event.sender.id, payload.kind === 'task' ? 'tasks' : payload.kind === 'event' ? 'events' : 'notes')
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
    fs.writeFileSync(result.filePath, contents, 'utf8')
    return { saved: true, path: result.filePath }
  })

  // Export rendered note HTML to a PDF via an offscreen print window.
  ipcMain.handle('app.savePdf', async (event, bodyHtml: string, title: string, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    try {
      await printer.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(printableDocument(title, bodyHtml)))
      const pdf = await printer.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
      })
      fs.writeFileSync(result.filePath, pdf)
    } finally {
      if (!printer.isDestroyed()) printer.destroy()
    }
    return { saved: true, path: result.filePath }
  })
}
