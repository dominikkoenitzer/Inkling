import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openSqlite } from './sqlite'

// The MCP server opens the app's database next to it; here against Node's own SQLite.
const opened = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('better-sqlite3', () => ({
  default: function () {
    return opened.db
  }
}))

const { attachDb, checkVersion, getDb, migrate } = await import('../src/main/db')

/** A database at the version this build expects, then moved by `delta`. */
function atVersion(delta: number): { db: Database.Database; version: () => number } {
  const { db } = openSqlite()
  migrate(db)
  const current = db.pragma('user_version', { simple: true }) as number
  db.pragma(`user_version = ${current + delta}`)
  return { db, version: () => db.pragma('user_version', { simple: true }) as number }
}

describe('checkVersion', () => {
  it('passes the version this build knows', () => {
    expect(() => checkVersion(atVersion(0).db)).not.toThrow()
  })

  it('asks to open Inkling when the data is older', () => {
    expect(() => checkVersion(atVersion(-1).db)).toThrow(/update its data first. Open Inkling once/)
  })

  it('asks to update Inkling when the data is newer', () => {
    expect(() => checkVersion(atVersion(1).db)).toThrow(/newer than this copy of Inkling/)
  })
})

describe('attachDb', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'inkling-attach-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    opened.db = null
  })

  it('never makes a database of its own', () => {
    expect(() => attachDb(dir)).toThrow(/no data on this computer yet/)
    expect(fs.existsSync(join(dir, 'inkling.db'))).toBe(false)
  })

  it('refuses data of another version without migrating it', () => {
    fs.writeFileSync(join(dir, 'inkling.db'), '')
    const older = atVersion(-1)
    opened.db = older.db
    const before = older.version()
    const close = vi.spyOn(older.db, 'close').mockImplementation(() => older.db)
    expect(() => attachDb(dir)).toThrow(/Open Inkling once/)
    expect(close).toHaveBeenCalled()
    expect(older.version()).toBe(before)
  })

  it('opens data of the current version', () => {
    fs.writeFileSync(join(dir, 'inkling.db'), '')
    const current = atVersion(0)
    opened.db = current.db
    expect(attachDb(dir)).toBe(current.db)
    expect(getDb()).toBe(current.db)
  })
})
