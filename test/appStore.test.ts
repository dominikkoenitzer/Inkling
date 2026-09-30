import { describe, it, expect, vi, beforeEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    notes: { restore: vi.fn(async () => undefined) },
    tasks: { update: vi.fn(async () => undefined) },
    streak: { get: vi.fn(async () => ({ count: 0, last_day: null as string | null })) }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp, useData, updateTask } from '../src/renderer/src/stores/app'

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

describe('updateTask', () => {
  const version = (domain: string): number => useData.getState().versions[domain] ?? 0

  it('reloads notes after a task from a note checkbox is renamed or ticked, once the write is done', async () => {
    let finish = (): void => undefined
    inkling.tasks.update.mockImplementationOnce(() => new Promise<undefined>((r) => (finish = () => r(undefined))))
    const notes = version('notes')
    const tasks = version('tasks')
    const done = updateTask({ id: 5, note_id: 7 }, { title: 'Renamed' })
    await Promise.resolve()
    // the main process writes the note back inside the update; reloading before that reads the old note
    expect(version('notes')).toBe(notes)
    finish()
    await done
    expect(inkling.tasks.update).toHaveBeenCalledWith(5, { title: 'Renamed' })
    expect(version('notes')).toBe(notes + 1)
    expect(version('tasks')).toBe(tasks + 1)
    await updateTask({ id: 5, note_id: 7 }, { status: 'done' })
    expect(version('notes')).toBe(notes + 2)
  })

  it('leaves notes alone for a task that lives in no note', async () => {
    const notes = version('notes')
    await updateTask({ id: 6, note_id: null }, { title: 'Loose' })
    expect(version('notes')).toBe(notes)
  })
})
