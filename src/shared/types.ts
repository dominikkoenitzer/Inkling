import type { GradingSystem } from './grades'
import type { CardState } from './fsrs'

export type ColorKey = 'teal' | 'coral' | 'amber' | 'pink' | 'gray'
export type TaskStatus = 'todo' | 'done'
export type ModuleTab = 'today' | 'notes' | 'tasks' | 'study' | 'grades' | 'stats'

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
  /** SM-2 fields, kept so pre-v0.4.0 data stays readable; FSRS uses the three below. */
  ease_factor: number
  interval_days: number
  repetitions: number
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

/** One row per answered card: the history SM-2 never kept, and what Stats is built on. */
export interface ReviewLogEntry {
  id: number
  card_id: number
  deck_id: number | null
  rating: number
  state: CardState
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  reviewed_at: string
}

export interface Grade {
  id: number
  notebook_id: number
  title: string
  score: number
  max: number
  weight: number
  /** The grading system the row was entered under, so a later system switch can't reinterpret it. */
  system: GradingSystem
  created_at: string
}

export interface FocusSession {
  id: number
  task_id: number | null
  deck_id: number | null
  duration_minutes: number | null
  started_at: string
  completed: 0 | 1
}

export interface SearchResult {
  source_type: 'note' | 'task' | 'deck'
  source_id: number
  title: string
  snippet: string
  notebook_id: number
}

export interface StreakInfo {
  count: number
  last_day: string | null // YYYY-MM-DD (local)
}

/* ---------------------------------- Stats --------------------------------- */

/** One local calendar day of activity. Days with nothing to show are omitted. */
export interface ActivityDay {
  day: string // YYYY-MM-DD, local
  reviews: number
  focus_minutes: number
}

export interface StatsOverview {
  /** Window the counts cover, in days. */
  window_days: number
  reviews: number
  reviews_all_time: number
  /** Share of reviews in the window graded better than Again, 0–1. Null when nothing was due. */
  retention: number | null
  focus_minutes: number
  /** Consecutive local days with a review or a completed focus session, ending today or yesterday. */
  current_streak: number
  longest_streak: number
  /** Days studied at all, in the window. */
  active_days: number
  /** Cards due right now, across every deck. */
  due_now: number
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

/** What "Optimise from my reviews" did: saved new parameters, or kept the ones in use and why. */
export interface OptimiseOutcome {
  status: 'fitted' | 'too-few' | 'no-better'
  /** Reviews the fit could score, and how many it needs before it runs. */
  reviews: number
  needed: number
  /** Mean log-loss of the recall predictions, with the parameters in use and with the result. */
  lossBefore: number
  lossAfter: number
  /** The new parameters, when they were saved. */
  params?: number[]
}

/** What an Anki import brought in, and what it left out and why. */
export interface ImportSummary {
  /** Decks created; cards landing in a deck of the same name that exists already add none. */
  decks: number
  cards: number
  reviews: number
  /** The first deck that got cards, to open after the import; null when nothing was new. */
  deckId: number | null
  skipped: {
    /** Images, sounds and videos removed from the imported notes. */
    media: number
    suspended: number
    imageOcclusion: number
    /** Cards an earlier import brought in already. */
    duplicates: number
    /** Cards whose question is only an image or a sound. */
    mediaOnly: number
    /** Cards with no usable text, or whose note or note type is missing. */
    unusable: number
  }
}
