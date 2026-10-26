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
  return JSON.stringify({ items, area, header: r(h.getBoundingClientRect()), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio })
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
  const scale = width / bounds.width
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
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(out, 'web-' + name + '.png'), image.toPNG())
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

  if (onScreen) {
    for (const theme of ['light', 'dark']) {
      await state(`setTheme('${theme}')`)
      const entered = new Promise((res) => win.once('enter-full-screen', res))
      win.setFullScreen(true)
      await Promise.race([entered, wait(5000)])
      await wait(1500)
      await measure(win, theme + '-fullscreen', gap)
      const left = new Promise((res) => win.once('leave-full-screen', res))
      win.setFullScreen(false)
      await Promise.race([left, wait(5000)])
      await wait(1500)
    }
  }

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
  }
  data.menu = menuOf(Menu.getApplicationMenu())
}

// Preloaded before Electron sets up its own modules, so `electron` is asked for once it has.
let app, Menu, nativeImage
setImmediate(() => {
  ;({ app, Menu, nativeImage } = require('electron'))
  app.on('browser-window-created', (_event, win) => watch(win))
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
