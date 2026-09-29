import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'
import type { Card, NoteCardLine } from '../src/shared/types'
import { DEFAULT_PARAMS } from '../src/shared/fsrs'

let raw: DatabaseSync
let db: Database.Database

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }))

const { migrate } = await import('../src/main/db')
const { addCard, listCards, listDecks, reviewCard, syncNoteCards, updateCard } = await import('../src/main/repos/flashcards')

const NOTE = 7

beforeEach(() => {
  ;({ raw, db } = openSqlite())
  migrate(db) // the real schema, as a fresh install gets it
  raw.exec(`INSERT INTO notebooks (id, name, color) VALUES (1, 'Biology', 'teal')`)
  raw.exec(`INSERT INTO notes (id, notebook_id, title, content) VALUES (${NOTE}, 1, 'Cells', '{}')`)
})

const line = (front: string, back: string, lineId: number | null = null): NoteCardLine => ({ lineId, front, back })

/** Sync, then hand the stamped ids back the way the editor does. */
function sync(lines: NoteCardLine[]): { deckId: number; lines: NoteCardLine[]; cards: Card[] } {
  const res = syncNoteCards(NOTE, 1, 'Cells', lines)
  return {
    deckId: res.deck.id,
    lines: lines.map((l, i) => ({ ...l, lineId: res.lineIds[i] })),
    cards: listCards(res.deck.id)
  }
}

describe('syncNoteCards', () => {
  it('creates one deck linked to the note and never a second one', () => {
    const first = sync([line('Osmosis', 'water across a membrane'), line('Mitochondria', 'the powerhouse')])
    const again = sync(first.lines)
    expect(again.deckId).toBe(first.deckId)
    expect(listDecks()).toHaveLength(1)
    expect(listDecks()[0].note_id).toBe(NOTE)
    expect(again.cards.map((c) => c.id)).toEqual(first.cards.map((c) => c.id))
  })

  it('does not duplicate when the same lines come back without their ids', () => {
    const first = sync([line('Osmosis', 'water'), line('Mitochondria', 'powerhouse')])
    const again = sync([line('Osmosis', 'water'), line('Mitochondria', 'powerhouse')])
    expect(again.cards.map((c) => c.id)).toEqual(first.cards.map((c) => c.id))
  })

  it('rewords a card in place and keeps its scheduling and history', () => {
    const first = sync([line('Osmosis', 'water')])
    const reviewed = reviewCard(first.cards[0].id, 'good')

    const edited = first.lines.map((l) => ({ ...l, front: 'Osmosis (biology)', back: 'water across a membrane' }))
    const again = sync(edited)

    expect(again.cards).toHaveLength(1)
    expect(again.cards[0]).toMatchObject({
      id: reviewed.id,
      front: 'Osmosis (biology)',
      back: 'water across a membrane',
      stability: reviewed.stability,
      difficulty: reviewed.difficulty,
      state: reviewed.state,
      next_review_date: reviewed.next_review_date
    })
    expect(raw.prepare(`SELECT card_id FROM review_log`).all()).toEqual([{ card_id: reviewed.id }])
  })

  it('adds new lines and removes cards whose line is gone, keeping their review log', () => {
    const first = sync([line('Osmosis', 'water'), line('Mitochondria', 'powerhouse')])
    const gone = first.cards[1]
    reviewCard(gone.id, 'hard')

    const again = sync([first.lines[0], line('Ribosome', 'makes proteins')])

    expect(again.cards.map((c) => c.front)).toEqual(['Osmosis', 'Ribosome'])
    expect(again.cards[0].id).toBe(first.cards[0].id)
    expect(raw.prepare(`SELECT card_id, deck_id FROM review_log`).all()).toEqual([{ card_id: null, deck_id: again.deckId }])
  })

  it('keeps each card on its own line when lines are reordered', () => {
    const first = sync([line('A', '1'), line('B', '2')])
    const again = sync([first.lines[1], first.lines[0]])
    const byFront = new Map(again.cards.map((c) => [c.front, c.id]))
    expect(byFront.get('A')).toBe(first.cards[0].id)
    expect(byFront.get('B')).toBe(first.cards[1].id)
  })

  it('leaves cards added to the deck by hand alone', () => {
    const first = sync([line('Osmosis', 'water')])
    addCard(first.deckId, 'By hand', 'kept')
    const again = sync([])
    expect(again.cards.map((c) => c.front)).toEqual(['By hand'])
  })

  it('makes one card per cloze number and keeps them when the line is reworded', () => {
    const first = sync([line('The {{c1::mitochondria}} is the {{c2::powerhouse}}', '')])
    expect(first.cards.map((c) => c.cloze)).toEqual([1, 2])
    expect(new Set(first.cards.map((c) => c.source_line)).size).toBe(1)
    reviewCard(first.cards[1].id, 'easy')

    const again = sync([{ ...first.lines[0], front: 'The {{c1::mitochondrion}} is the cell’s {{c2::powerhouse}}' }])
    expect(again.cards.map((c) => [c.id, c.cloze])).toEqual(first.cards.map((c) => [c.id, c.cloze]))
    expect(again.cards[1].state).not.toBe('new')

    const fewer = sync([{ ...first.lines[0], front: 'The {{c1::mitochondrion}} makes energy' }])
    expect(fewer.cards.map((c) => [c.id, c.cloze])).toEqual([[first.cards[0].id, 1]])
  })

  it('makes a new deck when the linked one was deleted', () => {
    const first = sync([line('Osmosis', 'water')])
    raw.exec(`DELETE FROM flashcard_decks WHERE id = ${first.deckId}`)
    const again = sync(first.lines)
    expect(listDecks()).toMatchObject([{ id: again.deckId, note_id: NOTE, card_count: 1 }])
  })
})

describe('cloze cards from the card editor', () => {
  it('adds one card per cloze number', () => {
    const deckId = sync([]).deckId
    addCard(deckId, '{{c1::Bern}} is the capital of {{c2::Switzerland}}', '')
    expect(listCards(deckId).map((c) => c.cloze)).toEqual([1, 2])
  })

  it('edits the text of every sibling and adds or drops numbers', () => {
    const deckId = sync([]).deckId
    const first = addCard(deckId, '{{c1::Bern}} is in {{c2::Switzerland}}', '')
    updateCard(first.id, '{{c1::Bern}} is the capital of {{c3::Switzerland}}', '')
    const cards = listCards(deckId)
    expect(cards.map((c) => c.cloze)).toEqual([1, 3])
    expect(cards[0].id).toBe(first.id)
    expect(new Set(cards.map((c) => c.front)).size).toBe(1)
  })

  it('edits a plain card in place', () => {
    const deckId = sync([]).deckId
    const card = addCard(deckId, 'Front', 'Back')
    updateCard(card.id, 'Front 2', 'Back 2')
    expect(listCards(deckId)).toMatchObject([{ id: card.id, front: 'Front 2', back: 'Back 2', cloze: 0 }])
  })
})

describe('reviewCard settings', () => {
  const firstGood = (): Card => {
    const deckId = sync([line('Osmosis', 'water')]).deckId
    const card = addCard(deckId, `Card ${Math.random()}`, 'Back')
    return reviewCard(card.id, 'good')
  }

  it('schedules for the desired retention in the settings', () => {
    const standard = firstGood()
    raw.exec(`INSERT INTO settings (key, value) VALUES ('desired_retention', '0.8')`)
    const relaxed = firstGood()
    expect(relaxed.stability).toBe(standard.stability)
    expect(relaxed.interval_days).toBeGreaterThan(standard.interval_days)
  })

  it('uses fitted parameters from the settings, and the defaults when they are unusable', () => {
    const standard = firstGood()
    raw.exec(`INSERT INTO settings (key, value) VALUES ('fsrs_params', 'broken')`)
    expect(firstGood().stability).toBe(standard.stability)
    const w = [...DEFAULT_PARAMS]
    w[2] = 20 // first-review stability for Good
    raw.exec(`UPDATE settings SET value = '${JSON.stringify(w)}' WHERE key = 'fsrs_params'`)
    expect(firstGood().stability).toBe(20)
  })
})
