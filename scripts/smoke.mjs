/**
 * End-to-end smoke test: launches the built app against a throwaway profile and drives the
 * real preload bridge, so every check goes through IPC and the SQLite repositories exactly
 * the way the UI does. Unit tests cover the pure logic in src/shared; this covers the wiring
 * between the three processes, which is where a fresh install actually breaks.
 *
 *   bun run build && bun run smoke
 *
 * Exits non-zero if any check fails, so CI can gate on it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// electron/path.txt names the binary for this platform: electron.exe, electron, or the path
// inside Electron.app. It only exists once electron's postinstall has fetched the binary,
// which Bun skips unless the package is trusted.
const electronDir = join(root, 'node_modules', 'electron')
if (!existsSync(join(electronDir, 'path.txt'))) {
  console.error('the electron binary is missing. run: node node_modules/electron/install.js')
  process.exit(1)
}
const electron = join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())
const profile = mkdtempSync(join(tmpdir(), 'inkling-smoke-'))

/**
 * Runs in the renderer once the bridge exists, and resolves to the result lines. The main
 * process writes whatever it resolves to into INKLING_EVAL_RESULT, which keeps this script
 * free of any database or native module of its own.
 */
const checks = `
(async function () {
  // The bridge exists before React does; wait for it rather than assuming the timing.
  await new Promise((res) => {
    const tick = () => (window.inkling ? res() : setTimeout(tick, 50))
    tick()
  })
  const api = window.inkling
  const r = []
  const ok = (name, cond, detail) => r.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''))
  try {
    const home = await api.notebooks.home()
    const first = await api.notes.list()
    ok('first run makes a welcome note', first.length === 1 && first[0].title === 'Welcome to Inkling', first[0] && first[0].title)
    const welcomeTodo = (await api.tasks.open()).find((t) => t.note_id === first[0].id)
    ok('the welcome note has an open to-do on Today', !!welcomeTodo, welcomeTodo && welcomeTodo.title)

    // As the editor does it: the checkbox in the note, its task row and the id stamped back in one save.
    const docWith = (taskId) => JSON.stringify({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, taskId }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From a checkbox' }] }] }] }] })
    const note = await api.notes.create({ notebook_id: home, title: 'Smoke note', content: docWith(null) })
    const { ids } = await api.notes.saveWithTasks(note.id, home, { title: 'Smoke note', content: docWith(null) }, [{ taskId: null, title: 'From a checkbox', checked: false }])
    const open = await api.tasks.open()
    const linked = open.find((t) => t.id === ids[0])
    ok('a note checkbox shows up on Today', !!linked && linked.note_id === note.id && linked.note_title === 'Smoke note', linked && linked.title)

    const done = await api.tasks.setDone(linked.id, true)
    const doc = JSON.stringify(JSON.parse((await api.notes.get(note.id)).content))
    ok('ticking on Today stamps completed_at', done.status === 'done' && !!done.completed_at)
    ok('ticking on Today ticks the box in the note', doc.includes('"checked":true'))
    ok('a ticked to-do leaves Today', !(await api.tasks.open()).some((t) => t.id === linked.id))

    const hits = await api.search.query('Smoke')
    ok('full-text search finds the note', hits.some((h) => h.source_type === 'note' && h.note_id === note.id))
    const taskHit = (await api.search.query('checkbox')).find((h) => h.source_type === 'task')
    ok('a to-do in search opens its note', !!taskHit && taskHit.note_id === note.id)

    await api.notes.remove(note.id)
    const gone = !(await api.notes.list()).some((n) => n.id === note.id)
    await api.notes.restore(note.id)
    const back = (await api.notes.list()).some((n) => n.id === note.id)
    ok('delete then undo brings the note back', gone && back)

    const deck = await api.decks.create(home, 'Smoke deck')
    await api.decks.addCard(deck.id, 'Front', 'Back')
    await api.decks.addCard(deck.id, 'A', 'B')
    const due = await api.decks.dueCards(deck.id)
    ok('new cards are due immediately', due.length === 2, due.length + ' due')
    const after = await api.decks.review(due[0].id, 'good')
    ok('a review schedules the card forward', new Date(after.next_review_date) > new Date(), after.next_review_date)
    ok('a review records FSRS memory state', after.stability > 0 && after.difficulty > 0)
  } catch (e) {
    r.push('FAIL threw: ' + (e && e.message ? e.message : String(e)))
  }
  // String.fromCharCode(10) keeps a newline escape out of the template literal.
  return r.join(String.fromCharCode(10))
})()
`

// A headless Linux runner has no usable chrome-sandbox; the app is launched under xvfb there.
const args = process.platform === 'linux' ? [root, '--no-sandbox'] : [root]

const run = spawnSync(electron, args, {
  env: {
    ...process.env,
    // This script may itself be run through electron-as-node; the child must be a real app.
    ELECTRON_RUN_AS_NODE: undefined,
    INKLING_USERDATA: profile,
    INKLING_SCREENSHOT: join(profile, 'smoke.png'),
    INKLING_EVAL: checks,
    INKLING_EVAL_RESULT: join(profile, 'results.txt')
  },
  stdio: 'ignore',
  timeout: 90_000
})

const resultFile = join(profile, 'results.txt')
const results = existsSync(resultFile) ? readFileSync(resultFile, 'utf8').trim() : null
rmSync(profile, { recursive: true, force: true })

if (run.status !== 0 || !results) {
  console.error(`smoke test did not complete (electron exit ${run.status})`)
  process.exit(1)
}
console.log(results)
const failed = results.split('\n').filter((l) => l.startsWith('FAIL'))
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed`)
  process.exit(1)
}
console.log(`\nall ${results.split('\n').length} checks passed`)
