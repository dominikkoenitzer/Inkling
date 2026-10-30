import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    settings: { all: vi.fn(async (): Promise<Record<string, string>> => ({})), set: vi.fn(async () => undefined) },
    notebooks: { home: vi.fn(async () => 3) },
    notes: {
      restore: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      dropIfEmpty: vi.fn(async () => false),
      create: vi.fn(async () => ({ id: 77 }))
    }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp, useData, watchFocus, trackSave, registerFlush, settleNote, deleteNote, forgetPlace } from '../src/renderer/src/stores/app'

beforeEach(() => {
  useApp.setState({ view: 'notes', selectedNoteId: null, reviewingDeckId: null, homeNotebookId: 3 })
  inkling.notes.restore.mockClear()
  inkling.notes.create.mockClear()
  inkling.notes.dropIfEmpty.mockClear()
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

describe('overlays', () => {
  it('shows one at a time', () => {
    const app = useApp.getState()
    app.setPaletteOpen(true)
    app.setShortcutsOpen(true)
    expect(useApp.getState()).toMatchObject({ shortcutsOpen: true, paletteOpen: false, settingsOpen: false })
    app.setSettingsOpen(true)
    expect(useApp.getState()).toMatchObject({ shortcutsOpen: false, paletteOpen: false, settingsOpen: true })
    app.setSettingsOpen(false)
  })
})

describe('deleteNote', () => {
  it('closes the open note, trashes it and offers undo', async () => {
    useApp.setState({ selectedNoteId: 5, toast: null })
    await deleteNote(5, 'Lab report')
    expect(inkling.notes.remove).toHaveBeenCalledWith(5)
    const s = useApp.getState()
    expect(s.selectedNoteId).toBeNull()
    expect(s.toast?.message).toBe('Deleted “Lab report”')
    s.toast?.onAction?.()
    await vi.waitFor(() => expect(useApp.getState().selectedNoteId).toBe(5))
    expect(inkling.notes.restore).toHaveBeenCalledWith(5)
  })
})

describe('leaving a note', () => {
  it('asks to drop it if empty once its last edit has landed', async () => {
    useApp.setState({ selectedNoteId: 6 })
    useApp.getState().setView('today')
    await vi.waitFor(() => expect(inkling.notes.dropIfEmpty).toHaveBeenCalledWith(6))
  })
  it('leaves a note being deleted to the delete, and a note opened again alone', async () => {
    useApp.setState({ selectedNoteId: 7, toast: null })
    await deleteNote(7, null)
    useApp.setState({ selectedNoteId: 8 })
    useApp.getState().openNote(9)
    useApp.getState().openNote(8)
    await new Promise((r) => setTimeout(r, 20))
    expect(inkling.notes.dropIfEmpty).not.toHaveBeenCalledWith(7)
    expect(inkling.notes.dropIfEmpty).not.toHaveBeenCalledWith(8)
  })
  it('logs a cleanup that fails and leaves the note alone', async () => {
    const unhandled: unknown[] = []
    const catchUnhandled = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', catchUnhandled)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    inkling.notes.dropIfEmpty.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    try {
      useApp.setState({ selectedNoteId: 11 })
      useApp.getState().setView('today')
      await vi.waitFor(() => expect(inkling.notes.dropIfEmpty).toHaveBeenCalledWith(11))
      await new Promise((r) => setTimeout(r, 10))
      expect(unhandled).toEqual([])
      expect(logged).toHaveBeenCalledWith('Could not clear the empty note.', expect.any(Error))
      expect(useApp.getState().selectedNoteId).toBe(11)
    } finally {
      process.off('unhandledRejection', catchUnhandled)
      logged.mockRestore()
    }
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

  it('stops waiting after a few seconds for a save that never comes back', async () => {
    vi.useFakeTimers()
    try {
      void trackSave(10, new Promise<void>(() => {}))
      let settled = false
      void settleNote(10).then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(1000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(5000)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
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

describe('a note call that fails', () => {
  let logged: ReturnType<typeof vi.spyOn>
  let unhandled: unknown[]
  const catchUnhandled = (reason: unknown): void => void unhandled.push(reason)
  const toast = (): string | undefined => useApp.getState().toast?.message
  const notesVersion = (): number => useData.getState().versions['notes'] ?? 0

  beforeEach(() => {
    useApp.setState({ toast: null })
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    unhandled = []
    process.on('unhandledRejection', catchUnhandled)
  })

  afterEach(async () => {
    // Node reports a rejection nobody handled once the current task is done.
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', catchUnhandled)
    logged.mockRestore()
    expect(unhandled).toEqual([])
  })

  it('says a new note was not made and opens nothing', async () => {
    useApp.setState({ view: 'today' })
    inkling.notes.create.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    const before = notesVersion()
    await expect(useApp.getState().newNote()).resolves.toBeUndefined()
    expect(toast()).toBe('Could not create the note.')
    expect(logged).toHaveBeenCalledWith('Could not create the note.', expect.any(Error))
    expect(useApp.getState()).toMatchObject({ view: 'today', selectedNoteId: null })
    expect(notesVersion()).toBe(before)
    // The next try is not blocked by the failed one.
    await useApp.getState().newNote()
    expect(useApp.getState().selectedNoteId).toBe(77)
  })

  it('says so when the home notebook could not be read for a new note', async () => {
    useApp.setState({ view: 'today', homeNotebookId: null })
    inkling.notebooks.home.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(useApp.getState().newNote()).resolves.toBeUndefined()
    expect(toast()).toBe('Could not create the note.')
    expect(inkling.notes.create).not.toHaveBeenCalled()
    expect(useApp.getState().selectedNoteId).toBeNull()
  })

  it('says a note was not brought back and does not open it', async () => {
    inkling.notes.restore.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    const before = notesVersion()
    await expect(useApp.getState().restoreNote(42)).resolves.toBeUndefined()
    expect(toast()).toBe('Could not bring the note back.')
    expect(useApp.getState().selectedNoteId).toBeNull()
    expect(notesVersion()).toBe(before)
  })

  it('says a note was not deleted, offers no undo and opens it again', async () => {
    useApp.setState({ selectedNoteId: 12 })
    inkling.notes.remove.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    const before = notesVersion()
    await expect(deleteNote(12, 'Lab report')).resolves.toBeUndefined()
    expect(toast()).toBe('Could not delete the note.')
    expect(useApp.getState().toast?.actionLabel).toBeUndefined()
    expect(useApp.getState().selectedNoteId).toBe(12)
    expect(notesVersion()).toBe(before)
  })

  it('leaves the user where they went while a failing delete was on its way', async () => {
    useApp.setState({ selectedNoteId: 13 })
    let fail!: (err: Error) => void
    inkling.notes.remove.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const deleting = deleteNote(13, null)
    await vi.waitFor(() => expect(inkling.notes.remove).toHaveBeenCalledWith(13))
    useApp.getState().openNote(14)
    fail(new Error('SQLITE_BUSY'))
    await deleting
    expect(toast()).toBe('Could not delete the note.')
    expect(useApp.getState().selectedNoteId).toBe(14)
  })

  it('says the theme was not saved and keeps it on screen', async () => {
    inkling.settings.set.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    useApp.setState({ theme: 'light' })
    useApp.getState().setTheme('dark')
    expect(inkling.settings.set).toHaveBeenLastCalledWith('theme', 'dark')
    await vi.waitFor(() => expect(toast()).toBe('Could not save the theme.'))
    expect(useApp.getState().theme).toBe('dark')
  })
})

describe('back', () => {
  const at = (): string => {
    const s = useApp.getState()
    return s.view === 'notes' ? `note ${s.selectedNoteId}` : s.view === 'study' ? `study ${s.selectedDeckId ?? s.reviewingDeckId}` : s.view
  }

  it('returns to the pages shown before, one at a time', () => {
    useApp.setState({ view: 'today' })
    useApp.getState().openNote(4)
    useApp.getState().openDeck(2)
    useApp.getState().openNote(5)
    useApp.getState().back()
    expect(at()).toBe('study 2')
    useApp.getState().back()
    expect(at()).toBe('note 4')
    useApp.getState().back()
    expect(at()).toBe('today')
  })

  it('leaves a review for the page before it, and never goes back into one', () => {
    useApp.setState({ view: 'today' })
    useApp.getState().openNote(4)
    useApp.getState().setView('today')
    useApp.getState().reviewDeck(9)
    useApp.getState().back()
    expect(at()).toBe('today')
    expect(useApp.getState().reviewingDeckId).toBeNull()
    useApp.getState().reviewDeck(9)
    useApp.getState().setView('study')
    useApp.getState().back()
    expect(at()).toBe('today')
  })

  it('skips a deleted note', () => {
    useApp.setState({ view: 'today' })
    useApp.getState().openNote(6)
    useApp.getState().openNote(7)
    useApp.getState().setView('today')
    forgetPlace(7)
    useApp.getState().back()
    expect(at()).toBe('note 6')
  })

  it('skips a note dropped for being empty', async () => {
    useApp.setState({ view: 'today' })
    useApp.getState().openDeck(2)
    useApp.getState().openNote(13)
    inkling.notes.dropIfEmpty.mockResolvedValueOnce(true)
    useApp.getState().setView('today')
    await vi.waitFor(() => expect(useApp.getState().selectedNoteId).toBeNull())
    useApp.getState().back()
    expect(at()).toBe('study 2')
  })
})
