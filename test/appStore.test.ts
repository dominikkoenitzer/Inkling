import { describe, it, expect, vi, beforeEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    notes: { restore: vi.fn(async () => undefined) },
    streak: { get: vi.fn(async () => ({ count: 0, last_day: null as string | null })) }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp, useData } from '../src/renderer/src/stores/app'

beforeEach(() => {
  useApp.setState({ activeNotebookId: 2, tab: 'notes', selectedNoteId: null })
  inkling.notes.restore.mockClear()
})

describe('reviewDeck', () => {
  it("starts the due deck's review session, not its editor", () => {
    useApp.setState({ tab: 'today', reviewingDeckId: null })
    useApp.getState().reviewDeck(1, 9)
    const s = useApp.getState()
    expect(s.tab).toBe('study')
    expect(s.activeNotebookId).toBe(1)
    expect(s.reviewingDeckId).toBe(9)
  })
  it('leaves the session on any navigation', () => {
    useApp.getState().reviewDeck(1, 9)
    useApp.getState().setTab('notes')
    expect(useApp.getState().reviewingDeckId).toBeNull()
    useApp.getState().reviewDeck(1, 9)
    useApp.getState().setActiveNotebook(2)
    expect(useApp.getState().reviewingDeckId).toBeNull()
    useApp.getState().reviewDeck(1, 9)
    useApp.getState().openNote(1, 4)
    expect(useApp.getState().reviewingDeckId).toBeNull()
  })
})

describe('restoreNote', () => {
  it('reopens an undone page in its own notebook after the user switched notebooks', async () => {
    await useApp.getState().restoreNote(1, 42)
    expect(inkling.notes.restore).toHaveBeenCalledWith(42)
    const s = useApp.getState()
    expect(s.activeNotebookId).toBe(1)
    expect(s.selectedNoteId).toBe(42)
    expect(s.tab).toBe('notes')
    expect(useData.getState().versions['notes']).toBeGreaterThan(0)
  })
})
