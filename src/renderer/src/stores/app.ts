import { create } from 'zustand'
import type { ModuleTab, Notebook, StreakInfo } from '@shared/types'
import type { GradingSystem } from '@shared/grades'

const api = window.inkling

export type Theme = 'dark' | 'cozy'

const isGradingSystem = (v: string | undefined): v is GradingSystem => v === 'percent' || v === 'swiss'

/** A transient message at the bottom of the window, optionally with one undo action. */
export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}
let toastSeq = 0

/** Local YYYY-MM-DD key for streak bookkeeping. The single source of what "today" means. */
export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface AppState {
  ready: boolean
  theme: Theme
  gradingSystem: GradingSystem
  notebooks: Notebook[]
  activeNotebookId: number | null
  tab: ModuleTab
  selectedNoteId: number | null
  selectedTaskId: number | null
  selectedDeckId: number | null
  paletteOpen: boolean
  settingsOpen: boolean
  streak: StreakInfo
  celebrating: boolean
  toast: Toast | null

  init(): Promise<void>
  refreshNotebooks(): Promise<void>
  refreshStreak(): Promise<void>
  setTheme(t: Theme): void
  setGradingSystem(v: GradingSystem): void
  setActiveNotebook(id: number): void
  setTab(tab: ModuleTab): void
  openNote(notebookId: number, noteId: number): void
  openTask(notebookId: number, taskId: number): void
  setSelectedNote(id: number | null): void
  setSelectedTask(id: number | null): void
  setSelectedDeck(id: number | null): void
  openDeck(notebookId: number, deckId: number): void
  setPaletteOpen(v: boolean): void
  setSettingsOpen(v: boolean): void
  celebrate(): void
  showToast(t: Omit<Toast, 'id'>): void
  dismissToast(): void
  bumpStreak(): Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  theme: 'dark',
  gradingSystem: 'percent',
  notebooks: [],
  activeNotebookId: null,
  tab: 'today',
  selectedNoteId: null,
  selectedTaskId: null,
  selectedDeckId: null,
  paletteOpen: false,
  settingsOpen: false,
  streak: { count: 0, last_day: null },
  celebrating: false,
  toast: null,

  init: async () => {
    const [settings, notebooks, streak] = await Promise.all([api.settings.all(), api.notebooks.list(), api.streak.get()])
    set({
      ready: true,
      theme: settings['theme'] === 'cozy' ? 'cozy' : 'dark',
      gradingSystem: isGradingSystem(settings['grading_system']) ? settings['grading_system'] : 'percent',
      notebooks,
      activeNotebookId: notebooks[0]?.id ?? null,
      streak
    })
  },

  refreshNotebooks: async () => {
    const notebooks = await api.notebooks.list()
    const { activeNotebookId } = get()
    const stillThere = notebooks.some((n) => n.id === activeNotebookId)
    // When the active notebook was deleted, its notes/tasks/decks are gone too, so drop any
    // selection into them (mirrors setActiveNotebook) so MainPane can't render a phantom item.
    set({
      notebooks,
      activeNotebookId: stillThere ? activeNotebookId : (notebooks[0]?.id ?? null),
      ...(stillThere ? {} : { selectedNoteId: null, selectedTaskId: null, selectedDeckId: null })
    })
  },

  refreshStreak: async () => set({ streak: await api.streak.get() }),

  setTheme: (theme) => {
    set({ theme })
    void api.settings.set('theme', theme)
  },
  setGradingSystem: (gradingSystem) => {
    set({ gradingSystem })
    void api.settings.set('grading_system', gradingSystem)
  },

  setActiveNotebook: (id) => set({ activeNotebookId: id, selectedNoteId: null, selectedTaskId: null, selectedDeckId: null }),
  setTab: (tab) => set({ tab }),
  openNote: (notebookId, noteId) => set({ activeNotebookId: notebookId, tab: 'notes', selectedNoteId: noteId, paletteOpen: false }),
  openTask: (notebookId, taskId) => set({ activeNotebookId: notebookId, tab: 'tasks', selectedTaskId: taskId, paletteOpen: false }),
  setSelectedNote: (selectedNoteId) => set({ selectedNoteId }),
  setSelectedTask: (selectedTaskId) => set({ selectedTaskId }),
  setSelectedDeck: (selectedDeckId) => set({ selectedDeckId }),
  openDeck: (notebookId, deckId) => set({ activeNotebookId: notebookId, tab: 'study', selectedDeckId: deckId, paletteOpen: false }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  celebrate: () => {
    set({ celebrating: true })
    setTimeout(() => set({ celebrating: false }), 700)
  },

  showToast: (t) => {
    const id = ++toastSeq
    set({ toast: { ...t, id } })
    // Auto-dismiss, but only if this toast is still the one on screen; a newer toast
    // must not be cut short by an older one's timer.
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, t.durationMs ?? 6000)
  },
  dismissToast: () => set({ toast: null }),

  bumpStreak: async () => {
    const streak = await api.streak.bump(localDayKey())
    set({ streak })
  }
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

export const useVersion = (domain: string): number => useData((s) => s.versions[domain] ?? 0)
export const bumpData = (domain: string): void => useData.getState().bump(domain)
