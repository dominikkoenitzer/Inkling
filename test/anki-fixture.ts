import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AnkiCardRow, AnkiRevlogRow, AnkiRows } from '../src/shared/ankiMap'

/**
 * Anki collections for the import tests, in either layout: schema 11 keeps note types and
 * decks as JSON in `col`, schema 18 in their own tables with protobuf configs.
 */

export const SEP = String.fromCharCode(0x1f)
/** Collection creation, 2026-01-01 04:00 UTC; day n is crt + n days. */
export const CRT = Date.UTC(2026, 0, 1, 4) / 1000

export interface NoteTypeSpec {
  id: number
  name: string
  cloze?: boolean
  stockKind?: number
  fields: string[]
  templates: Array<{ q: string; a: string }>
}

export const BASIC: NoteTypeSpec = {
  id: 1001,
  name: 'Basic',
  fields: ['Front', 'Back'],
  templates: [{ q: '{{Front}}', a: '{{FrontSide}}<hr id=answer>{{Back}}' }]
}
export const REVERSED: NoteTypeSpec = {
  id: 1002,
  name: 'Basic (and reversed card)',
  fields: ['Front', 'Back'],
  templates: [
    { q: '{{Front}}', a: '{{FrontSide}}<hr id=answer>{{Back}}' },
    { q: '{{Back}}', a: '{{FrontSide}}<hr id=answer>{{Front}}' }
  ]
}
export const TYPE_IN: NoteTypeSpec = {
  id: 1003,
  name: 'Basic (type in the answer)',
  fields: ['Front', 'Back'],
  templates: [{ q: '{{Front}}\n\n{{type:Back}}', a: '{{Front}}<hr id=answer>{{type:Back}}' }]
}
export const CLOZE: NoteTypeSpec = {
  id: 1004,
  name: 'Cloze',
  cloze: true,
  fields: ['Text', 'Back Extra'],
  templates: [{ q: '{{cloze:Text}}', a: '{{cloze:Text}}<br>\n{{Back Extra}}' }]
}
export const OCCLUSION: NoteTypeSpec = {
  id: 1005,
  name: 'Image Occlusion',
  cloze: true,
  stockKind: 6,
  fields: ['Occlusion', 'Image', 'Header', 'Back Extra', 'Comments'],
  templates: [{ q: '{{cloze:Occlusion}}', a: '{{cloze:Occlusion}}' }]
}

export interface Collection {
  schema: 11 | 18
  noteTypes: NoteTypeSpec[]
  decks: Array<{ id: number; name: string }>
  notes: Array<{ id: number; guid: string; mid: number; fields: string[] }>
  cards: AnkiCardRow[]
  revlog: AnkiRevlogRow[]
}

export const card = (over: Partial<AnkiCardRow> & Pick<AnkiCardRow, 'id' | 'nid'>): AnkiCardRow => ({
  did: 1,
  ord: 0,
  type: 0,
  queue: 0,
  due: 0,
  ivl: 0,
  factor: 0,
  reps: 0,
  lapses: 0,
  odid: 0,
  odue: 0,
  data: '',
  ...over
})

export const rev = (cid: number, at: number, ease: number, type: number, ivl = 0): AnkiRevlogRow => ({ id: at, cid, ease, ivl, type })

/* ---------------------------- A tiny protobuf writer ---------------------------- */

const varint = (n: number): number[] => {
  const out: number[] = []
  while (n >= 128) {
    out.push((n % 128) | 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
const pbVarint = (field: number, v: number): number[] => (v ? [...varint(field * 8), ...varint(v)] : [])
const pbString = (field: number, s: string): number[] => {
  const b = new TextEncoder().encode(s)
  return [...varint(field * 8 + 2), ...varint(b.length), ...b]
}

/** Notetype.Config: kind 1, sort_field_idx 2, css 3, original_stock_kind 9. */
const notetypeConfig = (nt: NoteTypeSpec): Uint8Array =>
  Uint8Array.from([...pbVarint(1, nt.cloze ? 1 : 0), ...pbString(3, '.card {}'), ...pbVarint(9, nt.stockKind ?? 0)])
/** Template.Config: q_format 1, a_format 2. */
const templateConfig = (t: { q: string; a: string }): Uint8Array => Uint8Array.from([...pbString(1, t.q), ...pbString(2, t.a), ...pbVarint(7, 12)])

/** The rows the reader would get from this collection. */
export function toRows(c: Collection): AnkiRows {
  const models = Object.fromEntries(
    c.noteTypes.map((nt) => [
      String(nt.id),
      {
        id: nt.id,
        name: nt.name,
        type: nt.cloze ? 1 : 0,
        ...(nt.stockKind ? { originalStockKind: nt.stockKind } : {}),
        flds: nt.fields.map((name, ord) => ({ name, ord })),
        tmpls: nt.templates.map((t, ord) => ({ name: `Card ${ord + 1}`, ord, qfmt: t.q, afmt: t.a }))
      }
    ])
  )
  const decks = Object.fromEntries(c.decks.map((d) => [String(d.id), { id: d.id, name: d.name, dyn: 0 }]))
  const legacy = c.schema === 11
  return {
    col: { crt: CRT, models: legacy ? JSON.stringify(models) : '', decks: legacy ? JSON.stringify(decks) : '' },
    notetypes: legacy ? [] : c.noteTypes.map((nt) => ({ id: nt.id, name: nt.name, config: notetypeConfig(nt) })),
    fields: legacy ? [] : c.noteTypes.flatMap((nt) => nt.fields.map((name, ord) => ({ ntid: nt.id, ord, name }))),
    templates: legacy ? [] : c.noteTypes.flatMap((nt) => nt.templates.map((t, ord) => ({ ntid: nt.id, ord, config: templateConfig(t) }))),
    decks: legacy ? [] : c.decks.map((d) => ({ id: d.id, name: d.name.split('::').join(SEP) })),
    notes: c.notes.map((n) => ({ id: n.id, guid: n.guid, mid: n.mid, flds: n.fields.join(SEP) })),
    cards: c.cards,
    revlog: c.revlog
  }
}

/* ------------------------------ The SQLite file ------------------------------ */

const SCHEMA_11 = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
`

/** Schema 18 declares its names with Anki's own `unicase` collation; added after the fact below. */
const SCHEMA_18 = `
CREATE TABLE notetypes (id integer NOT NULL PRIMARY KEY, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL);
CREATE UNIQUE INDEX idx_notetypes_name ON notetypes (name);
CREATE TABLE fields (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) without rowid;
CREATE TABLE templates (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL,
  config blob NOT NULL, PRIMARY KEY (ntid, ord)) without rowid;
CREATE TABLE decks (id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, common blob NOT NULL, kind blob NOT NULL);
CREATE UNIQUE INDEX idx_decks_name ON decks (name);
`

let counter = 0

/** Writes the collection to an SQLite file and returns its bytes. */
export function collectionBytes(c: Collection, opts: { dummy?: boolean } = {}): Uint8Array {
  const file = path.join(os.tmpdir(), `inkling96c-fixture-${process.pid}-${counter++}.db`)
  const db = new DatabaseSync(file)
  try {
    const rows = toRows(c)
    db.exec(SCHEMA_11)
    if (c.schema === 18) db.exec(SCHEMA_18)
    db.prepare(`INSERT INTO col VALUES (1, ?, 0, 0, ?, 0, 0, 0, '{}', ?, ?, '{}', '{}')`).run(rows.col.crt, c.schema, rows.col.models, rows.col.decks)
    if (opts.dummy) {
      // What a modern export puts in collection.anki2 for Anki versions too old to read it.
      db.prepare(`INSERT INTO notes VALUES (1, 'dummy', ?, 0, 0, '', ?, 0, 0, 0, '')`).run(
        BASIC.id,
        `Please update to the latest Anki version, then import the .colpkg/.apkg file again.${SEP}`
      )
      db.prepare(`INSERT INTO cards VALUES (1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, '')`).run()
      return finish()
    }
    for (const nt of rows.notetypes) db.prepare(`INSERT INTO notetypes VALUES (?, ?, 0, 0, ?)`).run(nt.id, nt.name, nt.config)
    for (const f of rows.fields) db.prepare(`INSERT INTO fields VALUES (?, ?, ?, ?)`).run(f.ntid, f.ord, f.name, new Uint8Array())
    for (const t of rows.templates) db.prepare(`INSERT INTO templates VALUES (?, ?, 'Card', 0, 0, ?)`).run(t.ntid, t.ord, t.config)
    for (const d of rows.decks) db.prepare(`INSERT INTO decks VALUES (?, ?, 0, 0, ?, ?)`).run(d.id, d.name, new Uint8Array(), new Uint8Array())
    for (const n of rows.notes) db.prepare(`INSERT INTO notes VALUES (?, ?, ?, 0, 0, '', ?, 0, 0, 0, '')`).run(n.id, n.guid, n.mid, n.flds)
    for (const k of rows.cards) {
      db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`).run(
        k.id, k.nid, k.did, k.ord, k.type, k.queue, k.due, k.ivl, k.factor, k.reps, k.lapses, k.odue, k.odid, k.data
      )
    }
    for (const r of rows.revlog) db.prepare(`INSERT INTO revlog VALUES (?, ?, 0, ?, ?, 0, 0, 1000, ?)`).run(r.id, r.cid, r.ease, r.ivl, r.type)
    if (c.schema === 18) {
      // Declare the names as Anki does. Plain SQLite has no `unicase`; the reader must
      // never need it.
      db.exec('PRAGMA writable_schema = ON')
      db.exec(`UPDATE sqlite_master SET sql = replace(sql, 'name text NOT NULL', 'name text NOT NULL COLLATE unicase')
                WHERE type = 'table' AND tbl_name IN ('notetypes', 'decks')`)
      db.exec('PRAGMA writable_schema = OFF')
    }
    return finish()
  } catch (err) {
    db.close()
    fs.rmSync(file, { force: true })
    throw err
  }

  function finish(): Uint8Array {
    db.close()
    const bytes = new Uint8Array(fs.readFileSync(file))
    fs.rmSync(file, { force: true })
    return bytes
  }
}
