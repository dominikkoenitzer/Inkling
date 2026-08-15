import { getDb } from './db'
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
  NoteType,
  ReviewGrade,
  Grade
} from '@shared/types'
import type { GradingSystem } from '@shared/grades'
import type { ActivityDay, ForecastDay, RatingBreakdown, StatsOverview, SubjectStat } from '@shared/types'
import { RATINGS, schedule } from '@shared/fsrs'
import { extractTags } from '@shared/tags'

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

export function createNotebook(input: { name: string; color: ColorKey; icon?: string | null; kind?: string; is_journal?: boolean }): Notebook {
  const max = (getDb().prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM notebooks`).get() as { m: number }).m
  const info = getDb()
    .prepare(`INSERT INTO notebooks (name, color, icon, kind, sort_order, is_journal) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.name, input.color, input.icon ?? null, input.kind ?? 'general', max + 1, input.is_journal ? 1 : 0)
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
      .prepare(`SELECT * FROM notes WHERE notebook_id = ? AND type = ? AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`)
      .all(notebookId, type) as Note[]
  }
  return getDb()
    .prepare(`SELECT * FROM notes WHERE notebook_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`)
    .all(notebookId) as Note[]
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
  syncNoteTags(note.id, note.title, note.content)
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
    syncNoteTags(note.id, note.title, note.content)
  }
  return note
}

/* ---------------------------------- Tags ---------------------------------- */

/**
 * Rebuild a note's tags from its content. Called from create/update rather than exposed
 * over IPC, so the tag index cannot drift from the text it describes.
 */
export function syncNoteTags(noteId: number, title: string | null, content: string): void {
  const db = getDb()
  const tags = extractTags(`${title ?? ''} ${tiptapToText(content)}`)
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_tags WHERE note_id = ?`).run(noteId)
    const insert = db.prepare(`INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)`)
    for (const tag of tags) insert.run(noteId, tag)
  })
  tx()
}

/** Every tag used in a notebook, most-used first, with how many live notes carry it. */
export function listTags(notebookId?: number): Array<{ tag: string; count: number }> {
  const db = getDb()
  const where = notebookId === undefined ? '' : 'AND n.notebook_id = ?'
  const sql = `SELECT t.tag AS tag, COUNT(*) AS count
                 FROM note_tags t JOIN notes n ON n.id = t.note_id
                WHERE n.deleted_at IS NULL ${where}
                GROUP BY t.tag ORDER BY count DESC, t.tag`
  const stmt = db.prepare(sql)
  return (notebookId === undefined ? stmt.all() : stmt.all(notebookId)) as Array<{ tag: string; count: number }>
}

export function tagsForNote(noteId: number): string[] {
  return (getDb().prepare(`SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag`).all(noteId) as Array<{ tag: string }>).map(
    (r) => r.tag
  )
}

export function notesWithTag(tag: string, notebookId?: number): Note[] {
  const db = getDb()
  const where = notebookId === undefined ? '' : 'AND n.notebook_id = ?'
  const sql = `SELECT n.* FROM note_tags t JOIN notes n ON n.id = t.note_id
                WHERE t.tag = ? AND n.deleted_at IS NULL ${where}
                ORDER BY n.pinned DESC, n.updated_at DESC`
  const stmt = db.prepare(sql)
  return (notebookId === undefined ? stmt.all(tag.toLowerCase()) : stmt.all(tag.toLowerCase(), notebookId)) as Note[]
}

/** One-time backfill so notes written before v0.4.0 get their tags without an edit. */
export function backfillTags(): void {
  const rows = getDb().prepare(`SELECT id, title, content FROM notes`).all() as Array<{
    id: number
    title: string | null
    content: string
  }>
  for (const n of rows) syncNoteTags(n.id, n.title, n.content)
}

/** How long a deleted note is recoverable before the next launch clears it for good. */
export const TRASH_RETENTION_DAYS = 30

/**
 * Soft delete. Through v0.3.x this was an immediate `DELETE` with no confirmation and no
 * way back — one misclick in the sidebar and a page was gone. The row now gets a tombstone
 * instead: it drops out of every list and out of search, the UI offers an undo, and it is
 * purged for real after TRASH_RETENTION_DAYS.
 */
export function removeNote(id: number): void {
  getDb().prepare(`UPDATE notes SET deleted_at = ? WHERE id = ?`).run(now(), id)
  ftsDelete('note', id)
}

export function restoreNote(id: number): Note | null {
  getDb().prepare(`UPDATE notes SET deleted_at = NULL WHERE id = ?`).run(id)
  const note = getNote(id)
  if (note) ftsUpsert('note', note.id, note.title ?? 'Untitled', tiptapToText(note.content))
  return note
}

/** Notes currently in the trash, newest deletion first. */
export function listDeletedNotes(notebookId?: number): Note[] {
  const db = getDb()
  if (notebookId !== undefined) {
    return db
      .prepare(`SELECT * FROM notes WHERE deleted_at IS NOT NULL AND notebook_id = ? ORDER BY deleted_at DESC`)
      .all(notebookId) as Note[]
  }
  return db.prepare(`SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all() as Note[]
}

/** Permanently delete one trashed note. Tasks linked to it lose the link but survive. */
export function purgeNote(id: number): void {
  getDb().prepare(`DELETE FROM notes WHERE id = ? AND deleted_at IS NOT NULL`).run(id)
  ftsDelete('note', id)
}

export function emptyTrash(): number {
  const rows = listDeletedNotes()
  const del = getDb().prepare(`DELETE FROM notes WHERE id = ?`)
  const tx = getDb().transaction(() => {
    for (const n of rows) {
      del.run(n.id)
      ftsDelete('note', n.id)
    }
  })
  tx()
  return rows.length
}

/** Called once at startup: anything deleted longer ago than the retention window goes. */
export function purgeExpiredNotes(): number {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000).toISOString()
  const stale = getDb()
    .prepare(`SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
    .all(cutoff) as Array<{ id: number }>
  const del = getDb().prepare(`DELETE FROM notes WHERE id = ?`)
  const tx = getDb().transaction(() => {
    for (const n of stale) {
      del.run(n.id)
      ftsDelete('note', n.id)
    }
  })
  tx()
  return stale.length
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

/**
 * Resolve the `[[wiki-links]]` in a note and rebuild its outgoing edges.
 *
 * Mirrors `syncNoteTasks`: the note's content is the source of truth, this runs on save,
 * and it hands back one id per label in the same order so the editor can stamp the ids
 * into the document. A label that doesn't match an existing page creates one — that's the
 * whole point of linking as you write, rather than having to make the page first.
 */
export function syncNoteLinks(sourceNoteId: number, notebookId: number, labels: string[]): number[] {
  const db = getDb()
  const ids: number[] = []
  const tx = db.transaction(() => {
    for (const raw of labels) {
      const label = raw.trim()
      if (!label) {
        ids.push(0)
        continue
      }
      // Prefer a page in the current notebook, then anywhere — so "Chapter 4" resolves to
      // this subject's page rather than a same-named one in another subject.
      const match = (db
        .prepare(
          `SELECT id FROM notes
            WHERE type = 'page' AND deleted_at IS NULL AND LOWER(TRIM(COALESCE(title,''))) = LOWER(?)
            ORDER BY (notebook_id = ?) DESC, id
            LIMIT 1`
        )
        .get(label, notebookId) as { id: number } | undefined) ?? undefined

      const targetId = match ? match.id : createNote({ notebook_id: notebookId, type: 'page', title: label }).id
      ids.push(targetId)
    }

    db.prepare(`DELETE FROM note_links WHERE source_note_id = ?`).run(sourceNoteId)
    const insert = db.prepare(`INSERT OR IGNORE INTO note_links (source_note_id, target_note_id) VALUES (?, ?)`)
    for (const target of new Set(ids)) {
      if (target > 0 && target !== sourceNoteId) insert.run(sourceNoteId, target)
    }
  })
  tx()
  return ids
}

/** Notes that link *to* this one — the other half of a wiki-link, and the useful half. */
export function noteBacklinks(noteId: number): Note[] {
  return getDb()
    .prepare(
      `SELECT n.* FROM note_links l
         JOIN notes n ON n.id = l.source_note_id
        WHERE l.target_note_id = ? AND n.deleted_at IS NULL
        ORDER BY n.updated_at DESC`
    )
    .all(noteId) as Note[]
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

/** Desired retention, as a fraction. Settable in Settings; FSRS solves each interval for it. */
export function desiredRetention(): number {
  const raw = Number(getSetting('desired_retention') ?? '0.9')
  return Number.isFinite(raw) ? Math.min(0.99, Math.max(0.7, raw)) : 0.9
}

/**
 * Review one card with FSRS-4.5 (replaced SM-2 in v0.4.0) and append to the review log.
 *
 * The scheduling maths lives in `@shared/fsrs` and is pure; this function only reads the
 * card's memory state, writes the new one, and records what happened. The legacy SM-2
 * columns are kept roughly in step so a downgrade — or anything still reading them —
 * doesn't see nonsense.
 */
export function reviewCard(cardId: number, grade: ReviewGrade): Card {
  const db = getDb()
  const card = db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card | undefined
  if (!card) throw new Error(`card ${cardId} not found`)

  const now = new Date()
  const result = schedule(
    { state: card.state ?? 'new', stability: card.stability, difficulty: card.difficulty, lastReview: card.last_review },
    RATINGS[grade],
    now,
    desiredRetention()
  )
  const reviewedAt = now.toISOString()

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE flashcards
          SET stability = ?, difficulty = ?, state = ?, last_review = ?, next_review_date = ?,
              interval_days = ?, repetitions = ?, ease_factor = ?
        WHERE id = ?`
    ).run(
      result.stability,
      result.difficulty,
      result.state,
      reviewedAt,
      result.due,
      result.scheduledDays,
      grade === 'again' ? 0 : card.repetitions + 1,
      // Mirror difficulty back onto the SM-2 ease factor (inverse of the v4 migration).
      Math.round((2.5 - ((result.difficulty - 1) * 1.2) / 9) * 1000) / 1000,
      cardId
    )
    db.prepare(
      `INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cardId,
      card.deck_id,
      RATINGS[grade],
      // The state the card was in *when asked* — that's what "true retention" measures
      // against (a brand-new card's first answer isn't a memory test) and what FSRS
      // parameter fitting expects. Stability/difficulty below are the resulting values.
      card.state ?? 'new',
      result.stability,
      result.difficulty,
      result.elapsedDays,
      result.scheduledDays,
      reviewedAt
    )
  })
  tx()
  return db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(cardId) as Card
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

/**
 * Gentle streak, derived from what you actually did.
 *
 * Through v0.3.x this was two counters in `settings`, bumped when the app happened to be
 * open at the right moment — which meant the user bar and any other reader could disagree,
 * and a study session that ended without a bump vanished. Since v0.4.0 the review log and
 * focus history are the record, so the streak is computed from them and there is exactly
 * one answer. The old counter is still honoured while it's live, so nobody upgrading loses
 * a streak they earned before there was any history to derive it from.
 */
export function getStreak(): StreakInfo {
  const days = studyDays()
  const derived = streaksFrom(days)
  const legacyCount = Number(getSetting('streak_count') ?? '0')
  const legacyDay = getSetting('streak_last_day')

  if (derived.current === 0 && legacyCount > 0 && legacyDay && isLiveDay(legacyDay)) {
    return { count: legacyCount, last_day: legacyDay }
  }
  return { count: derived.current, last_day: days.at(-1) ?? legacyDay }
}

/**
 * Called after a review session or focus block. The history row is already written by the
 * time this runs, so there is nothing to increment — it just re-reads the truth. The legacy
 * counters are kept in step so a downgrade to v0.3.x still finds a sane streak.
 */
export function bumpStreak(localDay: string): StreakInfo {
  const info = getStreak()
  setSetting('streak_count', String(info.count))
  setSetting('streak_last_day', info.last_day ?? localDay)
  return info
}

/** A stored streak still counts if its last day is today or yesterday. */
function isLiveDay(day: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  return day === localDay(today) || day === localDay(yesterday)
}

/** Every local day with a review or a completed focus session, ascending. */
function studyDays(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT day FROM (
           SELECT date(reviewed_at, 'localtime') AS day FROM review_log
           UNION
           SELECT date(started_at, 'localtime') AS day FROM focus_sessions WHERE completed = 1 AND duration_minutes > 0
         ) ORDER BY day`
      )
      .all() as Array<{ day: string }>
  ).map((r) => r.day)
}

/* --------------------------------- Grades --------------------------------- */

export function listGrades(notebookId: number): Grade[] {
  return getDb().prepare(`SELECT * FROM grades WHERE notebook_id = ? ORDER BY id DESC`).all(notebookId) as Grade[]
}

export function listAllGrades(): Grade[] {
  return getDb().prepare(`SELECT * FROM grades ORDER BY notebook_id, id`).all() as Grade[]
}

export function createGrade(input: {
  notebook_id: number
  title: string
  score: number
  max: number
  weight: number
  system?: GradingSystem
}): Grade {
  const info = getDb()
    .prepare(`INSERT INTO grades (notebook_id, title, score, max, weight, system, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(input.notebook_id, input.title, input.score, input.max, input.weight, input.system ?? 'percent', now())
  return getDb().prepare(`SELECT * FROM grades WHERE id = ?`).get(info.lastInsertRowid) as Grade
}

export function updateGrade(id: number, patch: Record<string, unknown>): Grade {
  const allowed = ['title', 'score', 'max', 'weight'] as const
  const keys = allowed.filter((k) => k in patch)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE grades SET ${sets} WHERE id = @id`).run({ ...patch, id })
  }
  return getDb().prepare(`SELECT * FROM grades WHERE id = ?`).get(id) as Grade
}

export function removeGrade(id: number): void {
  getDb().prepare(`DELETE FROM grades WHERE id = ?`).run(id)
}

/* ---------------------------------- Stats --------------------------------- */

/**
 * Everything here buckets by *local* calendar day via SQLite's `localtime` modifier —
 * timestamps are stored as UTC ISO strings, but "did I study today" is a question about
 * the user's own calendar, and the main process runs in their timezone.
 */

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** First local day of a window of `days` ending today (inclusive of both ends). */
function windowStart(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (Math.max(1, days) - 1))
  return localDay(d)
}

/**
 * Reviews and focus minutes per local day, for the activity heatmap. Only days with
 * something on them are returned; the renderer fills the calendar grid around them.
 */
export function activity(days = 182): ActivityDay[] {
  const from = windowStart(days)
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(reviews) AS reviews, SUM(focus_minutes) AS focus_minutes FROM (
         SELECT date(reviewed_at, 'localtime') AS day, COUNT(*) AS reviews, 0 AS focus_minutes
           FROM review_log
          WHERE date(reviewed_at, 'localtime') >= ?
          GROUP BY day
         UNION ALL
         SELECT date(started_at, 'localtime') AS day, 0 AS reviews, COALESCE(SUM(duration_minutes), 0) AS focus_minutes
           FROM focus_sessions
          WHERE completed = 1 AND date(started_at, 'localtime') >= ?
          GROUP BY day
       )
       GROUP BY day ORDER BY day`
    )
    .all(from, from) as ActivityDay[]
  return rows
}

/** Cards coming due over the next `days` local days, so "what's ahead" isn't a surprise. */
export function forecast(days = 14): ForecastDay[] {
  const rows = getDb()
    .prepare(
      `SELECT date(next_review_date, 'localtime') AS day, COUNT(*) AS due
         FROM flashcards
        WHERE next_review_date IS NOT NULL
        GROUP BY day ORDER BY day`
    )
    .all() as ForecastDay[]

  // Anything already overdue is work for today, not for the day it was scheduled.
  const today = localDay(new Date())
  const horizon = new Date()
  horizon.setDate(horizon.getDate() + Math.max(1, days) - 1)
  const last = localDay(horizon)

  const byDay = new Map<string, number>()
  for (const r of rows) {
    const day = r.day <= today ? today : r.day
    if (day > last) continue
    byDay.set(day, (byDay.get(day) ?? 0) + r.due)
  }

  const out: ForecastDay[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  for (let i = 0; i < Math.max(1, days); i++) {
    const key = localDay(cursor)
    out.push({ day: key, due: byDay.get(key) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * Current and longest run of consecutive local days with any activity. Derived from the
 * review/focus history rather than the two counters in `settings`, so it stays true even
 * if the app never ran on a day you studied — and it can look backwards, which counters
 * can't.
 */
function streaksFrom(activeDays: string[]): { current: number; longest: number } {
  if (activeDays.length === 0) return { current: 0, longest: 0 }
  const set = new Set(activeDays)
  let longest = 0
  for (const day of set) {
    const prev = new Date(`${day}T12:00:00`)
    prev.setDate(prev.getDate() - 1)
    if (set.has(localDay(prev))) continue // not the start of a run
    let run = 0
    const cursor = new Date(`${day}T12:00:00`)
    while (set.has(localDay(cursor))) {
      run++
      cursor.setDate(cursor.getDate() + 1)
    }
    if (run > longest) longest = run
  }

  // A run only counts as *current* if it reaches today or yesterday — one missed day
  // shouldn't zero the number before the user has had a chance to study.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let anchor: Date | null = null
  if (set.has(localDay(today))) anchor = today
  else {
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (set.has(localDay(yesterday))) anchor = yesterday
  }
  let current = 0
  if (anchor) {
    const cursor = new Date(anchor)
    while (set.has(localDay(cursor))) {
      current++
      cursor.setDate(cursor.getDate() - 1)
    }
  }
  return { current, longest }
}

export function statsOverview(windowDays = 30): StatsOverview {
  const db = getDb()
  const from = windowStart(windowDays)

  const reviews = (db.prepare(`SELECT COUNT(*) AS n FROM review_log WHERE date(reviewed_at, 'localtime') >= ?`).get(from) as { n: number }).n
  const reviewsAllTime = (db.prepare(`SELECT COUNT(*) AS n FROM review_log`).get() as { n: number }).n

  // True retention: only cards that were already in review state were actually being
  // *recalled*. A new card's first answer and relearning steps aren't memory tests.
  const ret = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN rating > 1 THEN 1 ELSE 0 END) AS passed
         FROM review_log WHERE state = 'review' AND date(reviewed_at, 'localtime') >= ?`
    )
    .get(from) as { total: number; passed: number | null }

  const focus = (
    db
      .prepare(
        `SELECT COALESCE(SUM(duration_minutes), 0) AS m FROM focus_sessions
          WHERE completed = 1 AND date(started_at, 'localtime') >= ?`
      )
      .get(from) as { m: number }
  ).m

  const allActive = studyDays()
  const { current, longest } = streaksFrom(allActive)

  const cards = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) AS n_new,
              SUM(CASE WHEN state IN ('learning','relearning') THEN 1 ELSE 0 END) AS n_learning,
              SUM(CASE WHEN state = 'review' THEN 1 ELSE 0 END) AS n_review,
              AVG(stability) AS mean_stability,
              SUM(CASE WHEN next_review_date <= ? THEN 1 ELSE 0 END) AS due_now
         FROM flashcards`
    )
    .get(now()) as {
    total: number
    n_new: number | null
    n_learning: number | null
    n_review: number | null
    mean_stability: number | null
    due_now: number | null
  }

  return {
    window_days: windowDays,
    reviews,
    reviews_all_time: reviewsAllTime,
    retention: ret.total > 0 ? (ret.passed ?? 0) / ret.total : null,
    focus_minutes: focus,
    current_streak: current,
    longest_streak: longest,
    active_days: allActive.filter((d) => d >= from).length,
    cards_total: cards.total,
    cards_new: cards.n_new ?? 0,
    cards_learning: cards.n_learning ?? 0,
    cards_review: cards.n_review ?? 0,
    mean_stability: cards.mean_stability,
    due_now: cards.due_now ?? 0
  }
}

export function ratingBreakdown(windowDays = 30): RatingBreakdown {
  const row = getDb()
    .prepare(
      `SELECT SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS again,
              SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS hard,
              SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS good,
              SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS easy
         FROM review_log WHERE date(reviewed_at, 'localtime') >= ?`
    )
    .get(windowStart(windowDays)) as Record<keyof RatingBreakdown, number | null>
  return { again: row.again ?? 0, hard: row.hard ?? 0, good: row.good ?? 0, easy: row.easy ?? 0 }
}

/** Per-notebook study snapshot. Rows with no activity at all are left out. */
export function subjectStats(windowDays = 30): SubjectStat[] {
  const db = getDb()
  const from = windowStart(windowDays)
  const nowIso = now()

  const rows = db
    .prepare(
      `SELECT d.notebook_id AS notebook_id,
              COUNT(r.id) AS reviews,
              SUM(CASE WHEN r.state = 'review' THEN 1 ELSE 0 END) AS recall_total,
              SUM(CASE WHEN r.state = 'review' AND r.rating > 1 THEN 1 ELSE 0 END) AS recall_passed
         FROM review_log r
         JOIN flashcard_decks d ON d.id = r.deck_id
        WHERE date(r.reviewed_at, 'localtime') >= ?
        GROUP BY d.notebook_id`
    )
    .all(from) as Array<{ notebook_id: number; reviews: number; recall_total: number | null; recall_passed: number | null }>

  const focusRows = db
    .prepare(
      `SELECT d.notebook_id AS notebook_id, COALESCE(SUM(f.duration_minutes), 0) AS minutes
         FROM focus_sessions f
         JOIN flashcard_decks d ON d.id = f.deck_id
        WHERE f.completed = 1 AND date(f.started_at, 'localtime') >= ?
        GROUP BY d.notebook_id
        UNION ALL
       SELECT t.notebook_id AS notebook_id, COALESCE(SUM(f.duration_minutes), 0) AS minutes
         FROM focus_sessions f
         JOIN tasks t ON t.id = f.task_id
        WHERE f.completed = 1 AND date(f.started_at, 'localtime') >= ?
        GROUP BY t.notebook_id`
    )
    .all(from, from) as Array<{ notebook_id: number; minutes: number }>

  const dueRows = db
    .prepare(
      `SELECT d.notebook_id AS notebook_id, COUNT(*) AS due
         FROM flashcards c JOIN flashcard_decks d ON d.id = c.deck_id
        WHERE c.next_review_date <= ?
        GROUP BY d.notebook_id`
    )
    .all(nowIso) as Array<{ notebook_id: number; due: number }>

  const byId = new Map<number, SubjectStat>()
  const get = (id: number): SubjectStat => {
    let s = byId.get(id)
    if (!s) {
      s = { notebook_id: id, reviews: 0, retention: null, focus_minutes: 0, cards_due: 0 }
      byId.set(id, s)
    }
    return s
  }
  for (const r of rows) {
    const s = get(r.notebook_id)
    s.reviews = r.reviews
    s.retention = (r.recall_total ?? 0) > 0 ? (r.recall_passed ?? 0) / (r.recall_total as number) : null
  }
  for (const f of focusRows) get(f.notebook_id).focus_minutes += f.minutes
  for (const d of dueRows) get(d.notebook_id).cards_due = d.due
  return [...byId.values()].sort((a, b) => b.reviews - a.reviews)
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
    createNotebook({ name: 'Assignments', color: 'coral', icon: 'pen-tool', kind: 'school_subject' })
    createNotebook({ name: 'Class Notes', color: 'amber', icon: 'book-open', kind: 'school_subject' })
    createNotebook({ name: 'Study Decks', color: 'pink', icon: 'brain', kind: 'school_subject' })
  } else if (payload.purpose === 'work') {
    createNotebook({ name: 'Projects', color: 'coral', icon: 'briefcase' })
    createNotebook({ name: 'Meetings', color: 'amber', icon: 'coffee' })
  }
  if (payload.journal) {
    createNotebook({ name: 'Journal', color: 'gray', is_journal: true })
  }
  setSetting('onboarding_done', '1')
  setSetting('purpose', payload.purpose)
}
