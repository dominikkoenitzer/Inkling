import { describe, it, expect, vi, beforeEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    decks: { review: vi.fn() },
    tasks: { setDone: vi.fn() },
    search: { query: vi.fn() }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp } from '../src/renderer/src/stores/app'
import { reviewCard, searchFor, setTaskDone } from '../src/renderer/src/lib/calls'

beforeEach(() => {
  useApp.setState({ toast: null })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

const toast = (): string | undefined => useApp.getState().toast?.message

describe('reviewCard', () => {
  it('says the review was not saved and leaves the card to grade again', async () => {
    inkling.decks.review.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(reviewCard(5, 'good')).resolves.toBeUndefined()
    expect(toast()).toBe('Could not save the review.')
  })

  it('hands back the graded card', async () => {
    inkling.decks.review.mockResolvedValueOnce({ id: 5 })
    await expect(reviewCard(5, 'good')).resolves.toEqual({ id: 5 })
    expect(toast()).toBeUndefined()
  })
})

describe('setTaskDone', () => {
  it('says the tick was not saved', async () => {
    inkling.tasks.setDone.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await expect(setTaskDone(3, true)).resolves.toBeUndefined()
    expect(toast()).toBe('Could not save the to-do.')
  })

  it('tells a saved tick apart from a failed one', async () => {
    inkling.tasks.setDone.mockResolvedValueOnce(null)
    await expect(setTaskDone(3, true)).resolves.toBeNull()
    expect(toast()).toBeUndefined()
  })
})

describe('searchFor', () => {
  it('answers a failed search for its own query, so Enter does not wait on it', async () => {
    inkling.search.query.mockRejectedValueOnce(new Error('fts5: syntax error'))
    await expect(searchFor('pla')).resolves.toEqual({ query: 'pla', hits: [], failed: true })
    expect(toast()).toBe('Could not search.')
  })

  it('answers with the hits', async () => {
    const hits = [{ source_type: 'note', source_id: 1, note_id: 1, title: 'Plan', snippet: '' }]
    inkling.search.query.mockResolvedValueOnce(hits)
    await expect(searchFor('pla')).resolves.toEqual({ query: 'pla', hits, failed: false })
    expect(toast()).toBeUndefined()
  })
})
