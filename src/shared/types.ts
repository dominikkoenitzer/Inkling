export type ColorKey = 'teal' | 'coral' | 'amber' | 'pink' | 'gray'
export type NotebookKind = 'general' | 'school_subject'
export type NoteType = 'page' | 'sticky'
export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type Priority = 'low' | 'medium' | 'high'
export type ModuleTab = 'today' | 'notes' | 'tasks' | 'study' | 'grades'

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
  ease_factor: number
  interval_days: number
  repetitions: number
  next_review_date: string
}

export interface Grade {
  id: number
  notebook_id: number
  title: string
  score: number
  max: number
  weight: number
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
