import { describe, expect, it } from 'vitest'
import { planImport, readProto, type AnkiRows } from '../src/shared/ankiMap'
import { DEFAULT_PARAMS, fromSm2 } from '../src/shared/fsrs'
import { replayMemoryState, toSequence } from '../src/shared/fsrs-optimise'
import { BASIC, CLOZE, CRT, OCCLUSION, REVERSED, TYPE_IN, card, rev, toRows, type Collection } from './anki-fixture'

const NOW = new Date('2026-09-30T08:00:00.000Z')
const DAY = 86_400_000
/** Revlog ids are milliseconds; the fixture's reviews start on 2026-03-01. */
const T0 = Date.UTC(2026, 2, 1, 9)

const base = (schema: 11 | 18, over: Partial<Collection> = {}): Collection => ({
  schema,
  noteTypes: [BASIC, REVERSED, TYPE_IN, CLOZE, OCCLUSION],
  decks: [
    { id: 1, name: 'Default' },
    { id: 20, name: 'Biology::Cells' },
    { id: 30, name: 'Cram' }
  ],
  notes: [],
  cards: [],
  revlog: [],
  ...over
})

const plan = (rows: AnkiRows): ReturnType<typeof planImport> => planImport(rows, NOW)

describe.each([11, 18] as const)('planImport, schema %i', (schema) => {
  it('maps a basic note and names the deck with ::', () => {
    const p = plan(
      toRows(
        base(schema, {
          notes: [{ id: 10, guid: 'g-basic', mid: BASIC.id, fields: ['<b>Osmosis</b>', 'water across<br>a membrane'] }],
          cards: [card({ id: 100, nid: 10, did: 20 })]
        })
      )
    )
    expect(p.decks).toEqual([{ id: 20, name: 'Biology::Cells' }])
    expect(p.cards).toHaveLength(1)
    expect(p.cards[0]).toMatchObject({
      externalId: 'anki:g-basic:0',
      deck: 20,
      front: 'Osmosis',
      back: 'water across\na membrane',
      cloze: 0,
      state: 'new',
      due: NOW.toISOString(),
      stability: null,
      difficulty: null,
      reviews: []
    })
  })

  it('swaps the sides of a reversed card and keeps the typed answer on the back', () => {
    const p = plan(
      toRows(
        base(schema, {
          notes: [
            { id: 10, guid: 'g-rev', mid: REVERSED.id, fields: ['Hund', 'dog'] },
            { id: 11, guid: 'g-type', mid: TYPE_IN.id, fields: ['Capital of Peru', 'Lima'] }
          ],
          cards: [card({ id: 100, nid: 10 }), card({ id: 101, nid: 10, ord: 1 }), card({ id: 102, nid: 11 })]
        })
      )
    )
    expect(p.cards.map((c) => [c.externalId, c.front, c.back])).toEqual([
      ['anki:g-rev:0', 'Hund', 'dog'],
      ['anki:g-rev:1', 'dog', 'Hund'],
      ['anki:g-type:0', 'Capital of Peru', 'Lima']
    ])
  })

  it('maps cloze cards to the text with its number and Back Extra on the back', () => {
    const p = plan(
      toRows(
        base(schema, {
          notes: [{ id: 10, guid: 'g-cloze', mid: CLOZE.id, fields: ['{{c1::Paris::city}} is in {{c2::France}}', 'Seine'] }],
          cards: [card({ id: 100, nid: 10 }), card({ id: 101, nid: 10, ord: 1 }), card({ id: 102, nid: 10, ord: 2 })]
        })
      )
    )
    expect(p.cards.map((c) => [c.front, c.back, c.cloze])).toEqual([
      ['{{c1::Paris::city}} is in {{c2::France}}', 'Seine', 1],
      ['{{c1::Paris::city}} is in {{c2::France}}', 'Seine', 2]
    ])
    // c3 no longer exists in the text: Anki would show an empty card.
    expect(p.skipped.unusable).toBe(1)
  })

  it('skips suspended and image occlusion cards and counts media once per note', () => {
    const p = plan(
      toRows(
        base(schema, {
          notes: [
            { id: 10, guid: 'g-media', mid: BASIC.id, fields: ['Heart <img src="heart.png">', '[sound:beat.mp3] pumps'] },
            { id: 11, guid: 'g-io', mid: OCCLUSION.id, fields: ['{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4}}', '<img src="x.png">', '', '', ''] },
            { id: 12, guid: 'g-susp', mid: BASIC.id, fields: ['a', 'b'] }
          ],
          cards: [card({ id: 100, nid: 10 }), card({ id: 101, nid: 11 }), card({ id: 102, nid: 12, queue: -1 }), card({ id: 103, nid: 99 })]
        })
      )
    )
    expect(p.cards.map((c) => [c.front, c.back])).toEqual([['Heart', 'pumps']])
    expect(p.skipped).toEqual({ media: 2, suspended: 1, imageOcclusion: 1, mediaOnly: 0, unusable: 1 })
  })

  it('counts a card whose question is only a picture apart from empty ones', () => {
    const p = plan(
      toRows(
        base(schema, {
          notes: [
            { id: 10, guid: 'sign', mid: BASIC.id, fields: ['<img src="stop.png">', 'Stop sign'] },
            { id: 11, guid: 'blank', mid: BASIC.id, fields: ['', 'nothing asked'] }
          ],
          cards: [card({ id: 100, nid: 10 }), card({ id: 101, nid: 11 })]
        })
      )
    )
    expect(p.cards).toHaveLength(0)
    expect(p.skipped).toMatchObject({ mediaOnly: 1, unusable: 1 })
  })

  it('keeps due dates: review days from crt, learning timestamps, filtered decks at home', () => {
    const learnAt = Math.floor(Date.UTC(2026, 8, 30, 9, 30) / 1000)
    const p = plan(
      toRows(
        base(schema, {
          notes: [
            { id: 10, guid: 'a', mid: BASIC.id, fields: ['a', '1'] },
            { id: 11, guid: 'b', mid: BASIC.id, fields: ['b', '2'] },
            { id: 12, guid: 'c', mid: BASIC.id, fields: ['c', '3'] },
            { id: 13, guid: 'd', mid: BASIC.id, fields: ['d', '4'] }
          ],
          cards: [
            card({ id: 100, nid: 10, type: 2, queue: 2, due: 280, ivl: 12, factor: 2300, reps: 6 }),
            card({ id: 101, nid: 11, type: 1, queue: 1, due: learnAt, factor: 0, reps: 1 }),
            card({ id: 102, nid: 12, type: 3, queue: 3, due: 272, ivl: 1, factor: 2100, reps: 9, lapses: 2 }),
            card({ id: 103, nid: 13, did: 30, odid: 20, type: 2, queue: 2, due: -100000, odue: 290, ivl: 30, factor: 2500, reps: 4 })
          ]
        })
      )
    )
    const byGuid = new Map(p.cards.map((c) => [c.externalId.split(':')[1], c]))
    expect(byGuid.get('a')).toMatchObject({
      state: 'review',
      due: new Date(CRT * 1000 + 280 * DAY).toISOString(),
      intervalDays: 12,
      repetitions: 6,
      easeFactor: 2.3,
      ...fromSm2(2.3, 12)
    })
    expect(byGuid.get('b')).toMatchObject({ state: 'learning', due: new Date(learnAt * 1000).toISOString(), intervalDays: 0 })
    expect(byGuid.get('c')).toMatchObject({ state: 'relearning', due: new Date(CRT * 1000 + 272 * DAY).toISOString(), intervalDays: 1 })
    expect(byGuid.get('d')).toMatchObject({ deck: 20, due: new Date(CRT * 1000 + 290 * DAY).toISOString() })
    expect(p.decks.map((d) => d.name)).toEqual(['Biology::Cells', 'Default'])
    // Without a review, the last one is the due date less the interval.
    expect(byGuid.get('a')!.lastReview).toBe(new Date(CRT * 1000 + 268 * DAY).toISOString())
  })

  it('reads an old-scheduler relearning card, due at a timestamp, without aborting', () => {
    const at = 1516980699
    const p = plan(
      toRows(
        base(schema, {
          notes: [{ id: 10, guid: 'a', mid: BASIC.id, fields: ['a', '1'] }],
          cards: [card({ id: 100, nid: 10, type: 2, queue: 1, due: at, ivl: 2, factor: 2500, reps: 5, lapses: 1 })]
        })
      )
    )
    expect(p.cards[0]).toMatchObject({ state: 'relearning', due: new Date(at * 1000).toISOString() })
  })

  it('takes the FSRS memory state Anki stored on the card', () => {
    const lrt = Math.floor(Date.UTC(2026, 8, 20, 12) / 1000)
    const p = plan(
      toRows(
        base(schema, {
          notes: [
            { id: 10, guid: 'a', mid: BASIC.id, fields: ['a', '1'] },
            { id: 11, guid: 'b', mid: BASIC.id, fields: ['b', '2'] }
          ],
          cards: [
            card({ id: 100, nid: 10, type: 2, queue: 2, due: 280, ivl: 12, factor: 2500, data: JSON.stringify({ s: 14.2051, d: 5.123, dr: 0.9, lrt }) }),
            card({ id: 101, nid: 11, type: 2, queue: 2, due: 280, ivl: 12, factor: 2500, data: JSON.stringify({ s: 3.5, d: 0.5 }) })
          ]
        })
      )
    )
    expect(p.cards[0]).toMatchObject({ stability: 14.2051, difficulty: 5.123, lastReview: new Date(lrt * 1000).toISOString() })
    // A 0-1 difficulty is scaled onto FSRS's 1-10.
    expect(p.cards[1]).toMatchObject({ stability: 3.5, difficulty: 5.5 })
  })

  it('replays a complete history the way the optimiser does and logs every answer', () => {
    const history = [
      rev(100, T0, 1, 0, -60),
      rev(100, T0 + 10 * 60_000, 3, 0, -600),
      rev(100, T0 + DAY, 3, 1, 3),
      rev(100, T0 + 4 * DAY, 1, 1, 8),
      rev(100, T0 + 4 * DAY + 600_000, 3, 2, 1),
      // A manual "set due date" row has no answer and is left out.
      rev(100, T0 + 5 * DAY, 0, 5, 5),
      rev(100, T0 + 6 * DAY, 4, 1, 20)
    ]
    const p = plan(
      toRows(
        base(schema, {
          notes: [{ id: 10, guid: 'a', mid: BASIC.id, fields: ['a', '1'] }],
          cards: [card({ id: 100, nid: 10, type: 2, queue: 2, due: 90, ivl: 20, factor: 2500, reps: 6, lapses: 1 })],
          revlog: [...history].reverse()
        })
      )
    )
    const answered = history.filter((r) => r.ease > 0)
    const expected = replayMemoryState(toSequence(answered.map((r) => ({ rating: r.ease as 1 | 2 | 3 | 4, at: r.id }))), DEFAULT_PARAMS)!
    const c = p.cards[0]
    expect(c.stability).toBeCloseTo(expected.stability, 10)
    expect(c.difficulty).toBeCloseTo(expected.difficulty, 10)
    expect(c.lastReview).toBe(new Date(T0 + 6 * DAY).toISOString())
    expect(c.reviews.map((r) => [r.rating, r.state])).toEqual([
      [1, 'new'],
      [3, 'learning'],
      [3, 'review'],
      [1, 'review'],
      [3, 'relearning'],
      [4, 'review']
    ])
    expect(c.reviews[5]).toMatchObject({ scheduledDays: 20, reviewedAt: new Date(T0 + 6 * DAY).toISOString() })
    expect(c.reviews[5].elapsedDays).toBeCloseTo((2 * DAY - 600_000) / DAY, 10)
    expect(c.reviews[0]).toMatchObject({ elapsedDays: 0, scheduledDays: 0 })
    expect(c.reviews[5].stability).toBeCloseTo(expected.stability, 10)
  })

  it('falls back to the SM-2 values when the history does not start at the first answer', () => {
    const p = plan(
      toRows(
        base(schema, {
          notes: [{ id: 10, guid: 'a', mid: BASIC.id, fields: ['a', '1'] }],
          cards: [card({ id: 100, nid: 10, type: 2, queue: 2, due: 90, ivl: 40, factor: 2200, reps: 9 })],
          revlog: [rev(100, T0, 3, 1, 15), rev(100, T0 + 15 * DAY, 3, 1, 40)]
        })
      )
    )
    expect(p.cards[0]).toMatchObject(fromSm2(2.2, 40))
    expect(p.cards[0].reviews.map((r) => r.state)).toEqual(['review', 'review'])
  })
})

describe('readProto', () => {
  it('reads varints, strings and skips fixed-width fields', () => {
    const msg = readProto(Uint8Array.from([0x08, 0x01, 0x11, 1, 2, 3, 4, 5, 6, 7, 8, 0x1a, 0x02, 0x68, 0x69, 0x25, 1, 2, 3, 4, 0x48, 0x96, 0x01]))
    expect(msg.get(1)).toEqual([1])
    expect(new TextDecoder().decode(msg.get(3)![0] as Uint8Array)).toBe('hi')
    expect(msg.get(9)).toEqual([150])
    expect(msg.has(2)).toBe(false)
  })
})
