/**
 * Backup copies are numbered, never named after the time they were made. Copies from older
 * versions carry a time in their name and count as older than every numbered one.
 */

import { spawn } from 'child_process'
import fs from 'fs'
import { join } from 'path'
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

// Reads the paths from the environment, so no path is ever part of the command text.
const SET_CREATED =
  '$t = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$env:INKLING_STAMP_TIME).UtcDateTime; ' +
  'foreach ($p in ($env:INKLING_STAMP_PATHS -split "`n")) { try { ' +
  'if ([IO.Directory]::Exists($p)) { [IO.Directory]::SetCreationTimeUtc($p, $t) } ' +
  'elseif ([IO.File]::Exists($p)) { [IO.File]::SetCreationTimeUtc($p, $t) } } catch {} }'

const powershell = (): string =>
  join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * Windows also keeps when a file was created, and Node cannot set it, so one hidden PowerShell
 * sets it for all the paths. The backup never waits on it, and a failure leaves the time as it was.
 */
function setCreated(day: Date, paths: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SET_CREATED], {
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, INKLING_STAMP_TIME: String(day.getTime()), INKLING_STAMP_PATHS: paths.join('\n') }
      })
      const timer = setTimeout(() => child.kill(), 17_000)
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      child.once('error', (err) => {
        console.error('setting the creation day on a backup failed', err)
        done()
      })
      child.once('close', done)
    } catch (err) {
      console.error('setting the creation day on a backup failed', err)
      resolve()
    }
  })
}

/**
 * Sets the times of each path to the start of today, so a copy and its folder show the day
 * they were made and no clock time. A path that cannot be stamped keeps its time. The access
 * and change times are set at once; the creation time on Windows follows in the background.
 */
export function stampDayOnly(...paths: string[]): Promise<void> {
  const day = startOfDay()
  for (const path of paths) {
    try {
      fs.utimesSync(path, day, day)
    } catch (err) {
      console.error('setting the day on a backup failed', err)
    }
  }
  return process.platform === 'win32' && paths.length > 0 ? setCreated(day, paths) : Promise.resolve()
}
