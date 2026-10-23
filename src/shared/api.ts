import type {
  OpenTask,
  Note,
  Task,
  Deck,
  Card,
  SearchResult,
  NoteTaskItem,
  NoteCardLine,
  ReviewGrade,
} from './types'

export interface InklingApi {
  notebooks: {
    /** The notebook new notes and decks go into. */
    home(): Promise<number>
  }
  notes: {
    list(): Promise<Note[]>
    get(id: number): Promise<Note | null>
    create(input: { notebook_id: number; title?: string | null; content?: string }): Promise<Note>
    /** With `base`, writes only over that content; otherwise returns the stored note as it is. */
    update(id: number, patch: Partial<Pick<Note, 'title' | 'content' | 'notebook_id'>>, base?: string): Promise<Note | null>
    /** Soft delete, undoable from the toast and cleared for good after the retention window. */
    remove(id: number): Promise<void>
    restore(id: number): Promise<Note | null>
    /** With `base`, null and nothing synced once the stored content is another. */
    syncTasks(noteId: number, notebookId: number, items: NoteTaskItem[], base?: string): Promise<Array<number> | null>
    /** Syncs the note's card lines into its linked deck, made on the first run and named `name`. */
    syncCards(noteId: number, notebookId: number, name: string, lines: NoteCardLine[]): Promise<{ deck: Deck; lineIds: number[] }>
  }
  tasks: {
    open(): Promise<OpenTask[]>
    setDone(id: number, done: boolean): Promise<Task | null>
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
  }
  settings: {
    all(): Promise<Record<string, string>>
    set(key: string, value: string): Promise<void>
  }
  search: {
    query(q: string): Promise<SearchResult[]>
  }
  app: {
    /** Matches the window buttons and background to the theme. */
    setTitlebar(theme: 'light' | 'dark'): Promise<void>
    saveFile(defaultName: string, contents: string): Promise<{ saved: boolean; path: string | null; error?: string }>
  }
}
