import { contextBridge, ipcRenderer } from 'electron'
import type { InklingApi } from '@shared/api'

const invoke =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

const api: InklingApi = {
  notebooks: {
    home: invoke('notebooks.home')
  },
  notes: {
    list: invoke('notes.list'),
    get: invoke('notes.get'),
    create: invoke('notes.create'),
    update: invoke('notes.update'),
    remove: invoke('notes.remove'),
    restore: invoke('notes.restore'),
    syncTasks: invoke('notes.syncTasks'),
    syncCards: invoke('notes.syncCards')
  },
  tasks: {
    open: invoke('tasks.open'),
    setDone: invoke('tasks.setDone')
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
    review: invoke('decks.review')
  },
  settings: {
    all: invoke('settings.all'),
    set: invoke('settings.set')
  },
  search: {
    query: invoke('search.query')
  },
  app: {
    setTitlebar: invoke('app.setTitlebar'),
    saveFile: invoke('app.saveFile')
  }
}

contextBridge.exposeInMainWorld('inkling', api)
