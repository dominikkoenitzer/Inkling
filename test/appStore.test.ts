import { describe, it, expect, vi, beforeEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    notebooks: { home: vi.fn(async () => 3) },
    notes: {
      restore: vi.fn(async () => undefined),
      create: vi.fn(async () => ({ id: 77 }))
    }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp, useData } from '../src/renderer/src/stores/app'

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
