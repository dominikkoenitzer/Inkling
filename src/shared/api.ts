import type {
  Notebook,
  Note,
  Task,
  Deck,
  Card,
  SearchResult,
  StreakInfo,
  NoteTaskItem,
  ColorKey,
  ReviewGrade,
  Grade,
  StatsOverview,
  ActivityDay
} from './types'
import type { GradingSystem } from './grades'

export interface InklingApi {
  notebooks: {
    list(): Promise<Notebook[]>
    create(input: { name: string; color: ColorKey }): Promise<Notebook>
    update(id: number, patch: Partial<Pick<Notebook, 'name' | 'color' | 'sort_order'>>): Promise<Notebook>
    remove(id: number): Promise<void>
  }
  notes: {
    list(notebookId: number): Promise<Note[]>
    get(id: number): Promise<Note | null>
    create(input: { notebook_id: number; title?: string | null; content?: string }): Promise<Note>
    update(id: number, patch: Partial<Pick<Note, 'title' | 'content' | 'notebook_id'>>): Promise<Note | null>
    /** Soft delete, undoable from the toast and cleared for good after the retention window. */
    remove(id: number): Promise<void>
    restore(id: number): Promise<Note | null>
    syncTasks(noteId: number, notebookId: number, items: NoteTaskItem[]): Promise<Array<number>>
  }
  tasks: {
    list(notebookId: number): Promise<Task[]>
    smart(view: 'today' | 'week'): Promise<Task[]>
    forNote(noteId: number): Promise<Task[]>
    get(id: number): Promise<Task | null>
    create(input: {
      notebook_id: number
      title: string
      status?: Task['status']
      due_date?: string | null
      note_id?: number | null
    }): Promise<Task>
    update(id: number, patch: Partial<Pick<Task, 'title' | 'status' | 'due_date' | 'notebook_id'>>): Promise<Task>
    remove(id: number): Promise<void>
  }
  decks: {
    list(notebookId?: number): Promise<Deck[]>
    create(notebookId: number, name: string): Promise<Deck>
    rename(id: number, name: string): Promise<void>
    remove(id: number): Promise<void>
    cards(deckId: number): Promise<Card[]>
    dueCards(deckId: number): Promise<Card[]>
    addCard(deckId: number, front: string, back: string): Promise<Card>
    updateCard(id: number, front: string, back: string): Promise<void>
    removeCard(id: number): Promise<void>
    review(cardId: number, grade: ReviewGrade): Promise<Card>
    createFromPairs(notebookId: number, name: string, pairs: Array<[string, string]>): Promise<Deck>
  }
  focus: {
    start(input: { task_id?: number | null; deck_id?: number | null }): Promise<number>
    complete(id: number, minutes: number): Promise<void>
    todayMinutes(): Promise<number>
  }
  streak: {
    get(): Promise<StreakInfo>
    bump(localDay: string): Promise<StreakInfo>
  }
  settings: {
    all(): Promise<Record<string, string>>
    set(key: string, value: string): Promise<void>
  }
  search: {
    query(q: string): Promise<SearchResult[]>
  }
  stats: {
    overview(windowDays?: number): Promise<StatsOverview>
    activity(days?: number): Promise<ActivityDay[]>
  }
  grades: {
    list(notebookId: number): Promise<Grade[]>
    all(): Promise<Grade[]>
    create(input: { notebook_id: number; title: string; score: number; max: number; weight: number; system?: GradingSystem }): Promise<Grade>
    update(id: number, patch: Partial<Pick<Grade, 'title' | 'score' | 'max' | 'weight'>>): Promise<Grade>
    remove(id: number): Promise<void>
  }
  app: {
    setTitlebar(colors: { color: string; symbolColor: string }): Promise<void>
    saveFile(defaultName: string, contents: string): Promise<{ saved: boolean; path: string | null; error?: string }>
  }
}
