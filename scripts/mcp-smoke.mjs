/**
 * MCP check: starts the built app with --mcp against a throwaway profile and talks to it over
 * stdio the way an assistant does. No window is ever opened.
 *
 *   bun run build && bun run mcp:smoke
 *
 * Exits non-zero if any check fails.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
if (!existsSync(join(electronDir, 'path.txt'))) {
  console.error('the electron binary is missing. run: node node_modules/electron/install.js')
  process.exit(1)
}
const electron = join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())
const profile = mkdtempSync(join(tmpdir(), 'inkling-mcp-smoke-'))
const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined, INKLING_USERDATA: profile }
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : []

const results = []
const ok = (name, cond, detail) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ` (${detail})` : ''))

/** One MCP session over the child's stdin and stdout. */
function session() {
  const child = spawn(electron, [root, '--mcp', ...sandbox], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending = new Map()
  const stray = []
  let buf = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
      if (!line.trim()) {
        stray.push(line)
        continue
      }
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        stray.push(line)
        continue
      }
      const waiter = pending.get(msg.id)
      if (waiter) {
        pending.delete(msg.id)
        waiter(msg)
      }
    }
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  const exited = new Promise((res) => child.on('exit', (code) => res(code)))
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n')
  const request = (method, params) =>
    new Promise((res, rej) => {
      const id = nextId++
      const timer = setTimeout(() => rej(new Error(`${method} timed out. stderr: ${stderr.slice(-500)}`)), 30_000)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        res(msg)
      })
      send({ jsonrpc: '2.0', id, method, params })
    })
  const call = async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result
  const close = async () => {
    child.stdin.end()
    const timeout = new Promise((res) => setTimeout(() => res('timeout'), 10_000))
    const code = await Promise.race([exited, timeout])
    if (code === 'timeout') child.kill()
    return code
  }
  const start = async () => {
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'inkling-mcp-smoke', version: '1' }
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    return init
  }
  return { start, request, call, close, stray, stderr: () => stderr }
}

try {
  // Before Inkling has ever run on this profile there is no data, and the server says so.
  const empty = session()
  await empty.start()
  const refused = await empty.call('list_notes')
  ok('without data the tools ask to open Inkling first', refused.isError === true && /Open Inkling once/.test(refused.content[0].text))
  ok('the server makes no database of its own', !existsSync(join(profile, 'inkling.db')))
  ok('closing stdin ends the server', (await empty.close()) === 0)

  // The app sets the profile up the way a first start does, without a window.
  const setup = spawnSync(electron, [root, ...sandbox], { env: { ...env, INKLING_NO_WINDOW: '1' }, stdio: 'ignore', timeout: 60_000 })
  ok('the app sets up a fresh profile', setup.status === 0 && existsSync(join(profile, 'inkling.db')), `exit ${setup.status}`)

  const s = session()
  const init = await s.start()
  ok('initialize names the server', init.result?.serverInfo?.name === 'inkling', init.result?.serverInfo?.name)
  const tools = (await s.request('tools/list', {})).result.tools.map((t) => t.name).sort()
  const want = ['add_flashcards', 'append_to_note', 'complete_todo', 'create_note', 'list_decks', 'list_notes', 'list_open_todos', 'read_note', 'reopen_todo', 'search']
  ok('tools/list has every tool', JSON.stringify(tools) === JSON.stringify(want), tools.join(','))

  const created = await s.call('create_note', {
    title: 'Smoke plan',
    markdown: '## Steps\n\nBuy **agar** for the lab\n\n- [ ] Book the microscope\n- [x] Read chapter 3\n'
  })
  const note = created.structuredContent
  ok('create_note makes the note and its to-dos', !created.isError && note.id > 0 && note.todosCreated === 2, JSON.stringify(note))

  const read = (await s.call('read_note', { id: note.id })).structuredContent
  ok('read_note gives the Markdown back', read.markdown.includes('## Steps') && read.markdown.includes('**agar**') && read.markdown.includes('- [ ] Book the microscope'), JSON.stringify(read.markdown))

  const todos = (await s.call('list_open_todos')).structuredContent.todos
  const todo = todos.find((t) => t.text === 'Book the microscope')
  ok('the new checkbox is an open to-do of that note', !!todo && todo.noteId === note.id && !todos.some((t) => t.text === 'Read chapter 3'))

  const done = (await s.call('complete_todo', { id: todo.id })).structuredContent
  const after = (await s.call('read_note', { id: note.id })).structuredContent.markdown
  ok('complete_todo ticks the box in the note', done.done === true && after.includes('- [x] Book the microscope'))

  const appended = (await s.call('append_to_note', { id: note.id, markdown: '- [ ] Write it up' })).structuredContent
  const grown = (await s.call('read_note', { id: note.id })).structuredContent.markdown
  ok('append_to_note adds to the end and keeps the rest', appended.todosCreated === 1 && grown.includes('Buy **agar**') && grown.trimEnd().endsWith('- [ ] Write it up'))

  const hits = (await s.call('search', { query: 'microscope' })).structuredContent.results
  ok('search finds the note and the to-do', hits.some((h) => h.type === 'note' && h.id === note.id) && hits.some((h) => h.type === 'todo' && h.noteId === note.id))

  const cards = (await s.call('add_flashcards', { deckName: 'Smoke deck', cards: [{ front: 'Agar', back: 'A jelly to grow cultures on' }, { front: 'The {{c1::nucleus}} holds the {{c2::DNA}}' }] })).structuredContent
  const decks = (await s.call('list_decks')).structuredContent.decks
  const deck = decks.find((d) => d.id === cards.deckId)
  ok('add_flashcards makes a deck with due cards', cards.added === 3 && !!deck && deck.cards === 3 && deck.due === 3, JSON.stringify(cards))

  const missing = await s.call('read_note', { id: 999999 })
  ok('a missing note is a tool error', missing.isError === true && /no note with id 999999/.test(missing.content[0].text))

  const resource = (await s.request('resources/read', { uri: `inkling://note/${note.id}` })).result
  ok('the note reads as a resource', resource?.contents?.[0]?.mimeType === 'text/markdown' && resource.contents[0].text.includes('Write it up'))

  // Electron itself can print an empty line on Windows before any script runs; clients skip it.
  const stray = s.stray.filter((l) => l.trim())
  const blank = s.stray.length - stray.length
  ok('stdout carries only JSON-RPC', stray.length === 0, stray.length > 0 ? stray.slice(0, 2).join(' | ') : `${blank} empty line(s)`)
  ok('the server exits when the client closes', (await s.close()) === 0)
} catch (e) {
  results.push('FAIL threw: ' + (e && e.message ? e.message : String(e)))
}

rmSync(profile, { recursive: true, force: true })
console.log(results.join('\n'))
const failed = results.filter((l) => l.startsWith('FAIL'))
if (failed.length > 0) {
  console.error(`${failed.length} of ${results.length} MCP checks failed`)
  process.exit(1)
}
console.log(`all ${results.length} MCP checks passed`)
