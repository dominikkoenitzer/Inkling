import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    notes: { get: vi.fn(), syncCards: vi.fn() },
    app: { saveFile: vi.fn() }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp, settleNote } from '../src/renderer/src/stores/app'
import { loadNote, peekNote, saveFile, saveNote, syncNoteCards } from '../src/renderer/src/lib/calls'

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

describe('saveNote', () => {
  it('says the note was not saved', async () => {
    await expect(saveNote(4, Promise.reject(new Error('SQLITE_BUSY')))).resolves.toBe(false)
    expect(toast()).toBe('Could not save the note.')
    expect(logged).toHaveBeenCalledWith('Could not save the note.', expect.any(Error))
  })

  it('answers true for a save that landed', async () => {
    await expect(saveNote(4, Promise.resolve())).resolves.toBe(true)
    expect(toast()).toBeUndefined()
  })

  it('keeps a delete waiting until a failing save has come back', async () => {
    let fail!: (err: Error) => void
    const saving = saveNote(4, new Promise<void>((_, reject) => (fail = reject)))
    let settled = false
    const settling = settleNote(4).then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(settled).toBe(false)
    fail(new Error('SQLITE_BUSY'))
    await settling
    await expect(saving).resolves.toBe(false)
  })
})

describe('saveFile', () => {
  it('says the file was not saved', async () => {
    inkling.app.saveFile.mockRejectedValueOnce(new Error('No handler registered'))
    await expect(saveFile('Lab.md', '# Lab')).resolves.toBeUndefined()
    expect(toast()).toBe('Could not save the file.')
  })

  it('hands back where the file went', async () => {
    const saved = { saved: true, path: 'C:/notes/Lab.md' }
    inkling.app.saveFile.mockResolvedValueOnce(saved)
    await expect(saveFile('Lab.md', '# Lab')).resolves.toEqual(saved)
    expect(inkling.app.saveFile).toHaveBeenLastCalledWith('Lab.md', '# Lab')
    expect(toast()).toBeUndefined()
  })
})
