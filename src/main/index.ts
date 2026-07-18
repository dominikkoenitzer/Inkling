import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import fs from 'fs'
import { openDb } from './db'
import { registerIpc } from './ipc'
import * as repos from './repos'

// Test/demo hook: run against an isolated profile instead of the real one.
if (process.env['INKLING_USERDATA']) {
  app.setPath('userData', process.env['INKLING_USERDATA'])
}

let mainWindow: BrowserWindow | null = null
let quickAddWindow: BrowserWindow | null = null

const isDev = !!process.env['ELECTRON_RENDERER_URL']

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
  repos.createGrade({ notebook_id: nb.id, title: 'Quiz 1', score: 5, max: 6, weight: 1 })
  repos.createDeckFromPairs(nb.id, 'Cell biology', [
    ['Photosynthesis', 'The process plants use to convert light into energy'],
    ['Mitochondria', 'The powerhouse of the cell'],
    ['Osmosis', 'Diffusion of water across a semipermeable membrane']
  ])
}

app.whenReady().then(() => {
  openDb()
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
