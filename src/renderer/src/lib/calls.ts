import { useApp } from '@/stores/app'
import type { Card, Deck, Note, NoteCardLine, ReviewGrade, SearchResult, Task } from '@shared/types'

const api = window.inkling

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
