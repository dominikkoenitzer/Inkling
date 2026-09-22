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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
// electron/path.txt names the binary for this platform: electron.exe, electron, or the
// path inside Electron.app. Hardcoding the Windows name would break the Linux CI runner.
const electronDir = join(root, 'node_modules', 'electron')
const electron = join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())
const profile = mkdtempSync(join(tmpdir(), 'inkling-smoke-'))

/**
 * Runs in the renderer once the bridge exists. Results are written to a settings row rather
 * than the console, because the window is headless and quits on its own; the row survives it.
 */
const checks = `
(async function run() {
  if (!window.inkling) return setTimeout(run, 80)
  const api = window.inkling
  const r = []
  const ok = (name, cond, detail) => r.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''))
  try {
    const nb = (await api.notebooks.list())[0]
    ok('first run creates a notebook', !!nb, nb && nb.name)

    const note = await api.notes.create({ notebook_id: nb.id, title: 'Smoke note' })
    const ids = await api.notes.syncTasks(note.id, nb.id, [{ taskId: null, title: 'From a checkbox', checked: false }])
    const linked = await api.tasks.get(ids[0])
    ok('a note checkbox becomes a linked task', !!linked && linked.note_id === note.id, linked && linked.title)

    await api.tasks.update(linked.id, { status: 'done' })
    const done = await api.tasks.get(linked.id)
    ok('completing a task stamps completed_at', done.status === 'done' && !!done.completed_at)

    const hits = await api.search.query('Smoke')
    ok('full-text search finds the note', hits.some((h) => h.source_type === 'note' && h.source_id === note.id))

    await api.notes.remove(note.id)
    const gone = (await api.notes.list(nb.id)).some((n) => n.id === note.id)
    await api.notes.restore(note.id)
    const back = (await api.notes.list(nb.id)).some((n) => n.id === note.id)
    ok('delete then undo restores the page', !gone && back)

    const deck = await api.decks.createFromPairs(nb.id, 'Smoke deck', [['Front', 'Back'], ['A', 'B']])
    const due = await api.decks.dueCards(deck.id)
    ok('new cards are due immediately', due.length === 2, due.length + ' due')
    const after = await api.decks.review(due[0].id, 'good')
    ok('a review schedules the card forward', new Date(after.next_review_date) > new Date(), after.next_review_date)
    ok('a review records FSRS memory state', after.stability > 0 && after.difficulty > 0)

    const g = await api.grades.create({ notebook_id: nb.id, title: 'Smoke quiz', score: 5, max: 6, weight: 1, system: 'swiss' })
    ok('a grade keeps the system it was entered in', (await api.grades.list(nb.id)).some((x) => x.id === g.id && x.system === 'swiss'))

    const fid = await api.focus.start({ deck_id: deck.id })
    await api.focus.complete(fid, 25)
    ok('a finished focus session counts towards today', (await api.focus.todayMinutes()) >= 25)

    ok('the streak advances', (await api.streak.bump(new Date().toISOString().slice(0, 10))).count >= 1)

    const o = await api.stats.overview(30)
    ok('Progress reads the review log back', o.reviews >= 1 && o.reviews_all_time >= 1, o.reviews + ' reviews')
  } catch (e) {
    r.push('FAIL threw: ' + (e && e.message ? e.message : String(e)))
  }
  await window.inkling.settings.set('smoke_results', r.join('\\n'))
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
    INKLING_EVAL: checks
  },
  stdio: 'ignore',
  timeout: 90_000
})

let results = null
try {
  const Database = require(join(root, 'node_modules', 'better-sqlite3'))
  const db = new Database(join(profile, 'inkling.db'), { readonly: true })
  results = db.prepare("SELECT value FROM settings WHERE key = 'smoke_results'").get()?.value ?? null
  db.close()
} catch (err) {
  console.error('could not read the results back:', err.message)
}
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
