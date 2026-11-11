import { describe, expect, it } from 'vitest'
import { backupsOldestFirst, nextBackupName } from '../src/main/backupNames'

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
