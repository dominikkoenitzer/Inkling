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
  AssistantStatus,
  AssistantId,
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
    update(id: number, patch: Partial<Pick<Note, 'title' | 'content' | 'notebook_id'>>): Promise<Note | null>
    /** Soft delete, undoable from the toast and cleared for good after the retention window. */
    remove(id: number): Promise<void>
    restore(id: number): Promise<Note | null>
    /** Deletes the note for good if it is still completely empty; true if it went. */
    dropIfEmpty(id: number): Promise<boolean>
    syncTasks(noteId: number, notebookId: number, items: NoteTaskItem[]): Promise<Array<number>>
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
  assistants: {
    /** The assistant apps Inkling can connect to, and whether each has it. */
    list(): Promise<AssistantStatus[]>
    connect(id: AssistantId): Promise<AssistantStatus[]>
    disconnect(id: AssistantId): Promise<AssistantStatus[]>
    /** Puts the MCP setup for any other client on the clipboard. */
    copySetup(): Promise<void>
  }
  events: {
    /** Called when another process, such as the MCP server, has written to the data. Returns the unsubscribe. */
    onDataChanged(fn: () => void): () => void
  }
  app: {
    /** Matches the window buttons and background to the theme. */
    setTitlebar(theme: 'light' | 'dark'): Promise<void>
    saveFile(defaultName: string, contents: string): Promise<{ saved: boolean; path: string | null; error?: string }>
  }
}
