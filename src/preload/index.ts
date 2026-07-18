import { contextBridge, ipcRenderer } from 'electron'
import type { InklingApi } from '@shared/api'

const invoke =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

const api: InklingApi = {
  notebooks: {
    list: invoke('notebooks.list'),
    create: invoke('notebooks.create'),
    update: invoke('notebooks.update'),
    remove: invoke('notebooks.remove')
  },
  notes: {
    list: invoke('notes.list'),
    get: invoke('notes.get'),
    create: invoke('notes.create'),
    update: invoke('notes.update'),
    remove: invoke('notes.remove'),
    syncTasks: invoke('notes.syncTasks')
  },
  tasks: {
    list: invoke('tasks.list'),
    smart: invoke('tasks.smart'),
    forNote: invoke('tasks.forNote'),
    get: invoke('tasks.get'),
    create: invoke('tasks.create'),
    update: invoke('tasks.update'),
    remove: invoke('tasks.remove')
  },
  decks: {
    list: invoke('decks.list'),
    create: invoke('decks.create'),
    rename: invoke('decks.rename'),
    remove: invoke('decks.remove'),
    cards: invoke('decks.cards'),
    dueCards: invoke('decks.dueCards'),
    addCard: invoke('decks.addCard'),
    updateCard: invoke('decks.updateCard'),
    removeCard: invoke('decks.removeCard'),
    review: invoke('decks.review'),
    createFromPairs: invoke('decks.createFromPairs')
  },
  focus: {
    start: invoke('focus.start'),
    complete: invoke('focus.complete'),
    todayMinutes: invoke('focus.todayMinutes')
  },
  streak: {
    get: invoke('streak.get'),
    bump: invoke('streak.bump')
  },
  settings: {
    all: invoke('settings.all'),
    set: invoke('settings.set')
  },
  search: {
    query: invoke('search.query')
  },
  grades: {
    list: invoke('grades.list'),
    all: invoke('grades.all'),
    create: invoke('grades.create'),
    update: invoke('grades.update'),
    remove: invoke('grades.remove')
  },
  app: {
    completeOnboarding: invoke('app.completeOnboarding'),
    setTitlebar: invoke('app.setTitlebar'),
    quickAdd: invoke('app.quickAdd'),
    hideQuickAdd: invoke('app.hideQuickAdd'),
    saveFile: invoke('app.saveFile'),
    savePdf: invoke('app.savePdf'),
    onDataChanged: (cb: (domain: string) => void) => {
      const listener = (_e: unknown, domain: string): void => cb(domain)
      ipcRenderer.on('data:changed', listener)
      return () => ipcRenderer.removeListener('data:changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('inkling', api)
