import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { strToU8, zipSync } from 'fflate'
import { BASIC, CLOZE, collectionBytes, type Collection } from './anki-fixture'
import { planImport } from '../src/shared/ankiMap'

vi.mock('better-sqlite3', () => ({ default: class {} }))

const { extractCollection, readAnkiPackage, readCollection } = await import('../src/main/import/anki')

/** better-sqlite3 is built for Electron; the tests read through Node's own SQLite. */
const open = (file: string): DatabaseSync => new DatabaseSync(file, { readOnly: true })

const COLLECTION: Collection = {
  schema: 11,
  noteTypes: [BASIC, CLOZE],
  decks: [
    { id: 1, name: 'Default' },
    { id: 20, name: 'Spanish::Verbs' }
  ],
  notes: [
    { id: 10, guid: 'g1', mid: BASIC.id, fields: ['hablar', 'to speak'] },
    { id: 11, guid: 'g2', mid: CLOZE.id, fields: ['{{c1::Yo}} hablo', ''] }
  ],
  cards: [
    { id: 100, nid: 10, did: 20, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, factor: 0, reps: 0, lapses: 0, odid: 0, odue: 0, data: '' },
    { id: 101, nid: 11, did: 20, ord: 0, type: 0, queue: 0, due: 2, ivl: 0, factor: 0, reps: 0, lapses: 0, odid: 0, odue: 0, data: '' }
  ],
  revlog: []
}

let seq = 0
function writeZip(entries: Record<string, Uint8Array>, store = false): string {
  const file = path.join(os.tmpdir(), `inkling96c-pkg-${process.pid}-${seq++}.apkg`)
  const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, [v, { level: store ? 0 : 6 }]])))
  fs.writeFileSync(file, zip)
  return file
}

const importTemps = (): string[] => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('inkling-import-'))

const fronts = async (file: string): Promise<string[]> =>
  planImport(await readAnkiPackage(file, open), new Date()).cards.map((c) => c.front)

describe('reading an Anki package', () => {
  it('reads a legacy export, collection.anki21 before collection.anki2', async () => {
    const file = writeZip({
      'collection.anki2': collectionBytes(COLLECTION, { dummy: true }),
      'collection.anki21': collectionBytes(COLLECTION),
      media: strToU8('{}')
    })
    expect(await fronts(file)).toEqual(['hablar', '{{c1::Yo}} hablo'])
    fs.rmSync(file)
  })

  it('reads the zstd collection.anki21b of a modern export and never the placeholder anki2', async () => {
    const modern = collectionBytes({ ...COLLECTION, schema: 18 })
    const file = writeZip(
      {
        'collection.anki2': collectionBytes(COLLECTION, { dummy: true }),
        'collection.anki21b': new Uint8Array(zlib.zstdCompressSync(modern)),
        media: new Uint8Array(zlib.zstdCompressSync(Buffer.alloc(0))),
        '0': new Uint8Array(4096)
      },
      true
    )
    const rows = await readAnkiPackage(file, open)
    expect(rows.notetypes).toHaveLength(2)
    expect(rows.decks.map((d) => d.name)).toContain(`Spanish${String.fromCharCode(0x1f)}Verbs`)
    const plan = planImport(rows, new Date())
    expect(plan.cards.map((c) => c.front)).toEqual(['hablar', '{{c1::Yo}} hablo'])
    expect(plan.decks.map((d) => d.name)).toEqual(['Spanish::Verbs'])
    fs.rmSync(file)
  })

  it('reads a placeholder-only package as the placeholder it is', async () => {
    const file = writeZip({ 'collection.anki2': collectionBytes(COLLECTION, { dummy: true }) })
    expect((await extractCollection(file)).name).toBe('collection.anki2')
    expect((await fronts(file))[0]).toMatch(/^Please update to the latest Anki version/)
    fs.rmSync(file)
  })

  it('says so when the zip has no collection, or is no zip', async () => {
    const empty = writeZip({ media: strToU8('{}') })
    await expect(readAnkiPackage(empty, open)).rejects.toThrow('no Anki collection')
    const junk = path.join(os.tmpdir(), `inkling96c-junk-${process.pid}.apkg`)
    fs.writeFileSync(junk, 'not a zip at all')
    await expect(readAnkiPackage(junk, open)).rejects.toThrow()
    fs.rmSync(empty)
    fs.rmSync(junk)
  })

  it('deletes its temp copy, also when reading fails', () => {
    const before = importTemps()
    readCollection(collectionBytes(COLLECTION), open)
    expect(() => readCollection(new TextEncoder().encode('not sqlite'), open)).toThrow()
    expect(importTemps()).toEqual(before)
  })
})
