import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { openSqlite } from './sqlite'

// The app and the MCP server as two connections to one database file, the way they run.
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

const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i

let dir: string
let app: DatabaseSync
let mcp: DatabaseSync
let client: Client
let probes = 0

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'inkling-mcp-'))
  const file = join(dir, 'inkling.db')
  const opened = openSqlite(file)
  opened.raw.exec('PRAGMA journal_mode = WAL')
  migrate(opened.db)
  app = opened.raw
  const served = openSqlite(file)
  mcp = served.raw
  // The copy the server makes before its first write.
  opening.db = Object.assign(served.db, { backup: (to: string) => backup(mcp, to) })
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

const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`)
  return r.structuredContent as Record<string, unknown>
}

const noteId = async (markdown: string): Promise<number> => (await call('create_note', { title: 'Lab', markdown })).id as number
const todoId = async (): Promise<number> => {
  await noteId('- [ ] Buy agar')
  return ((await call('list_open_todos')).todos as Array<{ id: number }>)[0].id
}
const cardId = async (): Promise<number> => {
  await call('add_flashcards', { deckName: 'Bio', cards: [{ front: 'Cell', back: 'A unit' }] })
  return ((await call('list_due_flashcards')).cards as Array<{ id: number }>)[0].id
}

/** Every tool that writes, with what it needs made first. */
const WRITES: Record<string, () => Promise<Record<string, unknown>>> = {
  create_note: async () => ({ title: 'Lab', markdown: '- [ ] Buy agar' }),
  append_to_note: async () => ({ id: await noteId('Intro'), markdown: '- [ ] Call back' }),
  replace_section: async () => ({ id: await noteId('# Plan\n\nOld line'), heading: 'Plan', markdown: 'New line' }),
  edit_note: async () => ({ id: await noteId('Old line'), oldText: 'Old', newText: 'New' }),
  undo_edit: async () => {
    const id = await noteId('Old line')
    await call('edit_note', { id, oldText: 'Old', newText: 'New' })
    return { id }
  },
  rename_note: async () => ({ id: await noteId('Intro'), title: 'Renamed' }),
  delete_note: async () => ({ id: await noteId('Intro') }),
  restore_note: async () => {
    const id = await noteId('Intro')
    await call('delete_note', { id })
    return { id }
  },
  complete_todo: async () => ({ id: await todoId() }),
  reopen_todo: async () => {
    const id = await todoId()
    await call('complete_todo', { id })
    return { id }
  },
  grade_flashcard: async () => ({ id: await cardId(), grade: 'good' }),
  add_flashcards: async () => ({ deckName: 'Bio', cards: [{ front: 'Cell', back: 'A unit' }] }),
  make_flashcards_from_note: async () => ({ id: await noteId('Cell :: A unit') })
}

/** One write by the app, in its own transaction, as the app's own saves are. */
const appWrites = (): void => {
  app.prepare(`INSERT INTO settings (key, value) VALUES ('probe', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(++probes))
}
const probe = (): unknown => (app.prepare(`SELECT value FROM settings WHERE key = 'probe'`).get() as { value: string } | undefined)?.value

/**
 * Calls a tool and has the app write the moment the tool prepares its first write inside its
 * transaction: after its reads, the point where a deferred transaction can no longer get the lock.
 */
async function callWhileAppWrites(name: string, args: Record<string, unknown>): Promise<{ result: CallToolResult; reached: boolean; appWrote: boolean }> {
  const prepare = mcp.prepare.bind(mcp)
  let reached = false
  let appWrote = false
  mcp.prepare = ((sql: string) => {
    if (!reached && mcp.isTransaction && WRITE.test(sql)) {
      reached = true
      try {
        appWrites()
        appWrote = true
      } catch (err) {
        // The tool holds the lock, so the app waits for it; here it only tries once.
        if (!/locked|busy/i.test(String(err))) throw err
      }
    }
    return prepare(sql)
  }) as typeof mcp.prepare
  try {
    return { result: (await client.callTool({ name, arguments: args })) as CallToolResult, reached, appWrote }
  } finally {
    mcp.prepare = prepare
  }
}

describe('an assistant write while the app writes', () => {
  it('covers every tool that writes', async () => {
    const { tools } = await client.listTools()
    expect(tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name).sort()).toEqual(Object.keys(WRITES).sort())
  })

  it.each(Object.keys(WRITES))('%s holds the write lock before its first read', async (name) => {
    const args = await WRITES[name]()
    const before = probe()

    const { result, reached, appWrote } = await callWhileAppWrites(name, args)

    expect(reached).toBe(true)
    expect(result.isError ? result.content : null).toBeNull()
    expect(appWrote).toBe(false)
    expect(probe()).toBe(before)
    // The app's write that waited lands once the call is done.
    appWrites()
    expect(probe()).toBe(String(probes))
  })
})

describe('an assistant read', () => {
  it('writes nothing, so it never needs the write lock', async () => {
    const id = await noteId('# Plan\n\n- [ ] Buy agar\n\nCell :: A unit')
    await call('make_flashcards_from_note', { id })
    const reads: Record<string, Record<string, unknown>> = {
      search: { query: 'agar' },
      list_notes: { changedSince: '2000-01-01' },
      read_note: { id, heading: 'Plan' },
      today: {},
      list_open_todos: {},
      list_decks: {},
      list_due_flashcards: {}
    }
    const { tools } = await client.listTools()
    expect(tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort()).toEqual(Object.keys(reads).sort())

    const prepare = mcp.prepare.bind(mcp)
    const exec = mcp.exec.bind(mcp)
    const written: string[] = []
    mcp.prepare = ((sql: string) => {
      if (WRITE.test(sql)) written.push(sql)
      return prepare(sql)
    }) as typeof mcp.prepare
    mcp.exec = ((sql: string) => {
      if (WRITE.test(sql)) written.push(sql)
      return exec(sql)
    }) as typeof mcp.exec
    try {
      for (const [name, args] of Object.entries(reads)) await call(name, args)
      await client.listResources()
      await client.readResource({ uri: `inkling://note/${id}` })
      await client.readResource({ uri: 'inkling://today' })
    } finally {
      mcp.prepare = prepare
      mcp.exec = exec
    }

    expect(written).toEqual([])
  })
})
