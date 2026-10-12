import { describe, it, expect, vi, beforeEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    settings: { all: vi.fn(async (): Promise<Record<string, string>> => ({})) },
    notebooks: { home: vi.fn(async () => 3) },
    notes: {
      restore: vi.fn(async () => undefined),
      create: vi.fn(async () => ({ id: 77 }))
    }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp, useData, watchFocus, trackSave, registerFlush, settleNote } from '../src/renderer/src/stores/app'

beforeEach(() => {
  useApp.setState({ view: 'notes', selectedNoteId: null, reviewingDeckId: null, homeNotebookId: 3 })
  inkling.notes.restore.mockClear()
  inkling.notes.create.mockClear()
})

describe('reviewDeck', () => {
  it("starts the due deck's review session, not its editor", () => {
    useApp.setState({ view: 'today' })
    useApp.getState().reviewDeck(9)
    const s = useApp.getState()
    expect(s.view).toBe('study')
    expect(s.reviewingDeckId).toBe(9)
    expect(s.selectedDeckId).toBeNull()
  })
  it('leaves the session on any navigation', () => {
    useApp.getState().reviewDeck(9)
    useApp.getState().setView('notes')
    expect(useApp.getState().reviewingDeckId).toBeNull()
    useApp.getState().reviewDeck(9)
    useApp.getState().openNote(4)
    expect(useApp.getState().reviewingDeckId).toBeNull()
    useApp.getState().reviewDeck(9)
    useApp.getState().openDeck(2)
    expect(useApp.getState().reviewingDeckId).toBeNull()
  })
})

describe('restoreNote', () => {
  it('reopens an undone note', async () => {
    await useApp.getState().restoreNote(42)
    expect(inkling.notes.restore).toHaveBeenCalledWith(42)
    const s = useApp.getState()
    expect(s.selectedNoteId).toBe(42)
    expect(s.view).toBe('notes')
    expect(useData.getState().versions['notes']).toBeGreaterThan(0)
  })
})

describe('newNote', () => {
  it('makes the note in the home notebook and opens it', async () => {
    useApp.setState({ view: 'today' })
    await useApp.getState().newNote()
    expect(inkling.notes.create).toHaveBeenCalledWith({ notebook_id: 3 })
    expect(useApp.getState().view).toBe('notes')
    expect(useApp.getState().selectedNoteId).toBe(77)
  })
})

describe('watchFocus', () => {
  it('refetches notes, to-dos and decks when the window comes back, until stopped', () => {
    const target = new EventTarget()
    const stop = watchFocus(target)
    const before = { ...useData.getState().versions }
    target.dispatchEvent(new Event('focus'))
    const after = useData.getState().versions
    for (const domain of ['notes', 'tasks', 'decks']) expect(after[domain]).toBe((before[domain] ?? 0) + 1)
    stop()
    target.dispatchEvent(new Event('focus'))
    expect(useData.getState().versions['notes']).toBe(after['notes'])
  })
})

describe('settleNote', () => {
  it("starts the open editor's pending save and waits for every save of that note", async () => {
    const order: string[] = []
    let finishEarlier!: () => void
    void trackSave(5, new Promise<void>((r) => (finishEarlier = r)).then(() => void order.push('earlier save')))
    const unregister = registerFlush(5, () => {
      void trackSave(5, Promise.resolve().then(() => void order.push('flushed save')))
    })
    // Another note's save is not waited for.
    void trackSave(6, new Promise<void>(() => {}))
    const settled = settleNote(5).then(() => void order.push('settled'))
    setTimeout(finishEarlier, 5)
    await settled
    expect(order).toEqual(['flushed save', 'earlier save', 'settled'])
    unregister()
  })

  it('waits for failed saves too and resolves at once when nothing is pending', async () => {
    void trackSave(8, Promise.reject(new Error('offline'))).catch(() => undefined)
    await expect(settleNote(8)).resolves.toBeUndefined()
    await expect(settleNote(9)).resolves.toBeUndefined()
  })
})

describe('init', () => {
  it('keeps the saved theme for the failed-start screen when only the notebook could not be read', async () => {
    inkling.settings.all.mockResolvedValueOnce({ theme: 'dark' })
    inkling.notebooks.home.mockRejectedValueOnce(new Error('locked'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useApp.setState({ ready: false, failed: false, theme: 'light' })
    await useApp.getState().init()
    quiet.mockRestore()
    expect(useApp.getState().failed).toBe(true)
    expect(useApp.getState().theme).toBe('dark')
  })

  it("falls back to the system's theme when the settings could not be read", async () => {
    inkling.settings.all.mockRejectedValueOnce(new Error('locked'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const win = globalThis as unknown as { window: { matchMedia?: (q: string) => { matches: boolean } } }
    win.window.matchMedia = (q) => ({ matches: q === '(prefers-color-scheme: dark)' })
    useApp.setState({ ready: false, failed: false, theme: 'light' })
    await useApp.getState().init()
    quiet.mockRestore()
    delete win.window.matchMedia
    expect(useApp.getState().failed).toBe(true)
    expect(useApp.getState().theme).toBe('dark')
  })
})
