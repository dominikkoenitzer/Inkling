import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    notes: { get: vi.fn(), syncCards: vi.fn() }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp } from '../src/renderer/src/stores/app'
import { loadNote, peekNote, syncNoteCards } from '../src/renderer/src/lib/calls'

let logged: ReturnType<typeof vi.spyOn>
let unhandled: unknown[]
const catchUnhandled = (reason: unknown): void => void unhandled.push(reason)

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
  expect(unhandled).toEqual([])
})

const toast = (): string | undefined => useApp.getState().toast?.message
const note = { id: 4, title: 'Lab', content: '{}', deleted_at: null }

describe('loadNote', () => {
  it('says the note could not be opened', async () => {
    inkling.notes.get.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(loadNote(4)).resolves.toBeUndefined()
    expect(toast()).toBe('Could not open the note.')
  })

  it('hands back the note, or null for one that is gone', async () => {
    inkling.notes.get.mockResolvedValueOnce(note).mockResolvedValueOnce(null)
    await expect(loadNote(4)).resolves.toEqual(note)
    await expect(loadNote(5)).resolves.toBeNull()
    expect(toast()).toBeUndefined()
  })
})

describe('peekNote', () => {
  it('logs a failed look without telling the user', async () => {
    inkling.notes.get.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(peekNote(4)).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledWith('Could not read the note.', expect.any(Error))
    expect(toast()).toBeUndefined()
  })

  it('hands back the note', async () => {
    inkling.notes.get.mockResolvedValueOnce(note)
    await expect(peekNote(4)).resolves.toEqual(note)
  })
})

describe('syncNoteCards', () => {
  const lines = [{ lineId: null, front: 'Term', back: 'Definition' }]

  it('says the cards were not made', async () => {
    inkling.notes.syncCards.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(syncNoteCards(4, 1, 'Lab', lines)).resolves.toBeUndefined()
    expect(toast()).toBe('Could not make the flashcards.')
  })

  it('hands back the deck and the line ids', async () => {
    const synced = { deck: { id: 2 }, lineIds: [9] }
    inkling.notes.syncCards.mockResolvedValueOnce(synced)
    await expect(syncNoteCards(4, 1, 'Lab', lines)).resolves.toEqual(synced)
    expect(inkling.notes.syncCards).toHaveBeenLastCalledWith(4, 1, 'Lab', lines)
    expect(toast()).toBeUndefined()
  })
})
