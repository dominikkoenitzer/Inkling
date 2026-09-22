import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { openDb, getDb } from './db'
import { registerIpc } from './ipc'
import * as repos from './repos'

// Test/demo hook: run against an isolated profile instead of the real one.
if (process.env['INKLING_USERDATA']) {
  app.setPath('userData', process.env['INKLING_USERDATA'])
}

let mainWindow: BrowserWindow | null = null

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// The guard below covers the renderer directory, not a single file.
const rendererDir = pathToFileURL(join(__dirname, '../renderer')).href + '/'

/** Links leave the app for the web or a mail client, nothing else. */
function openExternalLink(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') return
  void shell.openExternal(parsed.href)
}

/** The app's own pages: the dev server origin, or a file in the bundled renderer. */
function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (isDev) return parsed.origin === new URL(process.env['ELECTRON_RENDERER_URL'] as string).origin
    parsed.hash = ''
    parsed.search = ''
    // The parser resolves any .. before this runs, so a traversal cannot match.
    return parsed.href.startsWith(rendererDir)
  } catch {
    return false
  }
}

/**
 * Nothing in the app navigates its own window, so a full navigation means a stray
 * target="_self". Send it to the browser instead of letting it replace the app.
 */
function blockOffAppNavigation(contents: Electron.WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openExternalLink(url)
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
    openExternalLink(url)
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

function seedDemo(): void {
  if (repos.listNotebooks().length > 0) return
  repos.bootstrapFirstRun('Biology 101')
  const nb = repos.listNotebooks()[0]
  const today = new Date()
  today.setHours(17, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000)
  repos.createTask({ notebook_id: nb.id, title: 'Finish reading Ch. 4', due_date: today.toISOString() })
  repos.createTask({ notebook_id: nb.id, title: 'Lab report draft', due_date: tomorrow.toISOString() })
  repos.createTask({ notebook_id: nb.id, title: 'Email study group' })
  repos.createGrade({ notebook_id: nb.id, title: 'Quiz 1', score: 5, max: 6, weight: 1, system: 'swiss' })
  repos.createGrade({ notebook_id: nb.id, title: 'Midterm', score: 4.5, max: 6, weight: 2, system: 'swiss' })
  const deck = repos.createDeckFromPairs(nb.id, 'Cell biology', [
    ['Photosynthesis', 'The process plants use to convert light into energy'],
    ['Mitochondria', 'The powerhouse of the cell'],
    ['Osmosis', 'Diffusion of water across a semipermeable membrane']
  ])
  seedHistory(deck.id)

  // A couple of neighbours so the notebook rail and the subject list are not a single item.
  const maths = repos.createNotebook({ name: 'Maths', color: 'coral' })
  repos.createNote({ notebook_id: maths.id, title: 'Integration by parts', content: page('Integration by parts', 'u dv = uv minus the integral of v du. Pick u so that du is simpler.') })
  repos.createTask({ notebook_id: maths.id, title: 'Problem set 7', due_date: tomorrow.toISOString() })
  repos.createGrade({ notebook_id: maths.id, title: 'Test 1', score: 5.5, max: 6, weight: 1, system: 'swiss' })
  const history = repos.createNotebook({ name: 'History', color: 'amber' })
  repos.createNote({ notebook_id: history.id, title: 'Cold War timeline', content: page('Cold War timeline', '1947 Truman Doctrine. 1961 Berlin Wall. 1989 it comes down.') })
}

/** A one-heading, one-paragraph TipTap document, for demo pages. */
function page(title: string, body: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
      { type: 'paragraph', content: [{ type: 'text', text: body }] }
    ]
  })
}

/** Demo study history for screenshots. Deterministic, and only behind INKLING_SEED. */
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
  if (process.env['INKLING_SEED']) seedDemo()
  // First run: one notebook and a welcome page, rather than a wizard asking for both.
  repos.bootstrapFirstRun()
  registerIpc()
  createMainWindow()

  // Packaged builds only, never in dev or during a headless capture.
  if (app.isPackaged && !process.env['INKLING_SCREENSHOT']) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('update check failed', err))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})



app.on('window-all-closed', () => {
  app.quit()
})
