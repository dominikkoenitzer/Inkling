/**
 * Loaded into the app's main process by scripts/motion.mjs. Steps through each interaction with
 * every running animation paused and seeked, so each frame lands at an exact time, writes a shot
 * of each frame into MOTION_OUT, checks that closing a sheet hands the keyboard back at once,
 * then quits the app.
 */
const fs = require('node:fs')
const path = require('node:path')

const out = process.env.MOTION_OUT
const reduced = process.env.MOTION_REDUCED === '1'
const TIMES = [0, 30, 60, 90, 120, 160, 200, 260]
const lines = []
const scenes = []
let viewWidth = 0
const wait = (ms) => new Promise((res) => setTimeout(res, ms))
const ok = (name, cond, detail) => lines.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''))

// Page helpers: pause every animation at a given time, wait for a condition, and measure a box.
const HELPERS = `window.__motion = {
  seek(t) {
    const list = document.getAnimations()
    for (const a of list) { a.pause(); a.currentTime = t }
    return list.length
  },
  release() { for (const a of document.getAnimations()) a.play() },
  frame() { return new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 60) }) },
  async until(cond, ms = 3000) {
    const end = performance.now() + ms
    while (!cond()) { if (performance.now() > end) throw new Error('timed out: ' + cond); await new Promise((r) => setTimeout(r, 1)) }
  },
  box(sel, pad = 16) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: Math.max(0, b.left - pad), y: Math.max(0, b.top - pad), w: Math.min(innerWidth, b.width + pad * 2), h: Math.min(innerHeight, b.height + pad * 2) }
  },
  live(sel) { return [...document.querySelectorAll(sel)].filter((e) => !e.closest('[inert]')) }
}; true`

async function run(win) {
  const js = (code) => win.webContents.executeJavaScript(code)
  win.webContents.setBackgroundThrottling(false)
  for (let i = 0; i < 200 && !(await js('!!(window.__app && window.__app.getState().ready)')); i++) await wait(50)
  win.webContents.debugger.attach('1.3')
  // The window stays in the background, so the page is told it has focus for :focus-visible.
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (reduced) {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  }
  win.setSize(1100, 760)
  await js(HELPERS)
  await js(`window.__app.getState().setTheme('light')`)
  await wait(800)
  viewWidth = await js('innerWidth')

  /**
   * Runs `trigger` (page code that resolves once the change is on screen), pauses everything at
   * once, then shoots each frame time. `clips` are page boxes to cut the strips from.
   */
  async function scene(name, trigger, clips) {
    const dir = path.join(out, name)
    fs.mkdirSync(dir, { recursive: true })
    let started = 0
    try {
      started = await js(`(async () => { ${trigger}; await new Promise((r) => setTimeout(r, 0)); return window.__motion.seek(0) })()`)
    } catch (e) {
      ok(name + ': the interaction ran', false, String(e.message || e).split('\n')[0])
      return
    }
    const frames = []
    for (const t of TIMES) {
      const running = await js(`window.__motion.seek(${t})`)
      await js('window.__motion.frame()')
      const image = await win.webContents.capturePage()
      const file = path.join(dir, String(t).padStart(3, '0') + 'ms.png')
      fs.writeFileSync(file, image.toPNG())
      frames.push({ t, file, running })
    }
    const boxes = {}
    for (const [label, code] of Object.entries(clips)) boxes[label] = await js(code)
    await js('window.__motion.release()')
    await wait(500)
    scenes.push({ name, started, frames, boxes })
  }

  const app = (code) => `window.__app.getState().${code}`
  const shut = `window.__app.setState({ paletteOpen: false, settingsOpen: false, shortcutsOpen: false, toast: null })`
  const main = `window.__motion.box('main', 0)`

  // Sheets.
  await js(shut)
  await scene('search-open', app('setPaletteOpen(true)'), { sheet: `window.__motion.box('[role=dialog]', 40)` })
  await scene('search-close', app('setPaletteOpen(false)'), { sheet: `({ x: 250, y: 60, w: 680, h: 420 })` })
  await scene('settings-open', app('setSettingsOpen(true)'), { sheet: `window.__motion.box('[role=dialog]', 40)` })
  await scene('settings-close', app('setSettingsOpen(false)'), { sheet: `({ x: 280, y: 60, w: 620, h: 640 })` })
  await scene('shortcuts-open', app('setShortcutsOpen(true)'), { sheet: `window.__motion.box('[role=dialog]', 40)` })
  await js(shut)
  await wait(400)

  // Pages.
  await js(app(`setView('today')`))
  await wait(600)
  await scene('page-today-to-flashcards', app(`setView('study')`), { main })
  const firstNote = await js(`window.inkling.notes.list().then((n) => n[n.length - 1].id)`)
  await scene('open-note', app(`openNote(${firstNote})`), { main })

  // A new note joins the sidebar, then goes again with its undo toast.
  const rows = `window.__motion.live('aside nav ~ div button').length`
  await scene(
    'new-note',
    `const before = ${rows}; await ${app('newNote()')}; await window.__motion.until(() => ${rows} > before)`,
    { sidebar: `window.__motion.box('aside', 0)` }
  )
  await wait(800)
  await scene(
    'delete-note',
    `const before = ${rows}; document.querySelector('[aria-label="Delete note"]').click(); await window.__motion.until(() => ${rows} < before)`,
    { sidebar: `window.__motion.box('aside', 0)`, toast: `window.__motion.box('[role=status]', 24)` }
  )
  await scene('toast-close', app('dismissToast()'), { toast: `({ x: 300, y: 640, w: 500, h: 120 })` })

  // Ticking a to-do on Today.
  await js(app(`setView('today')`))
  await wait(600)
  await scene('tick-todo', `document.querySelector('main .check').click()`, { row: `window.__motion.box(document.querySelector('main li'), 12)` })

  // Review: the answer, then the next card.
  const deck = await js(`window.inkling.decks.list().then((d) => d.find((x) => x.due_count > 0).id)`)
  await js(app(`reviewDeck(${deck})`))
  await js(`window.__motion.until(() => document.querySelector('main .cursor-pointer'))`)
  await wait(500)
  await scene('review-reveal', `document.querySelector('main .cursor-pointer').click()`, { main })
  await scene(
    'review-next',
    `const before = document.querySelector('main h2 + span').textContent; [...document.querySelectorAll('main button')].find((b) => b.textContent.startsWith('Good')).click(); await window.__motion.until(() => document.querySelector('main h2 + span').textContent !== before)`,
    { main }
  )

  // Cards in a deck: one added, one deleted.
  const French = await js(`window.inkling.decks.list().then((d) => d.find((x) => x.name.startsWith('French')).id)`)
  await js(app(`openDeck(${French})`))
  await wait(600)
  const cards = `window.__motion.live('main ul li').length`
  await scene(
    'card-add',
    `const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
     const [front, back] = document.querySelectorAll('main input[placeholder]')
     set.call(front, 'le stylo'); front.dispatchEvent(new Event('input', { bubbles: true }))
     set.call(back, 'the pen'); back.dispatchEvent(new Event('input', { bubbles: true }))
     await new Promise((r) => setTimeout(r, 50))
     const before = ${cards}
     ;[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Add').click()
     await window.__motion.until(() => ${cards} > before)`,
    { list: `window.__motion.box('main ul', 12)` }
  )
  await wait(400)
  await scene(
    'card-delete',
    `const before = ${cards}; document.querySelector('main [aria-label="Delete card"]').click(); await window.__motion.until(() => ${cards} < before)`,
    { list: `window.__motion.box('main ul', 12)` }
  )

  // Hover and press on a button, through real pointer events.
  await js(app(`setView('study')`))
  await wait(600)
  const target = JSON.parse(await js(`JSON.stringify(window.__motion.box([...document.querySelectorAll('main button')].find((b) => b.textContent.includes('New deck')), 0))`))
  const cx = Math.round(target.x + target.w / 2)
  const cy = Math.round(target.y + target.h / 2)
  const clip = { button: `({ x: ${target.x - 24}, y: ${target.y - 16}, w: ${target.w + 48}, h: ${target.h + 32} })` }
  // The pointer starts outside the button, so the hover begins inside the scene.
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 300 })
  await wait(300)
  win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy })
  await scene('hover', '', clip)
  win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 })
  await scene('press', '', clip)
  // Release outside the button, so no deck form opens.
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 300 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 5, y: 300, button: 'left', clickCount: 1 })
  await wait(300)

  // Closing a sheet hands the keyboard back in the same moment.
  await js(shut)
  await wait(300)
  await js(`(() => { const b = [...document.querySelectorAll('aside button')].find((x) => x.textContent.trim() === 'Settings'); b.focus(); b.click() })()`)
  await wait(400)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  const after = JSON.parse(
    await js(`new Promise((r) => setTimeout(() => r(JSON.stringify({
      open: window.__app.getState().settingsOpen,
      focus: document.activeElement && document.activeElement.textContent.trim(),
      modal: !!document.querySelector('[aria-modal="true"]')
    })), 10))`)
  )
  ok('Escape closes the settings', after.open === false)
  ok('focus is back on the Settings button within 10ms', after.focus === 'Settings', 'focus on ' + JSON.stringify(after.focus))
  ok('nothing modal is left within 10ms', after.modal === false)
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: [mod] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: [mod] })
  const palette = JSON.parse(
    await js(`new Promise((r) => setTimeout(() => r(JSON.stringify({
      open: window.__app.getState().paletteOpen,
      typing: document.activeElement && document.activeElement.getAttribute('aria-label')
    })), 30))`)
  )
  ok('the search opens while the settings are still leaving', palette.open === true)
  ok('the search field has the keyboard', palette.typing === 'Search', 'focus on ' + palette.typing)
  await js(shut)
  await wait(300)

  // The focus ring of the first note in the sidebar stays inside the list that scrolls.
  // Up from the second note, so the ring is one the keyboard asked for.
  await js(`(() => { const rows = document.querySelectorAll('aside [data-row]'); rows[0].parentElement.scrollTop = 0; rows[1].focus() })()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
  await wait(100)
  const ring = JSON.parse(
    await js(`(() => {
      const row = document.activeElement
      const list = row.parentElement.getBoundingClientRect()
      const box = row.getBoundingClientRect()
      const cs = getComputedStyle(row)
      const reach = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset)
      return JSON.stringify({ visible: row.matches(':focus-visible'), top: box.top - reach - list.top, bottom: list.bottom - (box.bottom + reach) })
    })()`)
  )
  ok('the first note shows its focus ring', ring.visible)
  ok('its ring is not cut off by the list', ring.top >= 0, 'room above ' + ring.top + 'px')
}

// Preloaded before Electron sets up its own modules, so `electron` is asked for once it has.
let app
setImmediate(() => {
  let BrowserWindow
  ;({ app, BrowserWindow } = require('electron'))
  void BrowserWindow
  app.once('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', () => {
      run(win)
        .catch((e) => lines.push('FAIL the probe threw: ' + ((e && e.stack) || e)))
        .finally(() => {
          fs.writeFileSync(path.join(out, 'results.txt'), lines.join('\n'))
          fs.writeFileSync(path.join(out, 'scenes.json'), JSON.stringify({ times: TIMES, reduced, width: viewWidth, scenes }, null, 2))
          app.quit()
        })
    })
  })
})
