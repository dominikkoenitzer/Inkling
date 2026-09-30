import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import type { AnkiRows } from '@shared/ankiMap'

/**
 * Reads the collection out of an Anki package (.apkg for decks, .colpkg for a whole
 * collection). Both are zip files. Only the collection entry is decompressed; media is
 * skipped as it streams past.
 *
 * Newest first: `collection.anki21b` (schema 18, zstd-compressed), `collection.anki21`
 * (schema 11 with the v2 scheduler), `collection.anki2` (schema 11). A modern export
 * ships a placeholder `collection.anki2` next to the real `.anki21b`, holding one card that
 * says to update Anki, so the older name is only read when nothing newer is there.
 */
export const COLLECTION_ENTRIES = ['collection.anki21b', 'collection.anki21', 'collection.anki2'] as const
export type CollectionEntry = (typeof COLLECTION_ENTRIES)[number]

/** The part of a read-only SQLite handle the reader uses: better-sqlite3 and node:sqlite both fit. */
export interface ReadOnlyDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
  close(): void
}
export type Opener = (file: string) => ReadOnlyDb

const openReadOnly: Opener = (file) => new Database(file, { readonly: true, fileMustExist: true })

/** Streams the zip and returns the newest collection entry in it, decompressed from the zip. */
export async function extractCollection(zipPath: string): Promise<{ name: CollectionEntry; data: Uint8Array }> {
  const found = new Map<CollectionEntry, Uint8Array>()
  const pending = new Map<CollectionEntry, Uint8Array[]>()
  let failure: Error | null = null

  const unzip = new Unzip((file) => {
    const name = COLLECTION_ENTRIES.find((n) => n === file.name)
    if (!name) return
    pending.set(name, [])
    file.ondata = (err, chunk, final) => {
      if (err) {
        failure = err
        return
      }
      pending.get(name)!.push(chunk)
      if (final) {
        found.set(name, concat(pending.get(name)!))
        pending.delete(name)
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)

  const stream = fs.createReadStream(zipPath, { highWaterMark: 1 << 20 })
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      unzip.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      if (failure) throw failure
      // Nothing newer can follow the newest layout; the rest is media.
      if (found.has(COLLECTION_ENTRIES[0])) break
    }
    if (!found.has(COLLECTION_ENTRIES[0])) unzip.push(new Uint8Array(0), true)
  } catch (err) {
    throw new Error(`This file could not be read as an Anki package (${(err as Error).message}).`, { cause: err })
  } finally {
    stream.destroy()
  }
  if (failure) throw new Error(`This file could not be read as an Anki package (${(failure as Error).message}).`)

  for (const name of COLLECTION_ENTRIES) {
    const data = found.get(name)
    if (data) return { name, data: name === 'collection.anki21b' ? zstd(data) : data }
  }
  throw new Error('This file has no Anki collection in it.')
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** zstd came to Node's zlib in 22.15 and 23.8. */
function zstd(data: Uint8Array): Uint8Array {
  const decompress = (zlib as { zstdDecompressSync?: (buf: Uint8Array) => Buffer }).zstdDecompressSync
  if (typeof decompress !== 'function') {
    throw new Error(
      `This Anki file is compressed with zstd, which this build (Node ${process.versions.node}) cannot read. ` +
        'Export it again in Anki with "Support older Anki versions" ticked.'
    )
  }
  return new Uint8Array(decompress(data))
}

/**
 * Opens a collection's bytes read-only through a temp file and reads the raw rows. No
 * ORDER BY and no comparison touches a name column: schema 18 declares those with Anki's
 * `unicase` collation, which plain SQLite does not have. Sorting happens in the mapper.
 */
export function readCollection(data: Uint8Array, open: Opener = openReadOnly): AnkiRows {
  const file = path.join(os.tmpdir(), `inkling-import-${randomUUID()}.db`)
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  // A copy saved in WAL mode would need -wal/-shm files to open; the copy holds every page
  // already, so its header is set back to the rollback journal (file format 1).
  if (bytes.length >= 20 && bytes[18] === 2 && bytes[19] === 2) {
    bytes[18] = 1
    bytes[19] = 1
  }
  let db: ReadOnlyDb | null = null
  try {
    fs.writeFileSync(file, bytes)
    db = open(file)
    const d = db
    const tables = new Set((d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((t) => t.name))
    for (const t of ['col', 'notes', 'cards', 'revlog']) {
      if (!tables.has(t)) throw new Error(`This Anki collection has no ${t} table.`)
    }
    const all = <T>(sql: string): T[] => d.prepare(sql).all() as T[]
    const col = all<AnkiRows['col']>(`SELECT crt, models, decks FROM col LIMIT 1`)[0]
    if (!col) throw new Error('This Anki collection is empty.')
    const modern = tables.has('notetypes')
    return {
      col,
      notetypes: modern ? all(`SELECT id, name, config FROM notetypes`) : [],
      fields: modern && tables.has('fields') ? all(`SELECT ntid, ord, name FROM fields`) : [],
      templates: modern && tables.has('templates') ? all(`SELECT ntid, ord, config FROM templates`) : [],
      decks: tables.has('decks') ? all(`SELECT id, name FROM decks`) : [],
      notes: all(`SELECT id, guid, mid, flds FROM notes`),
      cards: all(`SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odid, odue, data FROM cards`),
      revlog: all(`SELECT id, cid, ease, ivl, type FROM revlog`)
    }
  } finally {
    db?.close()
    for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) fs.rmSync(f, { force: true })
  }
}

/** Reads an .apkg or .colpkg into the rows `planImport` maps. */
export async function readAnkiPackage(zipPath: string, open: Opener = openReadOnly): Promise<AnkiRows> {
  const { data } = await extractCollection(zipPath)
  return readCollection(data, open)
}
