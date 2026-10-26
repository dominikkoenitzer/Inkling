/**
 * Loaded into the app's main process by scripts/titlebar.mjs. Walks the window through every
 * title bar state, measures the bar against the real window buttons and writes the result lines,
 * the measurements and a shot of each state into TITLEBAR_OUT, then quits the app.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const out = process.env.TITLEBAR_OUT
const onScreen = process.env.TITLEBAR_ONSCREEN === '1'
const mac = process.platform === 'darwin'
const lines = []
const data = { platform: process.platform, states: [] }
const wait = (ms) => new Promise((res) => setTimeout(res, ms))
const ok = (name, cond, detail) => lines.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''))

// What the title bar holds, in window content coordinates, plus the overlay's free area.
const MEASURE = `(() => {
  const h = document.querySelector('header')
  if (!h) return JSON.stringify({ header: null })
  const r = (b) => ({ x: b.left, y: b.top, w: b.width, h: b.height })
  const label = (s) => s.trim().replace(/\\s+/g, ' ').slice(0, 24)
  const items = []
  for (const el of h.querySelectorAll('button, a, input, svg')) {
    const b = el.getBoundingClientRect()
    if (b.width && b.height) items.push({ what: el.tagName.toLowerCase() + ' "' + label(el.textContent) + '"', ...r(b) })
  }
  const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(t)
    for (const b of range.getClientRects()) if (b.width) items.push({ what: 'text "' + label(t.textContent) + '"', ...r(b) })
  }
  const o = navigator.windowControlsOverlay
  const area = o && o.visible ? r(o.getTitlebarAreaRect()) : null
  const pad = parseFloat(getComputedStyle(h.firstElementChild).paddingLeft)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return JSON.stringify({ items, area, pad, rem, header: r(h.getBoundingClientRect()), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio })
})()`

// The three lights as the system paints them on an active window, in red, yellow and green.
const LIGHTS = [
  ['close', (r, g, b) => r > 200 && g < 130 && b < 130],
  ['minimise', (r, g, b) => r > 200 && g > 150 && g < 220 && b < 110],
  ['zoom', (r, g, b) => g > 150 && r < 120 && b < 120]
]

/**
 * The close, minimise and zoom buttons of the real window, found by their colours in a shot of
 * it, in window content coordinates. A light covers about 14 by 14 points, so a smaller patch of
 * colour is something else.
 */
function macButtons(win, file) {
  const image = nativeImage.createFromPath(file)
  const { width, height } = image.getSize()
  if (!width) throw new Error('the window shot is empty')
  const bitmap = image.toBitmap()
  const bounds = win.getBounds()
  const content = win.getContentBounds()
  // The shot stops at the screen edge, so its size says nothing about the scale; the display does.
  const scale = screen.getDisplayMatching(bounds).scaleFactor
  // The lights live in the top left corner of the window.
  const maxX = Math.min(width, Math.round(200 * scale))
  const maxY = Math.min(height, Math.round(80 * scale))
  const found = []
  for (const [what, match] of LIGHTS) {
    let n = 0
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < maxY; y++) {
      for (let x = 0; x < maxX; x++) {
        const i = (y * width + x) * 4
        // Chromium bitmaps are blue, green, red, alpha.
        if (!match(bitmap[i + 2], bitmap[i + 1], bitmap[i])) continue
        n++
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
    if (n < 50 * scale * scale) continue
    found.push({
      what,
      x: x0 / scale + bounds.x - content.x,
      y: y0 / scale + bounds.y - content.y,
      w: (x1 - x0 + 1) / scale,
      h: (y1 - y0 + 1) / scale
    })
  }
  return found
}

/** On Windows and Linux the buttons fill whatever the overlay leaves out of the bar. */
function overlayButtons(page) {
  const a = page.area
  if (!a) return []
  const rects = []
  if (a.x > 0) rects.push({ what: 'controls (left)', x: 0, y: 0, w: a.x, h: a.h })
  const right = a.x + a.w
  if (right < page.vw) rects.push({ what: 'controls (right)', x: right, y: 0, w: page.vw - right, h: a.h })
  return rects
}

const hits = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h && b.y < a.y + a.h

async function shoot(win, name) {
  // Under a virtual display the first frames can still be on their way.
  for (let attempt = 1; ; attempt++) {
    try {
      const image = await win.webContents.capturePage()
      fs.writeFileSync(path.join(out, 'web-' + name + '.png'), image.toPNG())
      break
    } catch (e) {
      if (attempt === 5) {
        ok('page shot of ' + name, false, String(e.message || e))
        break
      }
      await wait(1000)
    }
  }
  if (!mac || !onScreen) return
  // The real window, buttons included: they are drawn outside the page.
  const b = win.getBounds()
  try {
    execFileSync('screencapture', ['-x', '-o', `-R${b.x},${b.y},${b.width},${b.height}`, path.join(out, 'mac-' + name + '.png')], { timeout: 20_000 })
  } catch (e) {
    ok('screen capture of ' + name, false, String(e.message || e).split('\n')[0])
  }
}

async function measure(win, name, gap) {
  const page = JSON.parse(await win.webContents.executeJavaScript(MEASURE))
  if (!page.header) return ok(name + ': the title bar is there', false)
  // The page measures in its own pixels, which zoom scales; the Mac buttons are in window points.
  if (mac) {
    const zoom = win.webContents.getZoomFactor()
    const scale = (b) => ({ ...b, x: b.x * zoom, y: b.y * zoom, w: b.w * zoom, h: b.h * zoom })
    page.zoom = zoom
    page.items = page.items.map(scale)
    page.header = scale(page.header)
  }
  await shoot(win, name)
  if (mac && !onScreen) return ok(name + ': the window buttons are only drawn on screen', false, 'run with CI set')
  let buttons
  try {
    buttons = mac ? macButtons(win, path.join(out, 'mac-' + name + '.png')) : overlayButtons(page)
  } catch (e) {
    return ok(name + ': reading the window buttons', false, String(e.message || e).split('\n')[0])
  }
  data.states.push({ name, page, buttons, bounds: win.getBounds(), fullscreen: win.isFullScreen() })
  // In full screen the system hides the buttons until the pointer reaches the top edge.
  const expected = win.isFullScreen() ? 0 : 3
  if (mac) ok(name + ': the window buttons are found', buttons.length === expected, buttons.length + ' found, ' + expected + ' expected')
  const under = []
  for (const item of page.items) for (const b of buttons) if (hits(item, b, gap)) under.push(item.what + ' at ' + Math.round(item.x) + ' under ' + b.what)
  ok(name + ': nothing in the title bar sits under the window buttons', under.length === 0, under.slice(0, 4).join('; '))
  return { page, buttons }
}

function menuOf(menu) {
  return (menu ? menu.items : []).map((i) => ({
    label: i.label,
    role: i.role || undefined,
    accelerator: i.accelerator || undefined,
    visible: i.visible === false ? false : undefined,
    submenu: i.submenu ? menuOf(i.submenu) : undefined
  }))
}

async function run(win) {
  const js = (code) => win.webContents.executeJavaScript(code)
  for (let i = 0; i < 200 && !(await js('!!(window.__app && window.__app.getState().ready)')); i++) await wait(50)
  const state = (code) => js(`window.__app.getState().${code}`)
  // Room a native toolbar keeps between the buttons and its first item.
  const gap = Number(process.env.TITLEBAR_GAP || 0)
  win.setMinimumSize(860, 560)
  // The lights keep their colours only on the active window.
  if (mac && onScreen) win.focus()

  for (const theme of ['light', 'dark']) {
    await state(`setTheme('${theme}')`)
    for (const width of [860, 1100, 1600]) {
      win.setSize(width, 860)
      await wait(500)
      const name = `${theme}-${width}`
      await measure(win, name, gap)
    }
  }

  if (mac) {
    // Where the buttons sit in the bar: a native toolbar centres them.
    const s = data.states.find((x) => x.name === 'light-1100')
    if (s && s.buttons.length) {
      const mid = s.buttons.reduce((m, b) => m + b.y + b.h / 2, 0) / s.buttons.length
      const bar = s.page.header.y + s.page.header.h / 2
      ok('the window buttons sit centred in the title bar', Math.abs(mid - bar) <= 1, 'button middle ' + mid.toFixed(1) + ', bar middle ' + bar.toFixed(1))
      // A native toolbar keeps the close button about as far from the left edge as from the top.
      const close = s.buttons.find((b) => b.what === 'close')
      if (close) {
        const top = close.y - s.page.header.y
        ok('the close button keeps the margin of a native toolbar', Math.abs(close.x - top) <= 2, 'left ' + close.x.toFixed(1) + ', top ' + top.toFixed(1))
      }
    }
  }

  // Zoomed text scales the page but not the window buttons: the bar keeps their height, and grows
  // past it only where its own controls would not fit (2.125rem, the floor in App.tsx).
  win.setSize(1100, 860)
  for (const level of [-2.5, 1.5, 3]) {
    win.webContents.setZoomLevel(level)
    await wait(800)
    const name = 'zoom' + level
    const z = await measure(win, name, gap)
    if (!z || !z.page) continue
    const head = z.page.header
    const spill = z.page.items.filter((i) => i.y < head.y - 0.5 || i.y + i.h > head.y + head.h + 0.5)
    ok(name + ': everything in the title bar stays inside it', spill.length === 0, spill.slice(0, 4).map((i) => i.what + ' ' + i.y.toFixed(1) + ' to ' + (i.y + i.h).toFixed(1) + ' in bar ' + head.y.toFixed(1) + ' to ' + (head.y + head.h).toFixed(1)).join('; '))
    const bar = head.y + head.h / 2
    if (mac && z.buttons.length) {
      if (level > 1.5) continue
      const mid = z.buttons.reduce((m, b) => m + b.y + b.h / 2, 0) / z.buttons.length
      ok(name + ': the window buttons stay centred in the title bar', Math.abs(mid - bar) <= 1.5, 'button middle ' + mid.toFixed(1) + ', bar middle ' + bar.toFixed(1))
    } else if (z.page.area) {
      const want = Math.max(z.page.area.h, 2.125 * z.page.rem)
      ok(name + ': the title bar keeps the height of the window controls or its floor', Math.abs(head.h - want) <= 1, 'bar ' + head.h.toFixed(1) + ', controls ' + z.page.area.h.toFixed(1) + ', floor ' + (2.125 * z.page.rem).toFixed(1))
    }
  }
  win.webContents.setZoomLevel(0)
  await wait(500)

  if (onScreen) {
    for (const theme of ['light', 'dark']) {
      await state(`setTheme('${theme}')`)
      const entered = new Promise((res) => win.once('enter-full-screen', res))
      win.setFullScreen(true)
      await Promise.race([entered, wait(5000)])
      await wait(1500)
      const full = await measure(win, theme + '-fullscreen', gap)
      // With the buttons gone the bar starts at the edge again.
      if (full && full.page) ok(theme + '-fullscreen: the title bar starts at the edge', full.page.pad === 16, 'inset ' + full.page.pad)
      const left = new Promise((res) => win.once('leave-full-screen', res))
      win.setFullScreen(false)
      await Promise.race([left, wait(5000)])
      await wait(1500)
    }
  }

  // The window behind the page follows the theme, or a resize flashes the other one.
  for (const [theme, color] of [['dark', '#1a1918'], ['light', '#fbfaf8']]) {
    await state(`setTheme('${theme}')`)
    await wait(300)
    const bg = win.getBackgroundColor().toLowerCase()
    ok('the window background follows the ' + theme + ' theme', bg.startsWith(color), bg)
  }

  // The app's shortcuts sit on Command on a Mac, where Control moves the cursor, and on Ctrl elsewhere.
  const press = async (mods) => {
    await js('window.__app.setState({ paletteOpen: false, settingsOpen: false, shortcutsOpen: false })')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: mods })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: mods })
    await wait(300)
    return js('window.__app.getState().paletteOpen')
  }
  const own = mac ? 'meta' : 'control'
  const other = mac ? 'control' : 'meta'
  ok(own + '+K opens search', (await press([own])) === true)
  if (mac) ok(other + '+K leaves search closed', (await press([other])) === false)
  await js('window.__app.setState({ paletteOpen: false })')

  // Shots of the overlays for the record: shortcut sheet, search and settings.
  await state(`setTheme('light')`)
  win.setSize(1100, 860)
  for (const [name, code] of [
    ['sheet', 'setShortcutsOpen(true)'],
    ['search', 'setPaletteOpen(true)'],
    ['settings', 'setSettingsOpen(true)']
  ]) {
    await js('window.__app.setState({ paletteOpen: false, settingsOpen: false, shortcutsOpen: false })')
    await state(code)
    await wait(500)
    await shoot(win, 'light-' + name)
    const sheet = JSON.parse(
      await js(`(() => {
        const d = document.querySelector('[role=dialog]')
        if (!d) return 'null'
        const b = d.getBoundingClientRect()
        const style = getComputedStyle(d.parentElement)
        return JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height, region: style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') })
      })()`)
    )
    if (!sheet) {
      ok(name + ': the sheet opens', false)
      continue
    }
    // Electron reads drag areas from the page's styles alone, so the shade over the bar must say no-drag itself.
    ok(name + ': a click beside the sheet closes it instead of dragging the window', sheet.region === 'no-drag', 'region ' + (sheet.region || 'none'))
    const home = data.states.find((x) => x.name === 'light-1100')
    if (mac && home) ok(name + ': the sheet stays clear of the window buttons', !home.buttons.some((b) => hits(sheet, b, 0)))
  }
  if (mac) {
    // Command+W closes the sheet in front, the way it closes a panel, and leaves the window open.
    await js('window.__app.setState({ paletteOpen: false, settingsOpen: false, shortcutsOpen: false })')
    await state('setSettingsOpen(true)')
    await wait(300)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['meta'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: ['meta'] })
    await wait(300)
    ok('Command+W closes the settings and leaves the window open', (await js('window.__app.getState().settingsOpen')) === false && win.isVisible())
    await js('window.__app.setState({ settingsOpen: false })')
  }
  data.menu = menuOf(Menu.getApplicationMenu())
  if (mac) {
    // The menu bar holds what the app does, with the keys the system expects.
    const items = []
    const walk = (list, top) => list.forEach((i) => (items.push({ ...i, top }), i.submenu && walk(i.submenu, top || i.label)))
    walk(data.menu, '')
    const has = (label, accel) => items.some((i) => i.label === label && (!accel || (i.accelerator || '').replace('CmdOrCtrl', 'Command') === accel))
    ok('the app menu opens settings with Command+,', has('Settings…', 'Command+,'))
    ok('the File menu makes a new note with Command+N', has('New Note', 'Command+N'))
    ok('the Help menu shows the keyboard shortcuts', has('Keyboard Shortcuts'))
    await reopen(win)
  }
}

/** A Mac keeps the app open with its window closed: the Dock and the menu bring a window back. */
async function reopen(win) {
  const until = async (cond) => {
    for (let i = 0; i < 100 && !(await cond()); i++) await wait(100)
    return cond()
  }
  const item = (label) => {
    const find = (menu) => {
      for (const i of menu.items) {
        if (i.label === label) return i
        const inner = i.submenu && find(i.submenu)
        if (inner) return inner
      }
    }
    return find(Menu.getApplicationMenu())
  }
  const current = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
  const notes = (w) => w.webContents.executeJavaScript('window.inkling.notes.list().then((n) => n.length)')

  win.minimize()
  await until(() => win.isMinimized())
  app.emit('activate', {}, false)
  ok('the Dock icon brings a minimised window back', await until(() => !win.isMinimized()))

  const before = await notes(win)
  const close = (w) => {
    const closed = new Promise((res) => (w.once('closed', res), w.once('hide', res)))
    w.close()
    return Promise.race([closed, wait(5000)])
  }
  await close(win)
  ok('closing the window leaves the app running', !current())
  item('New Note').click()
  const made = await until(() => !!current())
  const ready = made && (await until(async () => (await notes(current())) === before + 1))
  ok('New Note with the window closed opens a window with a new note', made && ready)

  // Where the window was, so it can come back there.
  const place = 'JSON.stringify([window.__app.getState().view, window.__app.getState().selectedNoteId])'
  const left = current() ? await current().webContents.executeJavaScript(place) : null
  if (current()) await close(current())
  item('Main Window').click()
  ok('the Window menu brings the closed window back', await until(() => !!current()))
  const back = current() ? await current().webContents.executeJavaScript(place) : null
  ok('the window comes back with the note that was open', !!left && left.includes(',') && !left.endsWith('null]') && back === left, left + ' then ' + back)

  // The native parts (buttons, menus, sheets) wear the app's theme, not the system's.
  const w = current()
  if (w) {
    await until(() => w.webContents.executeJavaScript('!!(window.__app && window.__app.getState().ready)'))
    for (const theme of ['dark', 'light']) {
      await w.webContents.executeJavaScript(`window.__app.getState().setTheme('${theme}')`)
      ok('the native parts follow the ' + theme + ' theme', await until(() => nativeTheme.shouldUseDarkColors === (theme === 'dark')))
    }
  }
}

// Preloaded before Electron sets up its own modules, so `electron` is asked for once it has.
let app, BrowserWindow, Menu, nativeImage, nativeTheme, screen
setImmediate(() => {
  ;({ app, BrowserWindow, Menu, nativeImage, nativeTheme, screen } = require('electron'))
  // The first window runs the checks; windows the checks open again are theirs.
  app.once('browser-window-created', (_event, win) => watch(win))
})

function watch(win) {
  win.webContents.once('did-finish-load', () => {
    run(win)
      .catch((e) => lines.push('FAIL the probe threw: ' + ((e && e.stack) || e)))
      .finally(() => {
        fs.writeFileSync(path.join(out, 'results.txt'), lines.join('\n'))
        fs.writeFileSync(path.join(out, 'titlebar.json'), JSON.stringify(data, null, 2))
        app.quit()
      })
  })
}
