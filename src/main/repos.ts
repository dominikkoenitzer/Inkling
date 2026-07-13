import { getDb } from './db'
import type {
  Notebook,
  Note,
  Task,
  CalEvent,
  Deck,
  Card,
  SearchResult,
  StreakInfo,
  NoteTaskItem,
  OnboardingPayload,
  ColorKey,
  NoteType,
  ReviewGrade
} from '@shared/types'

const now = (): string => new Date().toISOString()

/* ---------------------------------- FTS ---------------------------------- */

export function tiptapToText(json: string): string {
  try {
    const doc = JSON.parse(json)
    const out: string[] = []
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      const node = n as { text?: string; content?: unknown[] }
      if (typeof node.text === 'string') out.push(node.text)
      if (Array.isArray(node.content)) node.content.forEach(walk)
    }
    walk(doc)
    return out.join(' ')
  } catch {
    return ''
  }
}

function ftsDelete(sourceType: string, sourceId: number): void {
  getDb().prepare(`DELETE FROM search_index WHERE source_type = ? AND source_id = ?`).run(sourceType, String(sourceId))
}

function ftsUpsert(sourceType: string, sourceId: number, title: string, contentText: string): void {
  ftsDelete(sourceType, sourceId)
  getDb()
    .prepare(`INSERT INTO search_index (title, content_text, source_type, source_id) VALUES (?, ?, ?, ?)`)
    .run(title, contentText, sourceType, String(sourceId))
}

export function searchQuery(q: string): SearchResult[] {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (tokens.length === 0) return []
  const match = tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' AND ')
  const rows = getDb()
    .prepare(
      `SELECT title, snippet(search_index, 1, '⟪', '⟫', '…', 10) AS snippet, source_type, source_id
       FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 20`
    )
    .all(match) as Array<{ title: string; snippet: string; source_type: string; source_id: string }>
  const results: SearchResult[] = []
  for (const r of rows) {
    const id = Number(r.source_id)
    let notebookId: number | null = null
    if (r.source_type === 'note') notebookId = (getDb().prepare(`SELECT notebook_id FROM notes WHERE id = ?`).get(id) as { notebook_id: number } | undefined)?.notebook_id ?? null
    else if (r.source_type === 'task') notebookId = (getDb().prepare(`SELECT notebook_id FROM tasks WHERE id = ?`).get(id) as { notebook_id: number } | undefined)?.notebook_id ?? null
    else if (r.source_type === 'deck') notebookId = (getDb().prepare(`SELECT notebook_id FROM flashcard_decks WHERE id = ?`).get(id) as { notebook_id: number } | undefined)?.notebook_id ?? null
    if (notebookId === null) continue // stale index row
    results.push({
      source_type: r.source_type as SearchResult['source_type'],
      source_id: id,
      title: r.title,
      snippet: r.snippet,
      notebook_id: notebookId
    })
  }
  return results
}

/* -------------------------------- Notebooks ------------------------------- */

export function listNotebooks(): Notebook[] {
  return getDb().prepare(`SELECT * FROM notebooks ORDER BY sort_order, id`).all() as Notebook[]
}

export function createNotebook(input: { name: string; color: ColorKey; kind?: string; is_journal?: boolean }): Notebook {
  const max = (getDb().prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM notebooks`).get() as { m: number }).m
  const info = getDb()
    .prepare(`INSERT INTO notebooks (name, color, kind, sort_order, is_journal) VALUES (?, ?, ?, ?, ?)`)
    .run(input.name, input.color, input.kind ?? 'general', max + 1, input.is_journal ? 1 : 0)
  return getDb().prepare(`SELECT * FROM notebooks WHERE id = ?`).get(info.lastInsertRowid) as Notebook
}

export function updateNotebook(id: number, patch: Record<string, unknown>): Notebook {
  const allowed = ['name', 'color', 'icon', 'kind', 'sort_order'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE notebooks SET ${sets} WHERE id = @id`).run({ ...patch, id })
  }
  return getDb().prepare(`SELECT * FROM notebooks WHERE id = ?`).get(id) as Notebook
}

export function removeNotebook(id: number): void {
  const db = getDb()
  const noteIds = db.prepare(`SELECT id FROM notes WHERE notebook_id = ?`).all(id) as Array<{ id: number }>
  const taskIds = db.prepare(`SELECT id FROM tasks WHERE notebook_id = ?`).all(id) as Array<{ id: number }>
  const deckIds = db.prepare(`SELECT id FROM flashcard_decks WHERE notebook_id = ?`).all(id) as Array<{ id: number }>
  const tx = db.transaction(() => {
    for (const n of noteIds) ftsDelete('note', n.id)
    for (const t of taskIds) ftsDelete('task', t.id)
    for (const d of deckIds) ftsDelete('deck', d.id)
    db.prepare(`DELETE FROM notebooks WHERE id = ?`).run(id)
  })
  tx()
}

/* ---------------------------------- Notes --------------------------------- */

const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

export function listNotes(notebookId: number, type?: NoteType): Note[] {
  if (type) {
    return getDb()
      .prepare(`SELECT * FROM notes WHERE notebook_id = ? AND type = ? ORDER BY pinned DESC, updated_at DESC`)
      .all(notebookId, type) as Note[]
  }
  return getDb().prepare(`SELECT * FROM notes WHERE notebook_id = ? ORDER BY pinned DESC, updated_at DESC`).all(notebookId) as Note[]
}

export function getNote(id: number): Note | null {
  return (getDb().prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as Note | undefined) ?? null
}

export function createNote(input: {
  notebook_id: number
  type: NoteType
  title?: string | null
  content?: string
  color?: string | null
  pos_x?: number
  pos_y?: number
  width?: number
  height?: number
}): Note {
  const content = input.content ?? EMPTY_DOC
  const ts = now()
  const info = getDb()
    .prepare(
      `INSERT INTO notes (notebook_id, type, title, content, color, pos_x, pos_y, width, height, created_at, updated_at)
       VALUES (@notebook_id, @type, @title, @content, @color, @pos_x, @pos_y, @width, @height, @ts, @ts)`
    )
    .run({
      notebook_id: input.notebook_id,
      type: input.type,
      title: input.title ?? null,
      content,
      color: input.color ?? null,
      pos_x: input.pos_x ?? null,
      pos_y: input.pos_y ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      ts
    })
  const note = getNote(Number(info.lastInsertRowid))!
  ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  return note
}

export function updateNote(id: number, patch: Record<string, unknown>): Note | null {
  const allowed = ['title', 'content', 'color', 'pos_x', 'pos_y', 'width', 'height', 'pinned', 'notebook_id'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb()
      .prepare(`UPDATE notes SET ${sets}, updated_at = @ts WHERE id = @id`)
      .run({ ...patch, id, ts: now() })
  }
  const note = getNote(id)
  if (!note) return null // row was deleted (e.g. a debounced save landing after the note was removed)
  if ('title' in patch || 'content' in patch) {
    ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  }
  return note
}

export function removeNote(id: number): void {
  getDb().prepare(`DELETE FROM notes WHERE id = ?`).run(id)
  ftsDelete('note', id)
}

/**
 * Bidirectional note↔task linking: given the checklist items currently present in a
 * note's content, create/update matching task rows and prune tasks whose checkbox
 * was deleted from the note. Returns task ids in the same order as `items`.
 */
export function syncNoteTasks(noteId: number, notebookId: number, items: NoteTaskItem[]): number[] {
  const db = getDb()
  const ids: number[] = []
  const tx = db.transaction(() => {
    const existing = db.prepare(`SELECT * FROM tasks WHERE note_id = ?`).all(noteId) as Task[]
    const byId = new Map(existing.map((t) => [t.id, t]))
    for (const item of items) {
      const title = item.title.trim() || 'Untitled task'
      const current = item.taskId !== null ? byId.get(item.taskId) : undefined
      if (current) {
        let status = current.status
        if (item.checked && status !== 'done') status = 'done'
        if (!item.checked && status === 'done') status = 'todo'
        db.prepare(`UPDATE tasks SET title = ?, status = ?, completed_at = ? WHERE id = ?`).run(
          title,
          status,
          status === 'done' ? (current.completed_at ?? now()) : null,
          current.id
        )
        ftsUpsert('task', current.id, title, '')
        ids.push(current.id)
        byId.delete(current.id)
      } else {
        const info = db
          .prepare(
            `INSERT INTO tasks (notebook_id, note_id, title, status, priority, created_at, completed_at)
             VALUES (?, ?, ?, ?, 'medium', ?, ?)`
          )
          .run(notebookId, noteId, title, item.checked ? 'done' : 'todo', now(), item.checked ? now() : null)
        const newId = Number(info.lastInsertRowid)
        ftsUpsert('task', newId, title, '')
        ids.push(newId)
      }
    }
    for (const orphan of byId.values()) {
      db.prepare(`DELETE FROM tasks WHERE id = ?`).run(orphan.id)
      ftsDelete('task', orphan.id)
    }
  })
  tx()
  return ids
}

/** Reflect a task status change back into its source note's checkbox (if linked). */
function updateNoteCheckbox(noteId: number, taskId: number, checked: boolean): void {
  const note = getNote(noteId)
  if (!note) return
  try {
    const doc = JSON.parse(note.content)
    let changed = false
    const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): void => {
      if (n.type === 'taskItem' && n.attrs && Number(n.attrs.taskId) === taskId) {
        if (n.attrs.checked !== checked) {
          n.attrs.checked = checked
          changed = true
        }
      }
      if (Array.isArray(n.content)) n.content.forEach((c) => walk(c as never))
    }
    walk(doc)
    if (changed) {
      getDb().prepare(`UPDATE notes SET content = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(doc), now(), noteId)
    }
  } catch {
    /* malformed content — skip */
  }
}

/* ---------------------------------- Tasks --------------------------------- */

export function listTasks(notebookId: number): Task[] {
  return getDb()
    .prepare(
      `SELECT * FROM tasks WHERE notebook_id = ?
       ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, due_date IS NULL, due_date, id DESC`
    )
    .all(notebookId) as Task[]
}

export function smartTasks(view: 'today' | 'week'): Task[] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + (view === 'today' ? 1 : 7))
  return getDb()
    .prepare(
      `SELECT * FROM tasks WHERE status != 'done' AND due_date IS NOT NULL AND due_date < ?
       ORDER BY due_date, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`
    )
    .all(end.toISOString()) as Task[]
}

export function tasksForNote(noteId: number): Task[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE note_id = ? ORDER BY id`).all(noteId) as Task[]
}

export function getTask(id: number): Task | null {
  return (getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined) ?? null
}

export function createTask(input: {
  notebook_id: number
  title: string
  status?: string
  priority?: string
  due_date?: string | null
  parent_task_id?: number | null
  note_id?: number | null
}): Task {
  const info = getDb()
    .prepare(
      `INSERT INTO tasks (notebook_id, note_id, title, status, priority, due_date, parent_task_id, created_at)
       VALUES (@notebook_id, @note_id, @title, @status, @priority, @due_date, @parent_task_id, @ts)`
    )
    .run({
      notebook_id: input.notebook_id,
      note_id: input.note_id ?? null,
      title: input.title,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      due_date: input.due_date ?? null,
      parent_task_id: input.parent_task_id ?? null,
      ts: now()
    })
  const task = getTask(Number(info.lastInsertRowid))!
  ftsUpsert('task', task.id, task.title, '')
  return task
}

export function updateTask(id: number, patch: Record<string, unknown>): Task {
  const before = getTask(id)
  const allowed = ['title', 'status', 'priority', 'due_date', 'notebook_id', 'parent_task_id'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run({ ...patch, id })
  }
  if ('status' in patch && before) {
    const done = patch.status === 'done'
    getDb().prepare(`UPDATE tasks SET completed_at = ? WHERE id = ?`).run(done ? now() : null, id)
    if (before.note_id !== null) updateNoteCheckbox(before.note_id, id, done)
  }
  const task = getTask(id)!
  if ('title' in patch) ftsUpsert('task', id, task.title, '')
  return task
}

export function removeTask(id: number): void {
  const subs = getDb().prepare(`SELECT id FROM tasks WHERE parent_task_id = ?`).all(id) as Array<{ id: number }>
  getDb().prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
  ftsDelete('task', id)
  for (const s of subs) ftsDelete('task', s.id)
}

/* --------------------------------- Events --------------------------------- */

export function eventsWindow(startISO: string, endISO: string): CalEvent[] {
  return getDb()
    .prepare(
      `SELECT * FROM events
       WHERE recurrence_rule IS NOT NULL
          OR (start_time < ? AND COALESCE(end_time, start_time) >= ?)
       ORDER BY start_time`
    )
    .all(endISO, startISO) as CalEvent[]
}

export function createEvent(input: {
  notebook_id: number
  title: string
  start_time: string
  end_time?: string | null
  recurrence_rule?: string | null
  linked_task_id?: number | null
  color?: string | null
}): CalEvent {
  const info = getDb()
    .prepare(
      `INSERT INTO events (notebook_id, title, start_time, end_time, recurrence_rule, linked_task_id, color)
       VALUES (@notebook_id, @title, @start_time, @end_time, @recurrence_rule, @linked_task_id, @color)`
    )
    .run({
      notebook_id: input.notebook_id,
      title: input.title,
      start_time: input.start_time,
      end_time: input.end_time ?? null,
      recurrence_rule: input.recurrence_rule ?? null,
      linked_task_id: input.linked_task_id ?? null,
      color: input.color ?? null
    })
  return getDb().prepare(`SELECT * FROM events WHERE id = ?`).get(info.lastInsertRowid) as CalEvent
}

export function updateEvent(id: number, patch: Record<string, unknown>): CalEvent {
  const allowed = ['notebook_id', 'title', 'start_time', 'end_time', 'recurrence_rule', 'linked_task_id', 'color'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE events SET ${sets} WHERE id = @id`).run({ ...patch, id })
  }
  return getDb().prepare(`SELECT * FROM events WHERE id = ?`).get(id) as CalEvent
}

export function removeEvent(id: number): void {
  getDb().prepare(`DELETE FROM events WHERE id = ?`).run(id)
}

/* -------------------------------- Flashcards ------------------------------ */

export function listDecks(notebookId?: number): Deck[] {
  const nowIso = now()
  const base = `
    SELECT d.*,
      (SELECT COUNT(*) FROM flashcards c WHERE c.deck_id = d.id) AS card_count,
      (SELECT COUNT(*) FROM flashcards c WHERE c.deck_id = d.id AND c.next_review_date <= ?) AS due_count
    FROM flashcard_decks d`
  if (notebookId !== undefined) {
    return getDb().prepare(`${base} WHERE d.notebook_id = ? ORDER BY d.id`).all(nowIso, notebookId) as Deck[]
  }
  return getDb().prepare(`${base} ORDER BY d.id`).all(nowIso) as Deck[]
}

export function createDeck(notebookId: number, name: string): Deck {
  const info = getDb()
    .prepare(`INSERT INTO flashcard_decks (notebook_id, name, created_at) VALUES (?, ?, ?)`)
    .run(notebookId, name, now())
  const id = Number(info.lastInsertRowid)
  ftsUpsert('deck', id, name, '')
  return listDecks(notebookId).find((d) => d.id === id)!
}

export function renameDeck(id: number, name: string): void {
  getDb().prepare(`UPDATE flashcard_decks SET name = ? WHERE id = ?`).run(name, id)
  ftsUpsert('deck', id, name, '')
}

export function removeDeck(id: number): void {
  getDb().prepare(`DELETE FROM flashcard_decks WHERE id = ?`).run(id)
  ftsDelete('deck', id)
}

export function listCards(deckId: number): Card[] {
  return getDb().prepare(`SELECT * FROM flashcards WHERE deck_id = ? ORDER BY id`).all(deckId) as Card[]
}

export function dueCards(deckId: number): Card[] {
  return getDb()
    .prepare(`SELECT * FROM flashcards WHERE deck_id = ? AND next_review_date <= ? ORDER BY next_review_date`)
    .all(deckId, now()) as Card[]
}

export function addCard(deckId: number, front: string, back: string): Card {
  const info = getDb()
    .prepare(`INSERT INTO flashcards (deck_id, front, back, next_review_date) VALUES (?, ?, ?, ?)`)
    .run(deckId, front, back, now())
  return getDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(info.lastInsertRowid) as Card
}

export function updateCard(id: number, front: string, back: string): void {
  getDb().prepare(`UPDATE flashcards SET front = ?, back = ? WHERE id = ?`).run(front, back, id)
}

export function removeCard(id: number): void {
  getDb().prepare(`DELETE FROM flashcards WHERE id = ?`).run(id)
}

/** SM-2 spaced repetition. Grades map to quality: again=2, hard=3, good=4, easy=5. */
export function reviewCard(cardId: number, grade: ReviewGrade): Card {
  const card = getDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card
  const quality = grade === 'again' ? 2 : grade === 'hard' ? 3 : grade === 'good' ? 4 : 5
  let { ease_factor: ef, interval_days: interval, repetitions: reps } = card
  let nextMs: number
  if (quality < 3) {
    reps = 0
    interval = 0
    nextMs = Date.now() + 10 * 60 * 1000 // come back in ~10 minutes
  } else {
    reps += 1
    if (reps === 1) interval = 1
    else if (reps === 2) interval = 6
    else interval = Math.round(interval * ef)
    ef = Math.max(1.3, ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    nextMs = Date.now() + interval * 24 * 60 * 60 * 1000
  }
  getDb()
    .prepare(`UPDATE flashcards SET ease_factor = ?, interval_days = ?, repetitions = ?, next_review_date = ? WHERE id = ?`)
    .run(ef, interval, reps, new Date(nextMs).toISOString(), cardId)
  return getDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card
}

export function createDeckFromPairs(notebookId: number, name: string, pairs: Array<[string, string]>): Deck {
  const deck = createDeck(notebookId, name)
  const insert = getDb().prepare(`INSERT INTO flashcards (deck_id, front, back, next_review_date) VALUES (?, ?, ?, ?)`)
  const tx = getDb().transaction(() => {
    for (const [front, back] of pairs) insert.run(deck.id, front, back, now())
  })
  tx()
  return listDecks(notebookId).find((d) => d.id === deck.id)!
}

/* ------------------------------ Focus & streak ---------------------------- */

export function startFocus(input: { task_id?: number | null; deck_id?: number | null }): number {
  const info = getDb()
    .prepare(`INSERT INTO focus_sessions (task_id, deck_id, started_at, completed) VALUES (?, ?, ?, 0)`)
    .run(input.task_id ?? null, input.deck_id ?? null, now())
  return Number(info.lastInsertRowid)
}

export function completeFocus(id: number, minutes: number): void {
  getDb().prepare(`UPDATE focus_sessions SET duration_minutes = ?, completed = 1 WHERE id = ?`).run(minutes, id)
}

export function todayFocusMinutes(): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(duration_minutes), 0) AS m FROM focus_sessions WHERE completed = 1 AND started_at >= ?`)
    .get(start.toISOString()) as { m: number }
  return row.m
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
}

export function allSettings(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as Array<{ key: string; value: string }>
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export function getStreak(): StreakInfo {
  return {
    count: Number(getSetting('streak_count') ?? '0'),
    last_day: getSetting('streak_last_day')
  }
}

/** Gentle streak: same day is a no-op, consecutive day increments, a gap quietly restarts at 1. */
export function bumpStreak(localDay: string): StreakInfo {
  const last = getSetting('streak_last_day')
  let count = Number(getSetting('streak_count') ?? '0')
  if (last !== localDay) {
    const prev = new Date(localDay + 'T12:00:00')
    prev.setDate(prev.getDate() - 1)
    const yesterday = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
    count = last === yesterday ? count + 1 : 1
    setSetting('streak_count', String(count))
    setSetting('streak_last_day', localDay)
  }
  return { count, last_day: localDay }
}

/* -------------------------------- Onboarding ------------------------------ */

function welcomeDoc(): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Welcome to Inkling 👋' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'This is your first page. Type anywhere — everything saves automatically. Try ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '**bold**' },
          { type: 'text', text: ', ' },
          { type: 'text', marks: [{ type: 'italic' }], text: '*italic*' },
          { type: 'text', text: ', or start a line with # for a heading.' }
        ]
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Checkboxes become real tasks' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Type [] at the start of a line — the item also shows up in your Tasks tab, fully linked both ways.' }]
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false, taskId: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check me off — watch the Tasks tab' }] }]
          }
        ]
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lines like these become flashcards' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Photosynthesis :: The process plants use to convert light into energy' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Mitochondria :: The powerhouse of the cell' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Open the ✨ menu in the editor toolbar and pick “Make flashcards from this note”.' }]
      }
    ]
  })
}

export function completeOnboarding(payload: OnboardingPayload): void {
  const first = createNotebook({ name: payload.notebookName || 'My Notebook', color: 'teal', kind: payload.purpose === 'school' ? 'school_subject' : 'general' })
  createNote({ notebook_id: first.id, type: 'page', title: 'Welcome to Inkling', content: welcomeDoc() })
  if (payload.purpose === 'school') {
    createNotebook({ name: 'Assignments', color: 'coral', kind: 'school_subject' })
    createNotebook({ name: 'Class Notes', color: 'amber', kind: 'school_subject' })
    createNotebook({ name: 'Study Decks', color: 'pink', kind: 'school_subject' })
  } else if (payload.purpose === 'work') {
    createNotebook({ name: 'Projects', color: 'coral' })
    createNotebook({ name: 'Meetings', color: 'amber' })
  }
  if (payload.journal) {
    createNotebook({ name: 'Journal', color: 'gray', is_journal: true })
  }
  setSetting('onboarding_done', '1')
  setSetting('purpose', payload.purpose)
}
