import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { backupsOldestFirst, nextBackupName, stampDayOnly } from '../src/main/backupNames'
import { startOfDay } from '../src/shared/day'

describe('backup names', () => {
  it('numbers copies without a time in the name', () => {
    expect(nextBackupName([], 'inkling')).toBe('inkling-1.db')
    expect(nextBackupName(['inkling-2026-10-01T08-00-00.db'], 'inkling')).toBe('inkling-1.db')
    expect(nextBackupName(['inkling-9.db', 'inkling-3.db', 'assistant-40.db'], 'inkling')).toBe('inkling-10.db')
  })

  it('counts copies with a time in the name as older than every numbered one', () => {
    const names = ['inkling-10.db', 'inkling-2026-10-02T08-00-00.db', 'inkling-9.db', 'inkling-2026-10-01T08-00-00.db']
    expect(backupsOldestFirst(names, 'inkling')).toEqual([
      'inkling-2026-10-01T08-00-00.db',
      'inkling-2026-10-02T08-00-00.db',
      'inkling-9.db',
      'inkling-10.db'
    ])
  })

  it('leaves other files and half-made copies out', () => {
    const names = ['assistant-1.db', 'inkling.db', 'inkling-3.db.partial', 'inkling-2.db', 'notes.txt']
    expect(backupsOldestFirst(names, 'inkling')).toEqual(['inkling-2.db'])
    expect(nextBackupName(names, 'inkling')).toBe('inkling-3.db')
  })
})

describe('the day on a backup', () => {
  // Quotes, a dollar and an ampersand in the folder name would break a command the path was put into.
  it.runIf(process.platform === 'win32')(
    'sets the creation time of a copy and its folder to the start of the day',
    async () => {
      const dir = fs.mkdtempSync(join(os.tmpdir(), "inkling o'day $(1) & "))
      const copy = join(dir, 'inkling-1.db')
      fs.writeFileSync(copy, '')
      try {
        await stampDayOnly(copy, dir)
        const day = startOfDay().getTime()
        expect(fs.statSync(copy).birthtimeMs).toBe(day)
        expect(fs.statSync(dir).birthtimeMs).toBe(day)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
    17_000
  )

  it('leaves a path it cannot stamp without failing', async () => {
    const gone = join(os.tmpdir(), `inkling-gone-${process.pid}`, 'inkling-1.db')
    await expect(Promise.resolve(stampDayOnly(gone))).resolves.toBeUndefined()
  })
})
