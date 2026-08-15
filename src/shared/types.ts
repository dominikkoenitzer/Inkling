import type { GradingSystem } from './grades'
import type { CardState } from './fsrs'

export type ColorKey = 'teal' | 'coral' | 'amber' | 'pink' | 'gray'
export type NotebookKind = 'general' | 'school_subject'
export type NoteType = 'page' | 'sticky'
export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type Priority = 'low' | 'medium' | 'high'
export type ModuleTab = 'today' | 'notes' | 'tasks' | 'study' | 'grades' | 'stats'

export interface Notebook {
  id: number
  name: string
  color: ColorKey
  icon: string | null
  kind: NotebookKind
  sort_order: number
  is_journal: 0 | 1
  created_at: string
}

export interface Note {
  id: number
  notebook_id: number
  type: NoteType
  title: string | null
  content: string // TipTap JSON string
  color: string | null
  pos_x: number | null
  pos_y: number | null
  width: number | null
  height: number | null
  pinned: 0 | 1
  created_at: string
  updated_at: string
  /** Tombstone: set when the note is in the trash, null otherwise. */
  deleted_at: string | null
}

export interface Task {
  id: number
  notebook_id: number
  note_id: number | null
  title: string
  status: TaskStatus
  priority: Priority
  due_date: string | null // ISO UTC
  parent_task_id: number | null
  created_at: string
  completed_at: string | null
}

export interface Deck {
  id: number
  notebook_id: number
  name: string
  created_at: string
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
}

/** One row per answered card — the history SM-2 never kept, and what Stats is built on. */
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

/** Cards falling due on a given local day, for the "what's coming" forecast. */
export interface ForecastDay {
  day: string // YYYY-MM-DD, local
  due: number
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
  cards_total: number
  cards_new: number
  cards_learning: number
  cards_review: number
  /** Mean stability across cards with a memory state, in days. Null when there are none. */
  mean_stability: number | null
  /** Cards due right now, across every deck. */
  due_now: number
}

export interface RatingBreakdown {
  again: number
  hard: number
  good: number
  easy: number
}

/** Per-notebook study snapshot for the Stats subject table. */
export interface SubjectStat {
  notebook_id: number
  reviews: number
  retention: number | null
  focus_minutes: number
  cards_due: number
}

export interface NoteTaskItem {
  taskId: number | null
  title: string
  checked: boolean
}

export interface OnboardingPayload {
  notebookName: string
  purpose: 'school' | 'work' | 'personal'
  journal: boolean
}

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

export interface QuickAddPayload {
  kind: 'note' | 'task'
  text: string
  due?: string | null // ISO, for task
}
