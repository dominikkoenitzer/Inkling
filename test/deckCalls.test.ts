import { describe, it, expect, vi, beforeEach } from 'vitest'

const inkling = vi.hoisted(() => {
  const api = {
    notebooks: { home: vi.fn() },
    decks: {
      list: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      cards: vi.fn(),
      dueCards: vi.fn(),
      addCard: vi.fn(),
      updateCard: vi.fn(),
      removeCard: vi.fn()
    }
  }
  ;(globalThis as unknown as { window: unknown }).window = { inkling: api }
  return api
})

import { useApp } from '../src/renderer/src/stores/app'
import { addCard, createDeck, loadCards, loadDecks, loadDueCards, removeCard, removeDeck, renameDeck, updateCard } from '../src/renderer/src/lib/calls'

beforeEach(() => {
  useApp.setState({ toast: null, homeNotebookId: null })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

const toast = (): string | undefined => useApp.getState().toast?.message
const busy = (): Promise<never> => Promise.reject(new Error('SQLITE_BUSY'))

describe('flashcard calls', () => {
  it.each([
    ['the decks', () => loadDecks(), () => inkling.decks.list, 'Could not load the decks.'],
    ['the cards', () => loadCards(4), () => inkling.decks.cards, 'Could not load the cards.'],
    ['the due cards', () => loadDueCards(4), () => inkling.decks.dueCards, 'Could not load the cards.'],
    ['a new card', () => addCard(4, 'Q', 'A'), () => inkling.decks.addCard, 'Could not add the card.'],
    ['a new name', () => renameDeck(4, 'Biology'), () => inkling.decks.rename, 'Could not rename the deck.'],
    ['a deleted deck', () => removeDeck(4), () => inkling.decks.remove, 'Could not delete the deck.'],
    ['an edited card', () => updateCard(8, 'Q', 'A'), () => inkling.decks.updateCard, 'Could not save the card.'],
    ['a deleted card', () => removeCard(8), () => inkling.decks.removeCard, 'Could not delete the card.']
  ])('says so when %s fail', async (_what, call, fn, message) => {
    fn().mockImplementationOnce(busy)
    await expect(call()).resolves.toBeUndefined()
    expect(toast()).toBe(message)
  })

  it('hands back what a call answered', async () => {
    inkling.decks.cards.mockResolvedValueOnce([{ id: 1 }])
    await expect(loadCards(4)).resolves.toEqual([{ id: 1 }])
    inkling.decks.remove.mockResolvedValueOnce(undefined)
    await expect(removeDeck(4)).resolves.toBe(true)
    expect(toast()).toBeUndefined()
  })
})

describe('createDeck', () => {
  it('makes the deck in the home notebook', async () => {
    inkling.notebooks.home.mockResolvedValueOnce(3)
    inkling.decks.create.mockResolvedValueOnce({ id: 9 })
    await expect(createDeck('Biology')).resolves.toEqual({ id: 9 })
    expect(inkling.decks.create).toHaveBeenCalledWith(3, 'Biology')
  })

  it('says so when the home notebook cannot be found', async () => {
    inkling.notebooks.home.mockImplementationOnce(busy)
    await expect(createDeck('Biology')).resolves.toBeUndefined()
    expect(toast()).toBe('Could not make the deck.')
  })

  it('says so when the deck cannot be made', async () => {
    useApp.setState({ homeNotebookId: 3 })
    inkling.decks.create.mockImplementationOnce(busy)
    await expect(createDeck('Biology')).resolves.toBeUndefined()
    expect(toast()).toBe('Could not make the deck.')
  })
})
