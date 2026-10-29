import { describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'

let raw: DatabaseSync
let db: Database.Database

vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }))

const { migrate } = await import('../src/main/db')
const tools = await import('../src/main/mcp/tools')

type Node = { type: string; content?: Array<Node | null>; marks?: Array<object | null>; text?: string }

const NOTE = '## Key **terms** here\n\nCell :: The **smallest** unit\n\nAgar :: A jelly\n\n## Notes\n\nSmall print'
const HEADING = 'Key terms here'

const stored = (noteId: number): Node =>
  JSON.parse((raw.prepare(`SELECT content FROM notes WHERE id = ?`).get(noteId) as { content: string }).content)

const firstOf = (doc: Node, type: string): Node => doc.content!.find((b) => b?.type === type)!

// The list a null goes into: the doc's blocks, a node's children or a word's marks.
const places = {
  block: (doc: Node) => doc.content!,
  'child in a paragraph': (doc: Node) => firstOf(doc, 'paragraph').content!,
  'child in a heading': (doc: Node) => firstOf(doc, 'heading').content!,
  'mark on a bold word': (doc: Node) => firstOf(doc, 'paragraph').content!.find((c) => c?.marks)!.marks!
}

const spots = {
  start: () => 0,
  middle: (n: number) => Math.floor(n / 2),
  end: (n: number) => n
}

const calls = {
  read_note: (id: number) => tools.readNote({ id }),
  'read_note with a heading': (id: number) => tools.readNote({ id, heading: HEADING }),
  append_to_note: (id: number) => tools.appendToNote({ id, markdown: 'Gel :: Soft' }),
  replace_section: (id: number) => tools.replaceNoteSection({ id, heading: HEADING, markdown: 'Cell :: The smallest unit\n\nGel :: Soft' }),
  edit_note: (id: number) => tools.editNote({ id, oldText: 'smallest', newText: 'basic' }),
  make_flashcards_from_note: (id: number) => tools.makeFlashcardsFromNote({ id })
}

// One tool call on a fresh database, with the stored note damaged first when asked.
function run(call: (id: number) => object, damage?: (doc: Node) => void): { out: object; doc: Node } {
  ;({ raw, db } = openSqlite())
  migrate(db)
  tools.forgetEdits()
  const note = tools.createNote({ title: 'Bio', markdown: NOTE })
  if (damage) {
    const doc = stored(note.id)
    damage(doc)
    raw.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(JSON.stringify(doc), note.id)
  }
  const { updatedAt: _, ...out } = call(note.id) as { updatedAt?: string }
  return { out, doc: stored(note.id) }
}

describe('a stored note with a null in it', () => {
  const cases = Object.keys(calls).flatMap((tool) =>
    Object.keys(places).flatMap((place) => Object.keys(spots).map((spot) => [tool, place, spot] as const))
  )

  it.each(cases)('%s with a null %s at the %s', (tool, place, spot) => {
    const call = calls[tool as keyof typeof calls]
    const clean = run(call)
    const damaged = run(call, (doc) => {
      const list: unknown[] = places[place as keyof typeof places](doc)
      list.splice(spots[spot as keyof typeof spots](list.length), 0, null)
    })
    expect(damaged.out).toEqual(clean.out)
    // A write saves every real block as the same call on the undamaged note does.
    if (tool !== 'read_note' && tool !== 'read_note with a heading') expect(damaged.doc).toEqual(clean.doc)
  })
})
