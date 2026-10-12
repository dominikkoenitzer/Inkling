import { create } from 'zustand'
import { parseParams } from '@shared/fsrs'
import { localDay } from '@shared/day'

const api = window.inkling

export type Theme = 'light' | 'dark'
export type View = 'today' | 'notes' | 'study'

/** A transient message at the bottom of the window, optionally with one undo action. */
export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}
let toastSeq = 0
let creatingNote = false

/** Milliseconds from `now` to the next local midnight, by the calendar (23 or 25 h across DST). */
export function msUntilNextLocalDay(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
}

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface AppState {
  ready: boolean
  /** Set when the data could not be read at start. */
  failed: boolean
  /** localDay() of the day the UI is showing; moves at local midnight and on focus. */
  today: string
  theme: Theme
  /** FSRS parameters, mirrored from the settings for the interval preview. */
  fsrsParams: number[]
  /** Where new notes and decks are stored. */
  homeNotebookId: number | null
  view: View
  selectedNoteId: number | null
  selectedDeckId: number | null
  /** The deck whose review session Study is showing. Any navigation leaves the session. */
  reviewingDeckId: number | null
  paletteOpen: boolean
  settingsOpen: boolean
  toast: Toast | null

  init(): Promise<void>
  /** Re-read the calendar day, e.g. after midnight or when the window returns. */
  syncDay(): void
  setTheme(t: Theme): void
  setView(v: View): void
  openNote(noteId: number): void
  /** Makes a note and opens it. */
  newNote(): Promise<void>
  /** Undo a note delete and open it again. */
  restoreNote(noteId: number): Promise<void>
  openDeck(deckId: number | null): void
  reviewDeck(deckId: number | null): void
  setPaletteOpen(v: boolean): void
  setSettingsOpen(v: boolean): void
  showToast(t: Omit<Toast, 'id'>): void
  dismissToast(): void
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  failed: false,
  today: localDay(),
  theme: 'light',
  fsrsParams: parseParams(null),
  homeNotebookId: null,
  view: 'today',
  selectedNoteId: null,
  selectedDeckId: null,
  reviewingDeckId: null,
  paletteOpen: false,
  settingsOpen: false,
  toast: null,

  init: async () => {
    // Asked for on its own, so a failed start can still show the saved theme.
    const stored = api.settings.all()
    try {
      const [settings, home] = await Promise.all([stored, api.notebooks.home()])
      set({
        ready: true,
        failed: false,
        theme: settings['theme'] === 'dark' ? 'dark' : 'light',
        fsrsParams: parseParams(settings['fsrs_params']),
        homeNotebookId: home
      })
    } catch (err) {
      console.error('could not load settings', err)
      const settings = await stored.catch(() => null)
      // The saved theme if it could be read, otherwise the system's.
      const theme: Theme = settings ? (settings['theme'] === 'dark' ? 'dark' : 'light') : systemTheme()
      set({ failed: true, theme })
    }
  },

  syncDay: () => {
    const today = localDay()
    if (today !== get().today) set({ today })
  },

  setTheme: (theme) => {
    set({ theme })
    void api.settings.set('theme', theme)
  },

  setView: (view) => set({ view, selectedDeckId: null, reviewingDeckId: null, paletteOpen: false }),
  openNote: (noteId) => set({ view: 'notes', selectedNoteId: noteId, reviewingDeckId: null, paletteOpen: false }),
  newNote: async () => {
    // One at a time: a held Ctrl+N or a double Enter makes one note, not a pile.
    if (creatingNote) return
    creatingNote = true
    try {
      const home = get().homeNotebookId ?? (await api.notebooks.home())
      const note = await api.notes.create({ notebook_id: home })
      bumpData('notes')
      set({ paletteOpen: false, settingsOpen: false })
      get().openNote(note.id)
    } finally {
      creatingNote = false
    }
  },
  restoreNote: async (noteId) => {
    await api.notes.restore(noteId)
    bumpData('notes')
    get().openNote(noteId)
  },
  openDeck: (deckId) => set({ view: 'study', selectedDeckId: deckId, reviewingDeckId: null, paletteOpen: false }),
  reviewDeck: (deckId) => set({ view: 'study', selectedDeckId: null, reviewingDeckId: deckId, paletteOpen: false }),
  // One overlay at a time.
  setPaletteOpen: (paletteOpen) => set(paletteOpen ? { paletteOpen, settingsOpen: false } : { paletteOpen }),
  setSettingsOpen: (settingsOpen) => set(settingsOpen ? { settingsOpen, paletteOpen: false } : { settingsOpen }),

  showToast: (t) => {
    const id = ++toastSeq
    set({ toast: { ...t, id } })
    // Only the toast still on screen may close itself; a newer one keeps its full time.
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, t.durationMs ?? 6000)
  },
  dismissToast: () => set({ toast: null })
}))

/* Per-domain change counters: bump on any mutation (local or from another window). */
interface DataState {
  versions: Record<string, number>
  bump(domain: string): void
}

export const useData = create<DataState>((set) => ({
  versions: {},
  bump: (domain) => set((s) => ({ versions: { ...s.versions, [domain]: (s.versions[domain] ?? 0) + 1 } }))
}))

/** Keeps `today` current: at each local midnight and whenever the window regains focus. */
export function watchDay(target: EventTarget = window): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const arm = (): void => {
    // A second past midnight, so the new day has surely begun when the timer lands.
    timer = setTimeout(() => {
      useApp.getState().syncDay()
      arm()
    }, msUntilNextLocalDay() + 1000)
  }
  const onFocus = (): void => useApp.getState().syncDay()
  arm()
  target.addEventListener('focus', onFocus)
  return () => {
    if (timer) clearTimeout(timer)
    target.removeEventListener('focus', onFocus)
  }
}

/** Refetches notes, tasks and decks when the window regains focus: another process may have written them. */
export function watchFocus(target: EventTarget = window): () => void {
  const onFocus = (): void => {
    const { bump } = useData.getState()
    for (const domain of ['notes', 'tasks', 'decks']) bump(domain)
  }
  target.addEventListener('focus', onFocus)
  return () => target.removeEventListener('focus', onFocus)
}

/* Note saves on their way to the main process, so a delete can wait for the last edit. */
const pendingSaves = new Map<number, Set<Promise<unknown>>>()
const flushers = new Map<number, () => void>()

/** Registers a note save until it lands or fails; returns the same promise. */
export function trackSave<T>(noteId: number, save: Promise<T>): Promise<T> {
  const set = pendingSaves.get(noteId) ?? new Set()
  pendingSaves.set(noteId, set)
  set.add(save)
  const done = (): void => {
    set.delete(save)
    if (set.size === 0 && pendingSaves.get(noteId) === set) pendingSaves.delete(noteId)
  }
  save.then(done, done)
  return save
}

/** The open editor's way to start its pending save now. Returns the unregister call. */
export function registerFlush(noteId: number, flush: () => void): () => void {
  flushers.set(noteId, flush)
  return () => {
    if (flushers.get(noteId) === flush) flushers.delete(noteId)
  }
}

/** Starts a note's pending save, then resolves once every save of it has landed or failed. */
export async function settleNote(noteId: number): Promise<void> {
  flushers.get(noteId)?.()
  await Promise.allSettled([...(pendingSaves.get(noteId) ?? [])])
}

export const useVersion = (domain: string): number => useData((s) => s.versions[domain] ?? 0)
export const bumpData = (domain: string): void => useData.getState().bump(domain)
