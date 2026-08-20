import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import fs from 'fs'
import { openDb, getDb } from './db'
import { registerIpc } from './ipc'
import * as repos from './repos'

// Test/demo hook: run against an isolated profile instead of the real one.
if (process.env['INKLING_USERDATA']) {
  app.setPath('userData', process.env['INKLING_USERDATA'])
}

let mainWindow: BrowserWindow | null = null
let quickAddWindow: BrowserWindow | null = null

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/**
 * Nothing in the app navigates its own window — links leave through
 * setWindowOpenHandler. A full navigation therefore means a stray target="_self"
 * or a renderer that has been talked into one, so send it to the browser
 * instead of letting it replace the app.
 */
function blockOffAppNavigation(contents: Electron.WebContents): void {
  contents.on('will-navigate', (event, url) => {
    const stays = isDev
      ? url.startsWith(process.env['ELECTRON_RENDERER_URL'] as string)
      : url.startsWith('file://')
    if (stays) return
    event.preventDefault()
    void shell.openExternal(url)
  })
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#191a1d',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#191a1d', symbolColor: '#b9bbc2', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  blockOffAppNavigation(mainWindow.webContents)

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Headless visual verification: INKLING_SCREENSHOT=<path> captures the window then quits.
  const shotPath = process.env['INKLING_SCREENSHOT']
  if (shotPath) {
    mainWindow.webContents.on('did-finish-load', () => {
      const evalJs = process.env['INKLING_EVAL']
      if (evalJs) {
        setTimeout(() => void mainWindow?.webContents.executeJavaScript(evalJs).catch(console.error), 1500)
      }
      setTimeout(async () => {
        try {
          const image = await mainWindow!.webContents.capturePage()
          fs.writeFileSync(shotPath, image.toPNG())
        } finally {
          app.quit()
        }
      }, 3500)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createQuickAddWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 132,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#26282c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (isDev) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/quickadd.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/quickadd.html'))
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  blockOffAppNavigation(win.webContents)
  win.on('blur', () => win.hide())
  return win
}

function toggleQuickAdd(): void {
  if (!quickAddWindow || quickAddWindow.isDestroyed()) {
    quickAddWindow = createQuickAddWindow()
  }
  if (quickAddWindow.isVisible()) {
    quickAddWindow.hide()
  } else {
    quickAddWindow.center()
    quickAddWindow.show()
    quickAddWindow.focus()
  }
}

function seedDemo(): void {
  if (repos.getSetting('onboarding_done')) return
  repos.completeOnboarding({ notebookName: 'Biology 101', purpose: 'school', journal: true })
  const nb = repos.listNotebooks()[0]
  const today = new Date()
  today.setHours(17, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000)
  repos.createTask({ notebook_id: nb.id, title: 'Finish reading Ch. 4', priority: 'high', due_date: today.toISOString() })
  repos.createTask({ notebook_id: nb.id, title: 'Lab report draft', due_date: tomorrow.toISOString() })
  repos.createTask({ notebook_id: nb.id, title: 'Email study group', priority: 'low' })
  repos.createGrade({ notebook_id: nb.id, title: 'Quiz 1', score: 5, max: 6, weight: 1, system: 'swiss' })
  const deck = repos.createDeckFromPairs(nb.id, 'Cell biology', [
    ['Photosynthesis', 'The process plants use to convert light into energy'],
    ['Mitochondria', 'The powerhouse of the cell'],
    ['Osmosis', 'Diffusion of water across a semipermeable membrane']
  ])
  seedHistory(deck.id)
}

/**
 * Demo-only study history, so the Progress view has something to draw in screenshots and
 * manual testing. Deterministic (no Math.random) so successive captures are identical.
 * Only ever runs behind INKLING_SEED on a fresh profile.
 */
function seedHistory(deckId: number): void {
  const db = getDb()
  const cardIds = (db.prepare(`SELECT id FROM flashcards WHERE deck_id = ?`).all(deckId) as Array<{ id: number }>).map((c) => c.id)
  if (cardIds.length === 0) return

  const logReview = db.prepare(
    `INSERT INTO review_log (card_id, deck_id, rating, state, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
     VALUES (?, ?, ?, 'review', ?, ?, ?, ?, ?)`
  )
  const logFocus = db.prepare(
    `INSERT INTO focus_sessions (task_id, deck_id, duration_minutes, started_at, completed) VALUES (NULL, ?, ?, ?, 1)`
  )

  const tx = db.transaction(() => {
    for (let daysAgo = 120; daysAgo >= 0; daysAgo--) {
      // A believable pattern: mostly-studied weekdays with occasional gaps.
      const day = new Date()
      day.setHours(19, 30, 0, 0)
      day.setDate(day.getDate() - daysAgo)
      const weekday = day.getDay()
      if (weekday === 0 && daysAgo % 3 !== 0) continue
      if ((daysAgo * 7) % 11 === 0) continue

      const count = 4 + ((daysAgo * 13) % 17)
      for (let i = 0; i < count; i++) {
        const at = new Date(day.getTime() + i * 45_000)
        const roll = (daysAgo * 31 + i * 7) % 100
        const rating = roll < 11 ? 1 : roll < 26 ? 2 : roll < 86 ? 3 : 4
        const stability = 2 + ((120 - daysAgo) / 120) * 40
        logReview.run(
          cardIds[i % cardIds.length],
          deckId,
          rating,
          stability,
          5.5,
          Math.max(0, stability * 0.9),
          stability,
          at.toISOString()
        )
      }
      if (daysAgo % 2 === 0) logFocus.run(deckId, 25, new Date(day.getTime() - 3_600_000).toISOString())
    }
  })
  tx()
}

app.whenReady().then(() => {
  openDb()
  // Clear anything that has sat in the trash past the retention window.
  try {
    repos.purgeExpiredNotes()
  } catch (err) {
    console.error('trash purge failed', err)
  }
  // First launch after the v0.4.0 tag index was added: derive tags from existing notes.
  try {
    if (repos.getSetting('tags_backfilled') !== '1') {
      repos.backfillTags()
      repos.setSetting('tags_backfilled', '1')
    }
  } catch (err) {
    console.error('tag backfill failed', err)
  }
  if (process.env['INKLING_SEED']) seedDemo()
  registerIpc(() => quickAddWindow?.hide())
  createMainWindow()

  globalShortcut.register('Control+Alt+N', toggleQuickAdd)

  // Auto-update against GitHub Releases — only for packaged builds, never during
  // dev or headless screenshot capture.
  if (app.isPackaged && !process.env['INKLING_SCREENSHOT']) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('update check failed', err))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  app.quit()
})
