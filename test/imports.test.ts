import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import { BASIC, CLOZE, card, rev, toRows, type Collection } from './anki-fixture'
import { planImport, type ImportPlan } from '../src/shared/ankiMap'

let raw: DatabaseSync
let db: Database.Database

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }))

const { migrate } = await import('../src/main/db')
const { writeImport } = await import('../src/main/repos/imports')
const { reviewHistories } = await import('../src/main/repos/scheduler')
const { dueCards, listDecks } = await import('../src/main/repos/flashcards')
const { searchQuery } = await import('../src/main/repos/search')

const NOW = new Date('2026-09-30T08:00:00.000Z')
const DAY = 86_400_000
const T0 = Date.UTC(2026, 2, 1, 9)

beforeEach(() => {
  ;({ raw, db } = openSqlite())
  migrate(db)
  raw.exec(`INSERT INTO notebooks (id, name, color) VALUES (1, 'Languages', 'teal')`)
})

const COLLECTION: Collection = {
  schema: 18,
  noteTypes: [BASIC, CLOZE],
  decks: [
    { id: 1, name: 'Default' },
    { id: 20, name: 'Spanish::Verbs' }
  ],
  notes: [
    { id: 10, guid: 'g1', mid: BASIC.id, fields: ['hablar', 'to speak'] },
    { id: 11, guid: 'g2', mid: CLOZE.id, fields: ['{{c1::Yo}} {{c2::hablo}}', ''] },
    { id: 12, guid: 'g3', mid: BASIC.id, fields: ['comer', 'to eat'] }
  ],
  cards: [
    card({ id: 100, nid: 10, did: 20, type: 2, queue: 2, due: 300, ivl: 9, factor: 2500, reps: 4 }),
    card({ id: 101, nid: 11, did: 20 }),
    card({ id: 102, nid: 11, did: 20, ord: 1 }),
    card({ id: 103, nid: 12, did: 1, type: 2, queue: 2, due: 200, ivl: 4, factor: 2500, reps: 3 })
  ],
  revlog: [
    rev(100, T0, 3, 0, -600),
    rev(100, T0 + 600_000, 3, 0, 1),
    rev(100, T0 + DAY, 3, 1, 3),
    rev(100, T0 + 4 * DAY, 3, 1, 9),
    // Card 103's history starts mid-way: kept for stats, left out of the optimiser.
    rev(103, T0 + 2 * DAY, 3, 1, 4)
  ]
}

const plan = (c: Collection = COLLECTION): ImportPlan => planImport(toRows(c), NOW)
const count = (table: string): number => (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('writeImport', () => {
  it('writes decks, cards and review history, with a searchable deck', () => {
    const summary = writeImport(1, plan())
    expect(summary).toMatchObject({
      decks: 2,
      cards: 4,
      reviews: 5,
      skipped: { media: 0, suspended: 0, imageOcclusion: 0, duplicates: 0, unusable: 0 }
    })
    const decks = listDecks(1)
    expect(decks.map((d) => [d.name, d.card_count])).toEqual([
      ['Default', 1],
      ['Spanish::Verbs', 3]
    ])
    expect(summary.deckId).toBe(decks[0].id)
    expect(searchQuery('verbs').map((r) => r.title)).toContain('Spanish::Verbs')

    const cards = raw.prepare(`SELECT * FROM flashcards ORDER BY id`).all() as Array<Record<string, unknown>>
    // Cards already studied first, then new ones in Anki's queue order.
    expect(cards.map((c) => c.external_id)).toEqual(['anki:g1:0', 'anki:g3:0', 'anki:g2:0', 'anki:g2:1'])
    expect(cards.map((c) => c.cloze)).toEqual([0, 0, 1, 2])
    expect(cards[0]).toMatchObject({ state: 'review', interval_days: 9, repetitions: 4, ease_factor: 2.5 })
    // New cards are due now, so they show up for study straight away.
    expect(dueCards(decks[1].id).map((c) => c.cloze)).toEqual([1, 2])
  })

  it('logs a complete history so the optimiser can use it, and leaves partial ones out', () => {
    writeImport(1, plan())
    const ids = raw.prepare(`SELECT id, external_id FROM flashcards`).all() as Array<{ id: number; external_id: string }>
    const id = (ext: string): number => ids.find((r) => r.external_id === ext)!.id
    const log = raw.prepare(`SELECT state FROM review_log WHERE card_id = ? ORDER BY reviewed_at`).all(id('anki:g1:0'))
    expect(log.map((r) => (r as { state: string }).state)).toEqual(['new', 'learning', 'review', 'review'])
    const histories = reviewHistories()
    expect(histories.get(id('anki:g1:0'))).toHaveLength(4)
    expect(histories.has(id('anki:g3:0'))).toBe(false)
  })

  it('skips what an earlier import brought in, reviews included', () => {
    writeImport(1, plan())
    const again = writeImport(1, plan())
    expect(again).toMatchObject({ decks: 0, cards: 0, reviews: 0, deckId: null })
    expect(again.skipped.duplicates).toBe(4)
    expect(count('flashcards')).toBe(4)
    expect(count('review_log')).toBe(5)

    // A newer export of the same deck adds only its new card, to the deck made before.
    const grown = {
      ...COLLECTION,
      notes: [...COLLECTION.notes, { id: 13, guid: 'g4', mid: BASIC.id, fields: ['vivir', 'to live'] }],
      cards: [...COLLECTION.cards, card({ id: 104, nid: 13, did: 20 })]
    }
    const third = writeImport(1, plan(grown))
    expect(third).toMatchObject({ decks: 0, cards: 1, skipped: { duplicates: 4 } })
    expect(listDecks(1)).toHaveLength(2)
    expect(third.deckId).toBe(listDecks(1)[1].id)
  })

  it('writes nothing at all when a card fails half-way', () => {
    const broken = plan()
    broken.cards[2] = { ...broken.cards[2], front: null as unknown as string }
    expect(() => writeImport(1, broken)).toThrow()
    expect(count('flashcard_decks')).toBe(0)
    expect(count('flashcards')).toBe(0)
    expect(count('review_log')).toBe(0)
    expect(count('search_index')).toBe(0)
  })
})
