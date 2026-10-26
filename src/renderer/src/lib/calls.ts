import { useApp, trackSave } from '@/stores/app'
import type { Card, Deck, Note, NoteCardLine, ReviewGrade, SearchResult, Task } from '@shared/types'

const api = window.inkling

type SavedFile = Awaited<ReturnType<typeof api.app.saveFile>>

/** The call's answer, or undefined once a failure is logged and told to the user in `message`. */
function orSay<T>(call: Promise<T>, message: string): Promise<T | undefined> {
  return call.catch((err: unknown) => {
    console.error(message, err)
    useApp.getState().showToast({ message })
    return undefined
  })
}

/** The call's answer, or undefined once a failure is logged, for a call the user did not ask for. */
function orLog<T>(call: Promise<T>, message: string): Promise<T | undefined> {
  return call.catch((err: unknown) => {
    console.error(message, err)
    return undefined
  })
}

/** Undefined when the note did not load. */
export function loadNote(noteId: number): Promise<Note | null | undefined> {
  return orSay(api.notes.get(noteId), 'Could not open the note.')
}

/** Undefined when the note did not load, for a check the user did not ask for. */
export function peekNote(noteId: number): Promise<Note | null | undefined> {
  return orLog(api.notes.get(noteId), 'Could not read the note.')
}

/** Undefined when the notes did not load. */
export function loadNotes(): Promise<Note[] | undefined> {
  return orSay(api.notes.list(), 'Could not load the notes.')
}

/** Undefined when the decks did not load, for a count the user did not ask for. */
export function peekDecks(): Promise<Deck[] | undefined> {
  return orLog(api.decks.list(), 'Could not read the decks.')
}

/** Settles either way: a title bar left in the old theme is only logged. */
export async function setTitlebar(theme: 'light' | 'dark'): Promise<void> {
  await orLog(api.app.setTitlebar(theme), 'Could not set the title bar theme.')
}

/** The note's deck and line ids, or undefined when the cards were not made. */
export function syncNoteCards(
  noteId: number,
  notebookId: number,
  name: string,
  lines: NoteCardLine[]
): Promise<{ deck: Deck; lineIds: number[] } | undefined> {
  return orSay(api.notes.syncCards(noteId, notebookId, name, lines), 'Could not make the flashcards.')
}

/** False when the note was not saved. A delete or a leave still waits for the save either way. */
export function saveNote(noteId: number, save: Promise<void>): Promise<boolean> {
  return orSay(trackSave(noteId, save).then(() => true), 'Could not save the note.').then((saved) => saved === true)
}

/** How the save dialog ended, or undefined when the call itself failed. */
export function saveFile(name: string, contents: string): Promise<SavedFile | undefined> {
  return orSay(api.app.saveFile(name, contents), 'Could not save the file.')
}

/** Undefined when the decks did not load. */
export function loadDecks(): Promise<Deck[] | undefined> {
  return orSay(api.decks.list(), 'Could not load the decks.')
}

/** Undefined when the deck was not made. */
export function createDeck(name: string): Promise<Deck | undefined> {
  const home = useApp.getState().homeNotebookId
  return orSay(
    (home !== null ? Promise.resolve(home) : api.notebooks.home()).then((id) => api.decks.create(id, name)),
    'Could not make the deck.'
  )
}

/** True once the deck has its new name. */
export function renameDeck(deckId: number, name: string): Promise<true | undefined> {
  return orSay(api.decks.rename(deckId, name).then(() => true as const), 'Could not rename the deck.')
}

/** True once the deck and its cards are gone. */
export function removeDeck(deckId: number): Promise<true | undefined> {
  return orSay(api.decks.remove(deckId).then(() => true as const), 'Could not delete the deck.')
}

/** Undefined when the cards did not load. */
export function loadCards(deckId: number): Promise<Card[] | undefined> {
  return orSay(api.decks.cards(deckId), 'Could not load the cards.')
}

/** Undefined when the due cards did not load. */
export function loadDueCards(deckId: number): Promise<Card[] | undefined> {
  return orSay(api.decks.dueCards(deckId), 'Could not load the cards.')
}

/** Undefined when the card was not added. */
export function addCard(deckId: number, front: string, back: string): Promise<Card | undefined> {
  return orSay(api.decks.addCard(deckId, front, back), 'Could not add the card.')
}

/** True once the edit is saved. */
export function updateCard(cardId: number, front: string, back: string): Promise<true | undefined> {
  return orSay(api.decks.updateCard(cardId, front, back).then(() => true as const), 'Could not save the card.')
}

/** True once the card is gone. */
export function removeCard(cardId: number): Promise<true | undefined> {
  return orSay(api.decks.removeCard(cardId).then(() => true as const), 'Could not delete the card.')
}

/** Undefined when the review was not saved, so the card stays to be graded again. */
export function reviewCard(cardId: number, grade: ReviewGrade): Promise<Card | undefined> {
  return orSay(api.decks.review(cardId, grade), 'Could not save the review.')
}

/** Undefined when the tick was not saved. */
export function setTaskDone(taskId: number, done: boolean): Promise<Task | null | undefined> {
  return orSay(api.tasks.setDone(taskId, done), 'Could not save the to-do.')
}

/** The hits for `query`. A failed search still answers that query, so nothing waits on it. */
export async function searchFor(query: string): Promise<{ query: string; hits: SearchResult[]; failed: boolean }> {
  const hits = await orSay(api.search.query(query), 'Could not search.')
  return { query, hits: hits ?? [], failed: !hits }
}
