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
