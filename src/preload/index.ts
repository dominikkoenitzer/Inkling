import { contextBridge, ipcRenderer } from 'electron'
import type { AppCommand, InklingApi } from '@shared/api'

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
    dropIfEmpty: invoke('notes.dropIfEmpty'),
    saveWithTasks: invoke('notes.saveWithTasks'),
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
  assistants: {
    list: invoke('assistants.list'),
    connect: invoke('assistants.connect'),
    disconnect: invoke('assistants.disconnect'),
    copySetup: invoke('assistants.copySetup')
  },
  events: {
    onDataChanged: (fn) => {
      const listener = (): void => fn()
      ipcRenderer.on('data.changed', listener)
      return () => void ipcRenderer.removeListener('data.changed', listener)
    },
    onCommand: (fn) => {
      const listener = (_event: unknown, command: AppCommand): void => fn(command)
      ipcRenderer.on('app.command', listener)
      // Commands picked while the page loaded wait in the main process until this point.
      ipcRenderer.send('app.listening')
      return () => void ipcRenderer.removeListener('app.command', listener)
    }
  },
  app: {
    setTitlebar: invoke('app.setTitlebar'),
    saveFile: invoke('app.saveFile')
  }
}

contextBridge.exposeInMainWorld('inkling', api)
