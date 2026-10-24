/**
 * What the MCP server can do, as plain functions over the repos. Each returns the structured
 * result the tool sends back and throws an Error with a readable message on bad input.
 * Writes go through the same repo calls as the app, so to-dos, cards and search stay in step.
 */
import { getDb } from '../db'
import * as repos from '../repos'
import { localDay, storedTime } from '@shared/day'
import { tiptapDocToMarkdown } from '@shared/markdown'
import { markdownToDoc } from '@shared/markdownToDoc'
import { extractNoteTaskItems, stampTaskIds } from '@shared/noteTasks'
import { extractNoteCardLines, stampCardLines } from '@shared/noteCards'
import { hasCloze, renderCloze } from '@shared/cloze'
import type { Card, Note, ReviewGrade } from '@shared/types'
import { appendBlocks, replaceSection, replaceText, sectionMarkdown, type Doc } from './doc'

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

/** A live note's doc, or an error when it cannot be read. */
function docOf(note: Note): Doc {
  const doc = parseDoc(note.content)
  if (!doc) throw new Error(`The note with id ${note.id} cannot be read, so it was left as it is.`)
  return doc
}

/* ---------------------------------- Undo ---------------------------------- */

/** What a note held before each edit made here, newest last, for undo_edit. Lives as long as the server. */
const edits = new Map<number, Array<{ before: string; after: string }>>()
const MAX_UNDO = 20

/** Forgets every remembered edit. For tests. */
export function forgetEdits(): void {
  edits.clear()
}

/**
 * Creates the task rows for the doc's checkboxes and stamps their ids into it, the way the
 * editor does on save, then stores the doc. Returns the saved note and how many rows are new.
 */
function saveWithTasks(note: Note, doc: Doc, remember = true): { note: Note; todosCreated: number } {
  const known = new Set(
    (getDb().prepare(`SELECT id FROM tasks WHERE note_id = ?`).all(note.id) as Array<{ id: number }>).map((t) => t.id)
  )
  const items = extractNoteTaskItems(doc)
  const ids = items.length > 0 || known.size > 0 ? repos.syncNoteTasks(note.id, note.notebook_id, items) : []
  const saved = repos.updateNote(note.id, { content: JSON.stringify(stampTaskIds(doc, ids)) })
  if (!saved) throw new Error(`The note with id ${note.id} was deleted.`)
  if (remember) {
    const stack = edits.get(note.id) ?? []
    stack.push({ before: note.content, after: saved.content })
    edits.set(note.id, stack.slice(-MAX_UNDO))
  }
  return { note: saved, todosCreated: ids.filter((id) => id > 0 && !known.has(id)).length }
}

const summary = (n: Note): NoteSummary => ({ id: n.id, title: titleOf(n), updatedAt: n.updated_at })

/** Reads a date or date-time the assistant gave, as the UTC ISO string rows are stamped with. */
function isoFrom(value: string, field: string): string {
  const t = Date.parse(value)
  if (Number.isNaN(t)) throw new Error(`${field} is not a date. Use ISO 8601, like 2026-10-16 or 2026-10-16T08:00:00Z.`)
  return new Date(t).toISOString()
}

/* ---------------------------------- Notes --------------------------------- */

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

export function listNotes(input: { limit?: number; offset?: number; changedSince?: string; inTrash?: boolean }): {
  notes: Array<NoteSummary & { deletedAt?: string }>
  more: boolean
} {
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const since = input.changedSince !== undefined ? Date.parse(isoFrom(input.changedSince, 'changedSince')) : null
  const rows = input.inTrash
    ? (getDb().prepare(`SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all() as Note[])
    : repos.listNotes()
  // Compared as times: rows hold either the ISO form or SQLite's own.
  const picked = since !== null ? rows.filter((n) => storedTime(n.updated_at) >= since) : rows
  const page = picked.slice(offset, offset + limit)
  return {
    notes: page.map((n) => (input.inTrash ? { ...summary(n), deletedAt: n.deleted_at! } : summary(n))),
    more: picked.length > offset + limit
  }
}

export function readNote(input: { id: number; heading?: string }): NoteSummary & { markdown: string } {
  const note = liveNote(input.id)
  const doc = parseDoc(note.content) ?? { type: 'doc', content: [] }
  const markdown = input.heading !== undefined ? sectionMarkdown(doc.content, input.heading) : tiptapDocToMarkdown(doc)
  return { ...summary(note), markdown }
}

export function createNote(input: { title: string; markdown?: string }): NoteWrite {
  const title = input.title.trim()
  if (!title) throw new Error('A note needs a title.')
  const doc = markdownToDoc(input.markdown ?? '') as Doc
  const { note, todosCreated } = getDb().transaction(() => {
    const note = repos.createNote({ notebook_id: repos.homeNotebookId(), title, content: JSON.stringify(doc) })
    return saveWithTasks(note, doc, false)
  })()
  return { ...summary(note), todosCreated }
}

export function appendToNote(input: { id: number; markdown: string; heading?: string }): NoteWrite {
  if (!input.markdown.trim()) throw new Error('There is nothing to append.')
  const { note, todosCreated } = getDb().transaction(() => {
    const note = liveNote(input.id)
    const doc = docOf(note)
    return saveWithTasks(note, { type: 'doc', content: appendBlocks(doc.content, input.markdown, input.heading) })
  })()
  return { ...summary(note), todosCreated }
}

export function replaceNoteSection(input: { id: number; heading: string; markdown: string }): NoteWrite & { previous: string } {
  return getDb().transaction(() => {
    const note = liveNote(input.id)
    const { blocks, previous } = replaceSection(docOf(note).content, input.heading, input.markdown)
    const saved = saveWithTasks(note, { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] })
    return { ...summary(saved.note), todosCreated: saved.todosCreated, previous }
  })()
}

export function editNote(input: { id: number; oldText: string; newText: string; replaceAll?: boolean }): NoteWrite & { replaced: number } {
  return getDb().transaction(() => {
    const note = liveNote(input.id)
    const { blocks, count } = replaceText(docOf(note).content, input.oldText, input.newText, input.replaceAll)
    const saved = saveWithTasks(note, { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] })
    return { ...summary(saved.note), todosCreated: saved.todosCreated, replaced: count }
  })()
}

export function undoEdit(input: { id: number }): NoteSummary & { left: number } {
  return getDb().transaction(() => {
    const note = liveNote(input.id)
    const stack = edits.get(note.id) ?? []
    const last = stack[stack.length - 1]
    if (!last) throw new Error('No edit to this note was made in this session, so there is nothing to undo.')
    if (last.after !== note.content) {
      throw new Error('The note has changed since that edit, so it was left as it is. Read it and fix it with edit_note.')
    }
    const doc = parseDoc(last.before)
    if (!doc) throw new Error('The earlier version cannot be read, so the note was left as it is.')
    const { note: saved } = saveWithTasks(note, doc, false)
    stack.pop()
    return { ...summary(saved), left: stack.length }
  })()
}

export function renameNote(input: { id: number; title: string }): NoteSummary & { previousTitle: string } {
  const title = input.title.trim()
  if (!title) throw new Error('A note needs a title.')
  return getDb().transaction(() => {
    const note = liveNote(input.id)
    const saved = repos.updateNote(note.id, { title })
    if (!saved) throw new Error(`The note with id ${note.id} was deleted.`)
    return { ...summary(saved), previousTitle: titleOf(note) }
  })()
}

export function deleteNote(input: { id: number }): NoteSummary & { inTrash: true; keptForDays: number } {
  return getDb().transaction(() => {
    const note = liveNote(input.id)
    repos.removeNote(note.id)
    return { ...summary(note), inTrash: true as const, keptForDays: repos.TRASH_RETENTION_DAYS }
  })()
}

export function restoreNote(input: { id: number }): NoteSummary {
  return getDb().transaction(() => {
    const note = repos.getNote(input.id)
    if (!note) throw new Error(`There is no note with id ${input.id}, not even in the trash. Use list_notes with inTrash to find one.`)
    if (!note.deleted_at) throw new Error(`The note with id ${input.id} is not in the trash.`)
    return summary(repos.restoreNote(note.id)!)
  })()
}

/* ---------------------------------- To-dos -------------------------------- */

interface OpenTodo {
  id: number
  text: string
  noteId: number | null
  noteTitle: string
  due: string | null
  overdue: boolean
}

function openTodos(limit: number): OpenTodo[] {
  const today = localDay()
  return repos
    .openTasks()
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      text: t.title,
      noteId: t.note_id,
      noteTitle: t.note_title?.trim() || 'Untitled',
      due: t.due_date ? localDay(new Date(t.due_date)) : null,
      overdue: !!t.due_date && localDay(new Date(t.due_date)) < today
    }))
}

export function listOpenTodos(input: { limit?: number }): { todos: OpenTodo[] } {
  return { todos: openTodos(input.limit ?? 50) }
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

/* -------------------------------- Flashcards ------------------------------ */

interface DeckRow {
  id: number
  name: string
  cards: number
  due: number
  noteId: number | null
}

const deckRows = (): DeckRow[] =>
  repos.listDecks().map((d) => ({ id: d.id, name: d.name, cards: d.card_count, due: d.due_count, noteId: d.note_id }))

export function listDecks(): { decks: DeckRow[] } {
  return { decks: deckRows() }
}

export function today(): {
  date: string
  todos: OpenTodo[]
  openTodos: number
  flashcardsDue: number
  decks: Array<{ id: number; name: string; due: number }>
} {
  const all = repos.openTasks().length
  const decks = deckRows().filter((d) => d.due > 0)
  return {
    date: localDay(),
    todos: openTodos(50),
    openTodos: all,
    flashcardsDue: decks.reduce((n, d) => n + d.due, 0),
    decks: decks.map(({ id, name, due }) => ({ id, name, due }))
  }
}

const joinParts = (text: string, n: number, reveal: boolean): string =>
  renderCloze(text, n, reveal)
    .map((p) => p.text)
    .join('')

/** A card as the review screen asks it: the question, then the answer. */
function asked(c: Card): { question: string; answer: string } {
  if (c.cloze > 0) {
    const full = joinParts(c.front, c.cloze, true)
    return { question: joinParts(c.front, c.cloze, false), answer: c.back ? `${full}\n${c.back}` : full }
  }
  return { question: c.front, answer: c.back }
}

export function listDueFlashcards(input: { deckId?: number; limit?: number }): {
  cards: Array<{ id: number; deckId: number; deckName: string; question: string; answer: string; isNew: boolean }>
  due: number
} {
  const decks = repos.listDecks()
  const picked = input.deckId !== undefined ? decks.filter((d) => d.id === input.deckId) : decks
  if (input.deckId !== undefined && picked.length === 0) throw new Error(`There is no deck with id ${input.deckId}. Use list_decks to find one.`)
  const names = new Map(picked.map((d) => [d.id, d.name]))
  const due = picked
    .flatMap((d) => repos.dueCards(d.id))
    .sort((a, b) => storedTime(a.next_review_date) - storedTime(b.next_review_date) || a.id - b.id)
  return {
    cards: due.slice(0, input.limit ?? 20).map((c) => ({
      id: c.id,
      deckId: c.deck_id,
      deckName: names.get(c.deck_id) ?? '',
      ...asked(c),
      isNew: c.state === 'new'
    })),
    due: due.length
  }
}

export function gradeFlashcard(input: { id: number; grade: ReviewGrade }): { id: number; grade: ReviewGrade; nextReview: string; intervalDays: number } {
  const card = getDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(input.id) as Card | undefined
  if (!card || !repos.listDecks().some((d) => d.id === card.deck_id)) {
    throw new Error(`There is no flashcard with id ${input.id}. Use list_due_flashcards to find one.`)
  }
  const saved = repos.reviewCard(card.id, input.grade)
  return { id: saved.id, grade: input.grade, nextReview: saved.next_review_date, intervalDays: saved.interval_days }
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

/**
 * What the Make flashcards button in a note does: the note's `Term :: Definition` and cloze
 * lines become the cards of its own deck. Refused, with nothing changed, if it would remove
 * a card whose line has gone; that stays the user's call in the app.
 */
export function makeFlashcardsFromNote(input: { id: number }): { deckId: number; deckName: string; cards: number; added: number; due: number } {
  return getDb().transaction(() => {
    const note = liveNote(input.id)
    const doc = docOf(note)
    const lines = extractNoteCardLines(doc)
    if (lines.length === 0) {
      throw new Error('This note has no card lines. Add lines like "Term :: Definition" or "The {{c1::answer}} in a sentence" first.')
    }
    const cardIds = (): number[] =>
      (
        getDb()
          .prepare(`SELECT c.id FROM flashcards c JOIN flashcard_decks d ON d.id = c.deck_id WHERE d.note_id = ?`)
          .all(note.id) as Array<{ id: number }>
      ).map((r) => r.id)
    const before = cardIds()
    const { deck, lineIds } = repos.syncNoteCards(
      note.id,
      note.notebook_id,
      titleOf(note),
      lines.map(({ lineId, front, back }) => ({ lineId, front, back }))
    )
    const after = new Set(cardIds())
    const removed = before.filter((id) => !after.has(id)).length
    if (removed > 0) {
      // Thrown inside the transaction, so the sync is rolled back too.
      throw new Error(
        `This would remove ${removed} card${removed === 1 ? '' : 's'} whose line is no longer in the note, so nothing was changed. The user can press Make flashcards in the note to do it.`
      )
    }
    const perParagraph: number[] = []
    lines.forEach((l, i) => (perParagraph[l.paragraph] = lineIds[i]))
    repos.updateNote(note.id, { content: JSON.stringify(stampCardLines(doc, perParagraph)) })
    const fresh = repos.listDecks().find((d) => d.id === deck.id)!
    return { deckId: deck.id, deckName: deck.name, cards: fresh.card_count, added: after.size - before.length, due: fresh.due_count }
  })()
}
