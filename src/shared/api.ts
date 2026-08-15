import type {
  Notebook,
  Note,
  Task,
  Deck,
  Card,
  SearchResult,
  StreakInfo,
  NoteTaskItem,
  OnboardingPayload,
  ColorKey,
  NotebookKind,
  NoteType,
  ReviewGrade,
  QuickAddPayload,
  Grade,
  StatsOverview,
  ActivityDay,
  ForecastDay,
  RatingBreakdown,
  SubjectStat
} from './types'
import type { GradingSystem } from './grades'

export interface InklingApi {
  notebooks: {
    list(): Promise<Notebook[]>
    create(input: { name: string; color: ColorKey; icon?: string | null; kind?: NotebookKind; is_journal?: boolean }): Promise<Notebook>
    update(id: number, patch: Partial<Pick<Notebook, 'name' | 'color' | 'icon' | 'kind' | 'sort_order'>>): Promise<Notebook>
    remove(id: number): Promise<void>
  }
  notes: {
    list(notebookId: number, type?: NoteType): Promise<Note[]>
    get(id: number): Promise<Note | null>
    create(input: {
      notebook_id: number
      type: NoteType
      title?: string | null
      content?: string
      color?: string | null
      pos_x?: number
      pos_y?: number
      width?: number
      height?: number
    }): Promise<Note>
    update(
      id: number,
      patch: Partial<Pick<Note, 'title' | 'content' | 'color' | 'pos_x' | 'pos_y' | 'width' | 'height' | 'pinned' | 'notebook_id'>>
    ): Promise<Note | null>
    /** Soft delete — recoverable via `restore` until the retention window expires. */
    remove(id: number): Promise<void>
    restore(id: number): Promise<Note | null>
    listDeleted(notebookId?: number): Promise<Note[]>
    purge(id: number): Promise<void>
    emptyTrash(): Promise<number>
    syncTasks(noteId: number, notebookId: number, items: NoteTaskItem[]): Promise<Array<number>>
    /** Resolve `[[labels]]` to page ids (creating missing pages) and rebuild the note's links. */
    syncLinks(noteId: number, notebookId: number, labels: string[]): Promise<Array<number>>
    backlinks(noteId: number): Promise<Note[]>
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
      priority?: Task['priority']
      due_date?: string | null
      parent_task_id?: number | null
      note_id?: number | null
    }): Promise<Task>
    update(id: number, patch: Partial<Pick<Task, 'title' | 'status' | 'priority' | 'due_date' | 'notebook_id' | 'parent_task_id'>>): Promise<Task>
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
  tags: {
    /** Every `#hashtag` in use, most-used first. Derived from note text on save. */
    list(notebookId?: number): Promise<Array<{ tag: string; count: number }>>
    forNote(noteId: number): Promise<string[]>
    notes(tag: string, notebookId?: number): Promise<Note[]>
  }
  stats: {
    overview(windowDays?: number): Promise<StatsOverview>
    activity(days?: number): Promise<ActivityDay[]>
    forecast(days?: number): Promise<ForecastDay[]>
    ratings(windowDays?: number): Promise<RatingBreakdown>
    subjects(windowDays?: number): Promise<SubjectStat[]>
  }
  grades: {
    list(notebookId: number): Promise<Grade[]>
    all(): Promise<Grade[]>
    create(input: { notebook_id: number; title: string; score: number; max: number; weight: number; system?: GradingSystem }): Promise<Grade>
    update(id: number, patch: Partial<Pick<Grade, 'title' | 'score' | 'max' | 'weight'>>): Promise<Grade>
    remove(id: number): Promise<void>
  }
  app: {
    completeOnboarding(payload: OnboardingPayload): Promise<void>
    setTitlebar(colors: { color: string; symbolColor: string }): Promise<void>
    quickAdd(payload: QuickAddPayload): Promise<void>
    hideQuickAdd(): Promise<void>
    /** Open a file picker and import the chosen Markdown files as pages. */
    importMarkdown(notebookId: number): Promise<{ imported: number; failed: number; firstNoteId: number | null }>
    /** Open a file picker and import a CSV/TSV of cards as a new deck. */
    importDeck(
      notebookId: number
    ): Promise<{ imported: number; skipped: number; deckId: number | null; deckName: string | null; error?: string }>
    saveFile(defaultName: string, contents: string): Promise<{ saved: boolean; path: string | null; error?: string }>
    savePdf(bodyHtml: string, title: string, defaultName: string): Promise<{ saved: boolean; path: string | null; error?: string }>
    onDataChanged(cb: (domain: string) => void): () => void
  }
}
