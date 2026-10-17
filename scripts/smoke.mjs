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
/**
 * The bridge checks. Every check runs in the renderer, and the main process writes the result
 * lines into INKLING_EVAL_RESULT, which keeps this script free of any native module of its own.
 */
const apiChecks = `
  try {
    const home = await api.notebooks.home()
    const first = await api.notes.list()
    ok('first run makes a welcome note', first.length === 1 && first[0].title === 'Welcome to Inkling', first[0] && first[0].title)
    const welcomeTodo = (await api.tasks.open()).find((t) => t.note_id === first[0].id)
    ok('the welcome note has an open to-do on Today', !!welcomeTodo, welcomeTodo && welcomeTodo.title)

    // As the editor does it: the checkbox in the note, then its task row, then the id stamped back.
    const docWith = (taskId) => JSON.stringify({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, taskId }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From a checkbox' }] }] }] }] })
    const note = await api.notes.create({ notebook_id: home, title: 'Smoke note', content: docWith(null) })
    const ids = await api.notes.syncTasks(note.id, home, [{ taskId: null, title: 'From a checkbox', checked: false }])
    await api.notes.update(note.id, { content: docWith(ids[0]) })
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
`

/**
 * Walks every view with deep descenders and stacked accents and fails on any glyph a box cuts
 * off: the ink of each text line, measured on a canvas in the line's own font, has to fit inside
 * every ancestor that clips it. Text inside a scroller that is scrolled out of view is skipped.
 */
const clipChecks = (themes) => `
  try {
    await new Promise((res) => {
      const tick = () => (window.__app ? res() : setTimeout(tick, 50))
      tick()
    })
    const app = window.__app
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    const deep = 'gjpqy Ågÿ Ćęż'
    const home = await api.notebooks.home()
    const para = (type, text, attrs) => ({ type, attrs, content: [{ type: 'text', text }] })
    const content = JSON.stringify({ type: 'doc', content: [para('heading', deep, { level: 1 }), para('heading', deep, { level: 2 }), para('paragraph', deep)] })
    const note = await api.notes.create({ notebook_id: home, title: deep + ' ' + deep, content })
    await api.notes.syncTasks(note.id, home, [{ taskId: null, title: deep, checked: false }])
    const deck = await api.decks.create(home, deep)
    await api.decks.addCard(deck.id, deep, deep)

    const ctx = document.createElement('canvas').getContext('2d')
    const ink = (el, text) => {
      const cs = getComputedStyle(el)
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
      const m = ctx.measureText(text)
      const fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent
      return { up: m.actualBoundingBoxAscent, down: m.actualBoundingBoxDescent, fa, fd, lh: parseFloat(cs.lineHeight) || fa + fd }
    }
    const pad = (el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
      const top = r.top + parseFloat(cs.borderTopWidth), bottom = r.bottom - parseFloat(cs.borderBottomWidth)
      return { top, bottom, ctop: top + parseFloat(cs.paddingTop), cbottom: bottom - parseFloat(cs.paddingBottom) }
    }
    const name = (a) => a.tagName.toLowerCase() + '.' + String(a.className).split(' ').slice(0, 3).join('.')
    // What cuts the ink [top, bottom] of a line whose layout box is [ltop, lbottom], if anything.
    const cutBy = (el, top, bottom, ltop, lbottom) => {
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const oy = getComputedStyle(a).overflowY
        if (oy === 'visible') continue
        const b = pad(a)
        const scrolls = (oy === 'auto' || oy === 'scroll') && a.scrollHeight > a.clientHeight + 1
        if (scrolls && (ltop < b.top || lbottom > b.bottom)) return null
        const over = Math.max(b.top - top, bottom - b.bottom)
        if (over > 0.01) return name(a) + ' by ' + over.toFixed(2) + 'px'
      }
      return null
    }
    const fails = new Set()
    const scan = (where) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const text = t.textContent.trim()
        const el = t.parentElement
        if (!text || !el || el.closest('textarea, input, script, style')) continue
        const m = ink(el, text)
        const range = document.createRange()
        range.selectNodeContents(t)
        for (const r of range.getClientRects()) {
          if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue
          // A text box spans the font's ascent and descent; the baseline sits that ascent down.
          const base = r.top + m.fa
          const cut = cutBy(el, base - m.up, base + m.down, r.top, r.bottom)
          if (cut) fails.add(where + ': "' + text.slice(0, 24) + '" cut at ' + cut)
        }
      }
      for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea')) {
        const text = el.value || el.placeholder
        const r = el.getBoundingClientRect()
        if (!text || r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue
        const area = el.tagName === 'TEXTAREA'
        const m = ink(el, text), b = pad(el)
        const lines = area ? Math.max(1, Math.round((b.cbottom - b.ctop) / m.lh)) : 1
        // A textarea starts at its content top; a single-line field centres its line.
        const first = area ? b.ctop : b.ctop + (b.cbottom - b.ctop - m.lh) / 2
        const top = first + (m.lh - m.fa - m.fd) / 2 + m.fa - m.up
        const bottom = first + (lines - 1) * m.lh + (m.lh - m.fa - m.fd) / 2 + m.fa + m.down
        // A textarea clips to its padding box; a single-line field is held to its content box.
        const over = Math.max((area ? b.top : b.ctop) - top, bottom - (area ? b.bottom : b.cbottom))
        const cut = over > 0.01 ? name(el) + ' by ' + over.toFixed(2) + 'px' : cutBy(el.parentElement, top, bottom, r.top, r.bottom)
        if (cut) fails.add(where + ': field "' + text.slice(0, 24) + '" cut at ' + cut)
      }
    }
    const visit = async (where, go, ms) => {
      app.setState({ paletteOpen: false, settingsOpen: false, shortcutsOpen: false })
      await go()
      await wait(ms || 400)
      scan(where)
    }
    for (const theme of ${JSON.stringify(themes)}) {
      app.getState().setTheme(theme)
      await visit(theme + ' today', () => app.getState().setView('today'))
      await visit(theme + ' note', () => app.getState().openNote(note.id), 1500)
      await visit(theme + ' flashcards', () => app.getState().setView('study'))
      await visit(theme + ' deck', () => app.getState().openDeck(deck.id))
      await visit(theme + ' review', () => app.getState().reviewDeck(deck.id))
      const card = document.querySelector('[class*="min-h-[240px]"]')
      if (card) card.click()
      await wait(300)
      scan(theme + ' review answer')
      await visit(theme + ' search', async () => {
        app.getState().setPaletteOpen(true)
        await wait(200)
        const input = document.querySelector('input[placeholder^=Search]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'gjpqy')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, 900)
      await visit(theme + ' settings', () => app.getState().setSettingsOpen(true))
      await visit(theme + ' shortcuts', () => app.getState().setShortcutsOpen(true))
      await visit(theme + ' new note', () => app.getState().newNote(), 900)
    }
    ok('no view cuts off a glyph at scale ' + devicePixelRatio, fails.size === 0, [...fails].slice(0, 6).join('; '))
  } catch (e) {
    r.push('FAIL the clip check threw: ' + (e && e.message ? e.message : String(e)))
  }
`

/** One app run: the bridge first, then the checks, resolving to their result lines. */
const evalOf = (body) => `
(async function () {
  // The bridge exists before React does; wait for it rather than assuming the timing.
  await new Promise((res) => {
    const tick = () => (window.inkling ? res() : setTimeout(tick, 50))
    tick()
  })
  const api = window.inkling
  const r = []
  const ok = (name, cond, detail) => r.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''))
${body}
  // String.fromCharCode(10) keeps a newline escape out of the template literal.
  return r.join(String.fromCharCode(10))
})()
`

// A headless Linux runner has no usable chrome-sandbox; the app is launched under xvfb there.
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : []

/** Runs the app on a throwaway profile at one device scale, the same layout Ctrl+ and Ctrl- give. */
function launch(scale, body) {
  const profile = mkdtempSync(join(tmpdir(), 'inkling-smoke-'))
  const run = spawnSync(electron, [root, ...sandbox, `--force-device-scale-factor=${scale}`], {
    env: {
      ...process.env,
      // This script may itself be run through electron-as-node; the child must be a real app.
      ELECTRON_RUN_AS_NODE: undefined,
      INKLING_USERDATA: profile,
      INKLING_SCREENSHOT: join(profile, 'smoke.png'),
      INKLING_EVAL: evalOf(body),
      INKLING_EVAL_RESULT: join(profile, 'results.txt')
    },
    stdio: 'ignore',
    timeout: 90_000
  })
  const resultFile = join(profile, 'results.txt')
  const results = existsSync(resultFile) ? readFileSync(resultFile, 'utf8').trim() : null
  rmSync(profile, { recursive: true, force: true })
  if (run.status !== 0 || !results) {
    console.error(`smoke test did not complete at scale ${scale} (electron exit ${run.status})`)
    process.exit(1)
  }
  return results.split('\n')
}

const lines = [
  ...launch(1, apiChecks + clipChecks(['light', 'dark'])),
  ...[0.8, 1.25, 1.5, 2].flatMap((scale) => launch(scale, clipChecks(['light'])))
]
console.log(lines.join('\n'))
const failed = lines.filter((l) => l.startsWith('FAIL'))
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed`)
  process.exit(1)
}
console.log(`\nall ${lines.length} checks passed`)
