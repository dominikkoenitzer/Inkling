/**
 * MCP check: starts the built app with --mcp against a throwaway profile and talks to it over
 * stdio the way an assistant does. No window is ever opened.
 *
 *   bun run build && bun run mcp:smoke
 *
 * MCP_SMOKE_EXE=<path to a packaged Inkling> checks that build's --mcp instead; the profile is
 * still set up by the unpackaged app.
 *
 * Exits non-zero if any check fails.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
  const packaged = process.env['MCP_SMOKE_EXE']
  const [cmd, args] = packaged ? [packaged, ['--mcp', ...sandbox]] : [electron, [root, '--mcp', ...sandbox]]
  const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
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
  const want = [
    'add_flashcards', 'append_to_note', 'complete_todo', 'create_note', 'delete_note', 'edit_note', 'grade_flashcard',
    'list_decks', 'list_due_flashcards', 'list_notes', 'list_open_todos', 'make_flashcards_from_note', 'read_note',
    'rename_note', 'reopen_todo', 'replace_section', 'restore_note', 'search', 'today', 'undo_edit'
  ]
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

  const backups = existsSync(join(profile, 'backups')) ? readdirSync(join(profile, 'backups')).filter((f) => f.startsWith('assistant-')) : []
  ok('the first write of a session backs the data up first', backups.length === 1, backups.join(','))

  // Sections, edits and undo.
  const plan = (await s.call('create_note', { title: 'Smoke week', markdown: '## Monday\n\nRead chapter 1\n- [ ] Buy agar\n\n## Tuesday\n\nLab day' })).structuredContent
  const monday = (await s.call('read_note', { id: plan.id, heading: 'Monday' })).structuredContent.markdown
  ok('read_note reads one section', monday.startsWith('## Monday') && !monday.includes('Tuesday'), JSON.stringify(monday))

  await s.call('append_to_note', { id: plan.id, heading: 'Monday', markdown: 'Write notes' })
  const replaced = (await s.call('replace_section', { id: plan.id, heading: 'Tuesday', markdown: 'Lab day, bring gloves' })).structuredContent
  const edited = (await s.call('edit_note', { id: plan.id, oldText: 'Read chapter 1', newText: 'Read chapter 2' })).structuredContent
  let week = (await s.call('read_note', { id: plan.id })).structuredContent.markdown
  ok(
    'append_to_note, replace_section and edit_note change only their part',
    week === '## Monday\n\nRead chapter 2\n\n- [ ] Buy agar\n\nWrite notes\n\n## Tuesday\n\nLab day, bring gloves\n' && replaced.previous === 'Lab day\n' && edited.replaced === 1,
    JSON.stringify(week)
  )
  const unclear = await s.call('edit_note', { id: plan.id, oldText: 'day', newText: 'night' })
  ok('edit_note refuses an unclear match', unclear.isError === true && /3 times/.test(unclear.content[0].text))

  for (let i = 0; i < 3; i++) await s.call('undo_edit', { id: plan.id })
  week = (await s.call('read_note', { id: plan.id })).structuredContent.markdown
  ok('undo_edit takes the edits back', week === '## Monday\n\nRead chapter 1\n\n- [ ] Buy agar\n\n## Tuesday\n\nLab day\n', JSON.stringify(week))

  const renamed = (await s.call('rename_note', { id: plan.id, title: 'Smoke week 2' })).structuredContent
  ok('rename_note renames', renamed.title === 'Smoke week 2' && renamed.previousTitle === 'Smoke week')

  const since = (await s.call('list_notes', { changedSince: new Date(Date.now() - 3600_000).toISOString() })).structuredContent.notes
  ok('list_notes shows recent changes', since[0]?.id === plan.id && since.some((n) => n.id === note.id), JSON.stringify(since.map((n) => n.id)))

  // The trash.
  const trashed = (await s.call('delete_note', { id: plan.id })).structuredContent
  const inTrash = (await s.call('list_notes', { inTrash: true })).structuredContent.notes
  const hidden = await s.call('read_note', { id: plan.id })
  ok('delete_note moves the note to the trash', trashed.inTrash === true && inTrash.some((n) => n.id === plan.id) && hidden.isError === true)
  const back = (await s.call('restore_note', { id: plan.id })).structuredContent
  ok('restore_note brings it back', back.id === plan.id && !(await s.call('read_note', { id: plan.id })).isError)

  // Today and flashcards.
  const today = (await s.call('today')).structuredContent
  ok('today lists open to-dos and cards due', today.todos.some((t) => t.text === 'Buy agar') && today.flashcardsDue === 3, JSON.stringify({ todos: today.openTodos, due: today.flashcardsDue }))

  const due = (await s.call('list_due_flashcards', { deckId: cards.deckId })).structuredContent
  const cloze = due.cards.find((c) => c.question.includes('[…]'))
  ok('list_due_flashcards asks cloze gaps', due.due === 3 && !!cloze && !cloze.answer.includes('{{'), JSON.stringify(due.cards.map((c) => c.question)))
  const graded = (await s.call('grade_flashcard', { id: due.cards[0].id, grade: 'good' })).structuredContent
  const left = (await s.call('list_decks')).structuredContent.decks.find((d) => d.id === cards.deckId)
  ok('grade_flashcard schedules the card', Date.parse(graded.nextReview) > Date.now() && left.due === 2)

  const bio = (await s.call('create_note', { title: 'Smoke bio', markdown: 'Cell :: The smallest unit of life\nThe {{c1::heart}} pumps blood' })).structuredContent
  const made = (await s.call('make_flashcards_from_note', { id: bio.id })).structuredContent
  const linked = (await s.call('list_decks')).structuredContent.decks.find((d) => d.id === made.deckId)
  ok('make_flashcards_from_note makes the note its deck', made.added === 2 && linked?.noteId === bio.id, JSON.stringify(made))

  // Prompts and the Today resource.
  const prompts = (await s.request('prompts/list', {})).result.prompts.map((p) => p.name).sort()
  ok('prompts/list has the prompts', JSON.stringify(prompts) === JSON.stringify(['flashcards_from_note', 'plan_my_day', 'quiz_me']), prompts.join(','))
  const quiz = (await s.request('prompts/get', { name: 'quiz_me', arguments: { deck: 'Smoke deck' } })).result
  ok('a prompt reads as a message', /list_due_flashcards/.test(quiz?.messages?.[0]?.content?.text ?? ''))
  const todayRes = (await s.request('resources/read', { uri: 'inkling://today' })).result
  ok('Today reads as a resource', JSON.parse(todayRes.contents[0].text).openTodos === today.openTodos)

  // Two assistants writing at once: each waits its turn and nothing is lost.
  const other = session()
  await other.start()
  const both = await Promise.all(
    Array.from({ length: 10 }, (_, i) => [
      s.call('append_to_note', { id: bio.id, markdown: `Line a${i}` }),
      other.call('append_to_note', { id: bio.id, markdown: `Line b${i}` })
    ]).flat()
  )
  const full = (await s.call('read_note', { id: bio.id })).structuredContent.markdown
  const lines = Array.from({ length: 10 }, (_, i) => [`Line a${i}`, `Line b${i}`]).flat()
  ok('two servers can write at the same time', both.every((r) => !r.isError) && lines.every((l) => full.includes(l)), both.find((r) => r.isError)?.content?.[0]?.text)
  await other.close()

  // The open app hears an assistant's write while it has no focus: it renders off screen and
  // can never take focus, so only the push from the main process can tell it.
  const watchJs = `(async function () {
    await new Promise((res) => { const tick = () => (window.inkling ? res() : setTimeout(tick, 50)); tick() })
    const heard = await new Promise((res) => {
      const off = window.inkling.events.onDataChanged(() => { off(); res(true) })
      setTimeout(() => res(false), 30000)
    })
    const notes = await window.inkling.notes.list()
    return (heard ? 'heard' : 'silent') + ':' + notes.some((n) => n.title === 'Written while open')
  })()`
  const watchResult = join(profile, 'watch.txt')
  const app = spawn(electron, [root, ...sandbox], {
    env: { ...env, INKLING_SCREENSHOT: join(profile, 'watch.png'), INKLING_EVAL: watchJs, INKLING_EVAL_RESULT: watchResult },
    stdio: 'ignore',
    windowsHide: true
  })
  let appRunning = true
  app.on('exit', () => (appRunning = false))
  const deadline = Date.now() + 60_000
  let wrote = false
  while (appRunning && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 1000))
    if (!wrote) await s.call('create_note', { title: 'Written while open' })
    else await s.call('append_to_note', { id: bio.id, markdown: 'ping' })
    wrote = true
  }
  if (appRunning) app.kill()
  const heard = existsSync(watchResult) ? readFileSync(watchResult, 'utf8') : ''
  ok('the open app hears an assistant write at once', heard === 'heard:true', heard || 'no result')

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
