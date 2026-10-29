import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { openSqlite } from './sqlite'

const opening = vi.hoisted(() => ({ db: {} as object }))
// `new Database(file)` in attachDb hands back the MCP server's connection.
vi.mock('better-sqlite3', () => ({
  default: class {
    constructor() {
      return opening.db
    }
  }
}))

const { migrate } = await import('../src/main/db')
const { createServer } = await import('../src/main/mcp/server')

let dir: string
let app: DatabaseSync
let mcp: DatabaseSync
let client: Client
/** Every copy the server asked for, and whether the next one fails halfway. */
let copies: string[]
let failNext: boolean

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'inkling-mcpbackup-'))
  const file = join(dir, 'inkling.db')
  const opened = openSqlite(file)
  opened.raw.exec('PRAGMA journal_mode = WAL')
  migrate(opened.db)
  app = opened.raw
  const served = openSqlite(file)
  mcp = served.raw
  copies = []
  failNext = false
  opening.db = Object.assign(served.db, {
    backup: async (to: string) => {
      copies.push(to)
      // Slow enough that a second call arrives while the copy is still being written.
      writeFileSync(to, 'half a copy')
      await new Promise((resolve) => setTimeout(resolve, 20))
      if (failNext) {
        failNext = false
        throw new Error('disk full')
      }
      rmSync(to)
      await backup(mcp, to)
    }
  })
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createServer(dir, '0.0.0').connect(serverSide)
  client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
})

afterEach(async () => {
  await client.close()
  mcp.close()
  app.close()
  rmSync(dir, { recursive: true, force: true })
})

const createNote = async (title: string): Promise<CallToolResult> =>
  (await client.callTool({ name: 'create_note', arguments: { title, markdown: 'Intro' } })) as CallToolResult
const backups = (): string[] => readdirSync(join(dir, 'backups')).sort()
const notes = (): unknown[] => app.prepare(`SELECT title FROM notes ORDER BY title`).all()

describe('the copy before an assistant first writes', () => {
  it('is made once when two writes arrive together', async () => {
    const results = await Promise.all([createNote('Lab'), createNote('Exam')])

    expect(copies).toHaveLength(1)
    expect(results.map((r) => (r.isError ? r.content : null))).toEqual([null, null])
    expect(backups()).toEqual([expect.stringMatching(/^assistant-.*\.db$/)])
    expect(notes()).toEqual([{ title: 'Exam' }, { title: 'Lab' }])
  })

  it('never keeps a copy that failed halfway under a backup name, and is tried again', async () => {
    failNext = true

    const failed = await createNote('Lab')

    expect(failed.isError).toBe(true)
    expect(notes()).toEqual([])
    expect(backups()).toEqual([])

    const retried = await createNote('Lab')

    expect(retried.isError ?? false).toBe(false)
    expect(copies).toHaveLength(2)
    expect(backups()).toEqual([expect.stringMatching(/^assistant-.*\.db$/)])
    const copy = new DatabaseSync(join(dir, 'backups', backups()[0]))
    try {
      expect(copy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 14 })
    } finally {
      copy.close()
    }
  })

  const earlier = [1, 2, 3].map((day) => `assistant-2026-10-0${day}T08-00-00.db`)
  const made = expect.stringMatching(/^assistant-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/)

  it('keeps the newest three', async () => {
    mkdirSync(join(dir, 'backups'))
    for (const f of earlier) writeFileSync(join(dir, 'backups', f), 'earlier')

    const created = await createNote('Lab')

    expect(created.isError ?? false).toBe(false)
    expect(backups()).toEqual([...earlier.slice(1), made])
  })

  it('still writes when an old copy cannot be removed, and removes the others', async () => {
    mkdirSync(join(dir, 'backups'))
    for (const f of earlier) writeFileSync(join(dir, 'backups', f), 'earlier')
    // Sorts first and cannot be unlinked, like a copy open in another program.
    mkdirSync(join(dir, 'backups', 'assistant-0.db'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const created = await createNote('Lab')

      expect(created.isError ?? false).toBe(false)
      expect(notes()).toEqual([{ title: 'Lab' }])
      expect(backups()).toEqual(['assistant-0.db', ...earlier.slice(1), made])
      expect(quiet).toHaveBeenCalledWith('removing an old backup failed', expect.any(Error))
    } finally {
      quiet.mockRestore()
    }
  })
})
