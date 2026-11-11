/**
 * Backup copies are numbered, never named after the time they were made. Copies from older
 * versions carry a time in their name and count as older than every numbered one.
 */

import fs from 'fs'
import { startOfDay } from '@shared/day'

const numbered = (prefix: string, name: string): number | null => {
  const m = new RegExp(`^${prefix}-(\\d+)\\.db$`).exec(name)
  return m ? Number(m[1]) : null
}

/** The `<prefix>-*.db` copies in `names`, oldest first. */
export function backupsOldestFirst(names: string[], prefix: string): string[] {
  const copies = names.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.db'))
  const old = copies.filter((f) => numbered(prefix, f) === null).sort()
  const counted = copies.filter((f) => numbered(prefix, f) !== null).sort((a, b) => numbered(prefix, a)! - numbered(prefix, b)!)
  return [...old, ...counted]
}

/** The name for the next copy: one past the highest number in `names`. */
export function nextBackupName(names: string[], prefix: string): string {
  const top = Math.max(0, ...names.map((f) => numbered(prefix, f) ?? 0))
  return `${prefix}-${top + 1}.db`
}

/**
 * Sets the times of each path to the start of today, so a copy and its folder show the day
 * they were made and no clock time. A path that cannot be stamped keeps its time.
 */
export function stampDayOnly(...paths: string[]): void {
  const day = startOfDay()
  for (const path of paths) {
    try {
      fs.utimesSync(path, day, day)
    } catch (err) {
      console.error('setting the day on a backup failed', err)
    }
  }
}
