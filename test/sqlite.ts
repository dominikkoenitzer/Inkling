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
  let depth = 0
  const db = Object.assign(raw, {
    pragma: (src: string, opts?: { simple?: boolean }) => {
      if (src.includes('=')) return void raw.exec(`PRAGMA ${src}`)
      const row = raw.prepare(`PRAGMA ${src}`).get() as Record<string, unknown>
      return opts?.simple ? Object.values(row)[0] : row
    },
    // Like better-sqlite3: passes arguments and the result through, nests as savepoints, and
    // has the `.immediate()` variant.
    transaction: (fn: (...args: unknown[]) => unknown) => {
      const run = (begin: string) => (...args: unknown[]) => {
        const sp = `sp${depth}`
        raw.exec(depth === 0 ? begin : `SAVEPOINT ${sp}`)
        depth++
        try {
          const result = fn(...args)
          depth--
          raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
          return result
        } catch (err) {
          depth--
          raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
          throw err
        }
      }
      return Object.assign(run('BEGIN'), { immediate: run('BEGIN IMMEDIATE') })
    }
  })
  return { raw, db: db as unknown as Database.Database }
}
