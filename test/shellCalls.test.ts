import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    notes: { list: vi.fn() },
    decks: { list: vi.fn() },
    app: { setTitlebar: vi.fn() }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp } from '../src/renderer/src/stores/app'
import { loadNotes, peekDecks, setTitlebar } from '../src/renderer/src/lib/calls'

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

describe('loadNotes', () => {
  it('says the notes could not be loaded', async () => {
    inkling.notes.list.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(loadNotes()).resolves.toBeUndefined()
    expect(toast()).toBe('Could not load the notes.')
  })

  it('hands back the notes', async () => {
    const notes = [{ id: 4, title: 'Lab' }]
    inkling.notes.list.mockResolvedValueOnce(notes)
    await expect(loadNotes()).resolves.toEqual(notes)
    expect(toast()).toBeUndefined()
  })
})

describe('peekDecks', () => {
  it('logs decks that could not be read without telling the user', async () => {
    inkling.decks.list.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(peekDecks()).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledWith('Could not read the decks.', expect.any(Error))
    expect(toast()).toBeUndefined()
  })

  it('hands back the decks', async () => {
    const decks = [{ id: 2, due_count: 3 }]
    inkling.decks.list.mockResolvedValueOnce(decks)
    await expect(peekDecks()).resolves.toEqual(decks)
  })
})

describe('setTitlebar', () => {
  it('logs a title bar that did not change without telling the user', async () => {
    inkling.app.setTitlebar.mockRejectedValueOnce(new Error('No handler registered'))
    await expect(setTitlebar('dark')).resolves.toBeUndefined()
    expect(inkling.app.setTitlebar).toHaveBeenLastCalledWith('dark')
    expect(logged).toHaveBeenCalledWith('Could not set the title bar theme.', expect.any(Error))
    expect(toast()).toBeUndefined()
  })
})
