/**
 * What the MCP server can do, as plain functions over the repos. Each returns the structured
 * result the tool sends back and throws an Error with a readable message on bad input.
 */
import { getDb } from '../db'
import * as repos from '../repos'
import { tiptapDocToMarkdown } from '@shared/markdown'
import { markdownToDoc } from '@shared/markdownToDoc'
import { extractNoteTaskItems, stampTaskIds } from '@shared/noteTasks'
import { hasCloze } from '@shared/cloze'
import type { Note } from '@shared/types'

type Doc = { type: 'doc'; content: Array<Record<string, unknown>> }

export interface NoteSummary {
  id: number
  title: string
  updatedAt: string
}

export interface NoteWrite extends NoteSummary {
  todosCreated: number
}

export interface TodoResult {
  id: number
  text: string
  done: boolean
  noteId: number | null
}

const titleOf = (n: Note): string => n.title?.trim() || 'Untitled'

/** The stored doc, or null when the content is not one. */
function parseDoc(content: string): Doc | null {
  try {
    const doc = JSON.parse(content) as Doc
    if (doc && Array.isArray(doc.content)) return doc
  } catch {
    // not JSON
  }
  return null
}

/** A live note, or an error the assistant can act on. */
function liveNote(id: number): Note {
  const note = repos.getNote(id)
  if (!note || note.deleted_at) throw new Error(`There is no note with id ${id}. Use search or list_notes to find one.`)
  return note
}

/**
 * Creates the task rows for the doc's checkboxes and stamps their ids into it, the way the
 * editor does on save, then stores the doc. Returns the saved note and how many rows are new.
 */
function saveWithTasks(note: Note, doc: Doc): { note: Note; todosCreated: number } {
  const known = new Set(
    (getDb().prepare(`SELECT id FROM tasks WHERE note_id = ?`).all(note.id) as Array<{ id: number }>).map((t) => t.id)
  )
  const items = extractNoteTaskItems(doc)
  const ids = items.length > 0 || known.size > 0 ? repos.syncNoteTasks(note.id, note.notebook_id, items) : []
  const saved = repos.updateNote(note.id, { content: JSON.stringify(stampTaskIds(doc, ids)) })
  if (!saved) throw new Error(`The note with id ${note.id} was deleted.`)
  return { note: saved, todosCreated: ids.filter((id) => !known.has(id)).length }
}

const summary = (n: Note): NoteSummary => ({ id: n.id, title: titleOf(n), updatedAt: n.updated_at })

export function search(input: { query: string; limit?: number }): {
  results: Array<{ type: 'note' | 'todo' | 'deck'; id: number; title: string; snippet: string; noteId: number | null }>
} {
  const hits = repos.searchQuery(input.query, input.limit ?? 20)
  return {
    results: hits.map((h) => ({
      type: h.source_type === 'task' ? 'todo' : h.source_type,
      id: h.source_id,
      title: h.title,
      // The app marks matches with brackets for its own highlight.
      snippet: h.snippet.replace(/[⟪⟫]/g, ''),
      noteId: h.note_id
    }))
  }
}

export function listNotes(input: { limit?: number }): { notes: NoteSummary[] } {
  return { notes: repos.listNotes().slice(0, input.limit ?? 50).map(summary) }
}

export function readNote(input: { id: number }): NoteSummary & { markdown: string } {
  const note = liveNote(input.id)
  return { ...summary(note), markdown: tiptapDocToMarkdown(parseDoc(note.content) ?? { type: 'doc', content: [] }) }
}

export function createNote(input: { title: string; markdown?: string }): NoteWrite {
  const title = input.title.trim()
  if (!title) throw new Error('A note needs a title.')
  const doc = markdownToDoc(input.markdown ?? '') as Doc
  const { note, todosCreated } = getDb().transaction(() => {
    const note = repos.createNote({ notebook_id: repos.homeNotebookId(), title, content: JSON.stringify(doc) })
    return saveWithTasks(note, doc)
  })()
  return { ...summary(note), todosCreated }
}

const isBlankParagraph = (n: Record<string, unknown>): boolean =>
  n.type === 'paragraph' && !(Array.isArray(n.content) && n.content.length > 0)

export function appendToNote(input: { id: number; markdown: string }): NoteWrite {
  if (!input.markdown.trim()) throw new Error('There is nothing to append.')
  const { note, todosCreated } = getDb().transaction(() => {
    const note = liveNote(input.id)
    const doc = parseDoc(note.content)
    if (!doc) throw new Error(`The note with id ${input.id} cannot be read, so nothing was added.`)
    // Empty lines at the end of the note go, so the new text follows the last real line.
    const blocks = [...doc.content]
    while (blocks.length > 0 && isBlankParagraph(blocks[blocks.length - 1])) blocks.pop()
    const added = markdownToDoc(input.markdown) as Doc
    return saveWithTasks(note, { ...doc, type: 'doc', content: [...blocks, ...added.content] })
  })()
  return { ...summary(note), todosCreated }
}

export function listOpenTodos(input: { limit?: number }): {
  todos: Array<{ id: number; text: string; noteId: number | null; noteTitle: string }>
} {
  return {
    todos: repos
      .openTasks()
      .slice(0, input.limit ?? 50)
      .map((t) => ({ id: t.id, text: t.title, noteId: t.note_id, noteTitle: t.note_title?.trim() || 'Untitled' }))
  }
}

export function setTodoDone(input: { id: number }, done: boolean): TodoResult {
  const task = repos.getTask(input.id)
  const note = task?.note_id != null ? repos.getNote(task.note_id) : null
  if (!task || !note || note.deleted_at) {
    throw new Error(`There is no to-do with id ${input.id}. Use list_open_todos or search to find one.`)
  }
  const saved = repos.setTaskDone(task.id, done)!
  return { id: saved.id, text: saved.title, done: saved.status === 'done', noteId: saved.note_id }
}

export function listDecks(): {
  decks: Array<{ id: number; name: string; cards: number; due: number; noteId: number | null }>
} {
  return {
    decks: repos.listDecks().map((d) => ({ id: d.id, name: d.name, cards: d.card_count, due: d.due_count, noteId: d.note_id }))
  }
}

export function addFlashcards(input: {
  deckId?: number
  deckName?: string
  cards: Array<{ front: string; back?: string }>
}): { deckId: number; deckName: string; added: number } {
  const name = input.deckName?.trim()
  if ((input.deckId === undefined) === !name) throw new Error('Give one of deckId or deckName.')
  if (input.cards.length === 0) throw new Error('Give at least one card.')
  const cards = input.cards.map((c, i) => {
    const front = c.front.trim()
    const back = (c.back ?? '').trim()
    if (!front) throw new Error(`Card ${i + 1} has no front.`)
    if (!back && !hasCloze(front)) throw new Error(`Card ${i + 1} needs a back, or a cloze like {{c1::answer}} in the front.`)
    return { front, back }
  })

  return getDb().transaction(() => {
    const decks = repos.listDecks()
    let deck = input.deckId !== undefined ? decks.find((d) => d.id === input.deckId) : undefined
    if (input.deckId !== undefined && !deck) throw new Error(`There is no deck with id ${input.deckId}. Use list_decks to find one.`)
    if (!deck) {
      deck = decks.find((d) => d.name.trim().toLowerCase() === name!.toLowerCase()) ?? repos.createDeck(repos.homeNotebookId(), name!)
    }
    const count = (): number =>
      (getDb().prepare(`SELECT COUNT(*) AS n FROM flashcards WHERE deck_id = ?`).get(deck!.id) as { n: number }).n
    const before = count()
    for (const c of cards) repos.addCard(deck.id, c.front, c.back)
    return { deckId: deck.id, deckName: deck.name, added: count() - before }
  })()
}
