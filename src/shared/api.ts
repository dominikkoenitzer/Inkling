import type {
  OpenTask,
  Note,
  NoteBase,
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

/** What a menu bar item can ask the window to do, the same as its keyboard shortcut. */
export type AppCommand = 'new-note' | 'today' | 'study' | 'search' | 'settings' | 'shortcuts'

export interface InklingApi {
  notebooks: {
    /** The notebook new notes and decks go into. */
    home(): Promise<number>
  }
  notes: {
    list(): Promise<Note[]>
    get(id: number): Promise<Note | null>
    create(input: { notebook_id: number; title?: string | null; content?: string }): Promise<Note>
    /** With `base`, writes only over that title and content; otherwise returns the stored note as it is. */
    update(id: number, patch: Partial<Pick<Note, 'title' | 'content' | 'notebook_id'>>, base?: NoteBase): Promise<Note | null>
    /** Soft delete, undoable from the toast and cleared for good after the retention window. */
    remove(id: number): Promise<void>
    restore(id: number): Promise<Note | null>
    /** Deletes the note for good if it is still completely empty; true if it went. */
    dropIfEmpty(id: number): Promise<boolean>
    /**
     * Syncs the to-dos and saves the note in one step, with their ids stamped in. With `base`,
     * nothing is written once the stored title or content is another: the stored note comes back with no ids.
     */
    saveWithTasks(
      noteId: number,
      notebookId: number,
      patch: { title: string | null; content: string },
      items: NoteTaskItem[],
      base?: NoteBase
    ): Promise<{ note: Note; ids: number[] | null } | null>
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
    /** Called when a menu bar item asks for one of the app's commands. Returns the unsubscribe. */
    onCommand(fn: (command: AppCommand) => void): () => void
  }
  app: {
    /** Matches the window buttons and background to the theme. */
    setTitlebar(theme: 'light' | 'dark'): Promise<void>
    saveFile(defaultName: string, contents: string): Promise<{ saved: boolean; path: string | null; error?: string }>
  }
}
