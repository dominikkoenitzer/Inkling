import type { CardState } from './fsrs'

export type ColorKey = 'teal' | 'coral' | 'amber' | 'pink' | 'gray'
export type TaskStatus = 'todo' | 'done'

export interface Notebook {
  id: number
  name: string
  color: ColorKey
  sort_order: number
  created_at: string
}

export interface Note {
  id: number
  notebook_id: number
  title: string | null
  content: string // TipTap JSON string
  created_at: string
  updated_at: string
  /** Tombstone: set while the note is deleted and still undoable, null otherwise. */
  deleted_at: string | null
}

/** The title and content an editor save started from. */
export type NoteBase = Pick<Note, 'title' | 'content'>

export interface Task {
  id: number
  notebook_id: number
  note_id: number | null
  title: string
  status: TaskStatus
  due_date: string | null // ISO UTC
  created_at: string
  completed_at: string | null
}

/** An open checkbox from a live note, with that note's title for Today. */
export interface OpenTask extends Task {
  note_title: string | null
}

export interface Deck {
  id: number
  notebook_id: number
  name: string
  created_at: string
  /** The note this deck is synced from, or null for a deck made by hand. */
  note_id: number | null
  card_count: number
  due_count: number
}

export interface Card {
  id: number
  deck_id: number
  front: string
  back: string
  /** Days until the next review, as last scheduled. */
  interval_days: number
  next_review_date: string
  /** FSRS memory state (v0.4.0+). Null on a card that has never been reviewed. */
  stability: number | null
  difficulty: number | null
  state: CardState
  last_review: string | null
  /** The note line a synced card came from, shared by every card of that line. */
  source_line: number | null
  /** The cloze number this card asks, 0 for a plain front/back card. */
  cloze: number
}

export interface SearchResult {
  source_type: 'note' | 'task' | 'deck'
  source_id: number
  title: string
  snippet: string
  /** The note a note or task result opens; null for a deck. */
  note_id: number | null
}

export interface NoteTaskItem {
  taskId: number | null
  title: string
  checked: boolean
}

/** One `Term :: Definition` or cloze line of a note, as the flashcard sync reads it. */
export interface NoteCardLine {
  /** The id stamped on the line by an earlier sync, null for a line never synced. */
  lineId: number | null
  front: string
  back: string
}

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

export type AssistantId = 'desktop' | 'terminal'

/** An assistant app on this computer and whether Inkling is in its MCP server list. */
export interface AssistantStatus {
  id: AssistantId
  name: string
  /** missing: not installed. off: installed, no Inkling. on: connected. stale: starts another copy. unreadable: its file is broken. */
  state: 'missing' | 'off' | 'on' | 'stale' | 'unreadable'
  file: string
}
