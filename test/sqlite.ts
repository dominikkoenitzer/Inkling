import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'

/**
 * better-sqlite3 is rebuilt for Electron on install, so it cannot load under Node here.
 * Node's own SQLite speaks the same prepare/run/get/all dialect; this adds the two
 * better-sqlite3 helpers the main process also uses, `pragma` and `transaction`.
 */
export function openSqlite(): { raw: DatabaseSync; db: Database.Database } {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = Object.assign(raw, {
    pragma: (src: string, opts?: { simple?: boolean }) => {
      if (src.includes('=')) return void raw.exec(`PRAGMA ${src}`)
      const row = raw.prepare(`PRAGMA ${src}`).get() as Record<string, unknown>
      return opts?.simple ? Object.values(row)[0] : row
    },
    transaction: (fn: () => void) => () => {
      raw.exec('BEGIN')
      try {
        fn()
        raw.exec('COMMIT')
      } catch (err) {
        raw.exec('ROLLBACK')
        throw err
      }
    }
  })
  return { raw, db: db as unknown as Database.Database }
}
