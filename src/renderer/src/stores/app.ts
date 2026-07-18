import { create } from 'zustand'
import type { ModuleTab, Notebook, StreakInfo } from '@shared/types'
import type { GradingSystem } from '@shared/grades'

const api = window.inkling

export type Theme = 'dark' | 'cozy'
export type FontScale = 's' | 'm' | 'l'
export type NotesView = 'pages' | 'board'

const isGradingSystem = (v: string | undefined): v is GradingSystem => v === 'percent' || v === 'us' || v === 'swiss'

/** Local YYYY-MM-DD key for streak bookkeeping. The single source of what "today" means. */
export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface AppState {
  ready: boolean
  onboardingDone: boolean
  theme: Theme
  contrast: boolean
  fontScale: FontScale
  gradingSystem: GradingSystem
  notebooks: Notebook[]
  activeNotebookId: number | null
  tab: ModuleTab
  notesView: NotesView
  selectedNoteId: number | null
  selectedTaskId: number | null
  selectedDeckId: number | null
  smartView: 'today' | 'week' | null
  paletteOpen: boolean
  settingsOpen: boolean
  streak: StreakInfo
  celebrating: boolean

  init(): Promise<void>
  refreshNotebooks(): Promise<void>
  refreshStreak(): Promise<void>
  setTheme(t: Theme): void
  setContrast(v: boolean): void
  setFontScale(v: FontScale): void
  setGradingSystem(v: GradingSystem): void
  setActiveNotebook(id: number): void
  setTab(tab: ModuleTab): void
  setNotesView(v: NotesView): void
  openNote(notebookId: number, noteId: number): void
  openTask(notebookId: number, taskId: number): void
  setSelectedNote(id: number | null): void
  setSelectedTask(id: number | null): void
  setSelectedDeck(id: number | null): void
  openDeck(notebookId: number, deckId: number): void
  setSmartView(v: 'today' | 'week' | null): void
  setPaletteOpen(v: boolean): void
  setSettingsOpen(v: boolean): void
  celebrate(): void
  bumpStreak(): Promise<void>
  finishOnboarding(): Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  onboardingDone: true,
  theme: 'dark',
  contrast: false,
  fontScale: 'm',
  gradingSystem: 'percent',
  notebooks: [],
  activeNotebookId: null,
  tab: 'today',
  notesView: 'pages',
  selectedNoteId: null,
  selectedTaskId: null,
  selectedDeckId: null,
  smartView: null,
  paletteOpen: false,
  settingsOpen: false,
  streak: { count: 0, last_day: null },
  celebrating: false,

  init: async () => {
    const [settings, notebooks, streak] = await Promise.all([api.settings.all(), api.notebooks.list(), api.streak.get()])
    set({
      ready: true,
      onboardingDone: settings['onboarding_done'] === '1',
      theme: settings['theme'] === 'cozy' ? 'cozy' : 'dark',
      contrast: settings['contrast'] === '1',
      fontScale: (settings['font_scale'] as FontScale) || 'm',
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
    // When the active notebook was deleted, its notes/tasks/decks are gone too — drop any
    // selection into them (mirrors setActiveNotebook) so MainPane can't render a phantom item.
    set({
      notebooks,
      activeNotebookId: stillThere ? activeNotebookId : (notebooks[0]?.id ?? null),
      ...(stillThere ? {} : { selectedNoteId: null, selectedTaskId: null, selectedDeckId: null, smartView: null })
    })
  },

  refreshStreak: async () => set({ streak: await api.streak.get() }),

  setTheme: (theme) => {
    set({ theme })
    void api.settings.set('theme', theme)
  },
  setContrast: (contrast) => {
    set({ contrast })
    void api.settings.set('contrast', contrast ? '1' : '0')
  },
  setFontScale: (fontScale) => {
    set({ fontScale })
    void api.settings.set('font_scale', fontScale)
  },
  setGradingSystem: (gradingSystem) => {
    set({ gradingSystem })
    void api.settings.set('grading_system', gradingSystem)
  },

  setActiveNotebook: (id) => set({ activeNotebookId: id, selectedNoteId: null, selectedTaskId: null, selectedDeckId: null, smartView: null }),
  setTab: (tab) => set({ tab }),
  setNotesView: (notesView) => set({ notesView }),
  openNote: (notebookId, noteId) =>
    set({ activeNotebookId: notebookId, tab: 'notes', notesView: 'pages', selectedNoteId: noteId, paletteOpen: false }),
  openTask: (notebookId, taskId) =>
    set({ activeNotebookId: notebookId, tab: 'tasks', selectedTaskId: taskId, smartView: null, paletteOpen: false }),
  setSelectedNote: (selectedNoteId) => set({ selectedNoteId }),
  setSelectedTask: (selectedTaskId) => set({ selectedTaskId }),
  setSelectedDeck: (selectedDeckId) => set({ selectedDeckId }),
  openDeck: (notebookId, deckId) => set({ activeNotebookId: notebookId, tab: 'study', selectedDeckId: deckId, paletteOpen: false }),
  setSmartView: (smartView) => set({ smartView, selectedTaskId: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  celebrate: () => {
    set({ celebrating: true })
    setTimeout(() => set({ celebrating: false }), 700)
  },

  bumpStreak: async () => {
    const streak = await api.streak.bump(localDayKey())
    set({ streak })
  },

  finishOnboarding: async () => {
    await get().refreshNotebooks()
    set({ onboardingDone: true })
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
