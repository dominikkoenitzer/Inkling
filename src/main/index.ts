import { app, BrowserWindow, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { openDb, startFailure } from './db'
import { registerIpc } from './ipc'
import * as repos from './repos'
import { seedDemo } from './seed'
import { startMcpHost } from './mcp/host'
import { watchOutsideWrites } from './watch'
import { CHROME, TITLEBAR_HEIGHT, themeOf } from './window'

// Test/demo hook: run against an isolated profile instead of the real one.
if (process.env['INKLING_USERDATA']) {
  app.setPath('userData', process.env['INKLING_USERDATA'])
}

// The seed, screenshot and eval hooks below work in unpackaged builds only.
const devHooks = !app.isPackaged

// `--mcp` serves the data to an AI assistant instead of opening the app. It takes no lock,
// so it runs next to an open window, and it never shows one.
const mcpMode = process.argv.includes('--mcp')
if (mcpMode) startMcpHost()

// Two copies on one database overwrite each other's notes. Electron keys this lock to the
// userData path, so it is taken after the hook above: a separate profile gets its own.
const isPrimary = !mcpMode && app.requestSingleInstanceLock()
if (!isPrimary && !mcpMode) app.quit()

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
  // Built in the saved theme from the first frame, so a light setup never flashes dark.
  const chrome = CHROME[themeOf(repos.getSetting('theme'))]
  const shotPath = devHooks ? process.env['INKLING_SCREENSHOT'] : undefined
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    show: false,
    // A capture renders off screen and never takes focus or a taskbar slot.
    ...(shotPath ? { x: -32000, y: -32000, skipTaskbar: true, focusable: false } : {}),
    backgroundColor: chrome.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...chrome, height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => (shotPath ? mainWindow?.showInactive() : mainWindow?.show()))
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
  if (shotPath) {
    mainWindow.webContents.on('did-finish-load', () => {
      const evalJs = process.env['INKLING_EVAL']
      // INKLING_EVAL_RESULT writes whatever the snippet resolves to, so a caller can read an
      // answer back out of the renderer without a channel of its own. With it set, the app
      // waits for the snippet instead of the fixed delay, which a long script would outrun.
      const resultPath = process.env['INKLING_EVAL_RESULT']

      const capture = async (): Promise<void> => {
        try {
          const image = await mainWindow!.webContents.capturePage()
          fs.writeFileSync(shotPath, image.toPNG())
        } finally {
          app.quit()
        }
      }

      if (evalJs) {
        setTimeout(() => {
          void mainWindow?.webContents
            .executeJavaScript(evalJs)
            .then((value) => {
              if (resultPath) fs.writeFileSync(resultPath, String(value ?? ''), 'utf8')
            })
            .catch(console.error)
            .finally(() => {
              if (resultPath) void capture()
            })
        }, 1500)
      }
      if (!evalJs || !resultPath) setTimeout(() => void capture(), 3500)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(() => {
  if (!isPrimary) return // quitting, or serving MCP: either way no window here
  const dataDir = app.getPath('userData')
  try {
    openDb(dataDir)
  } catch (err) {
    // Without its data the app cannot run: say so and quit, which frees the lock too. The details go to the log.
    console.error('opening the database failed', join(dataDir, 'inkling.db'), err)
    dialog.showErrorBox('Inkling could not start', startFailure(err))
    return app.quit()
  }
  // Clear anything that has sat in the trash past the retention window.
  try {
    repos.purgeExpiredNotes()
  } catch (err) {
    console.error('trash purge failed', err)
  }
  // Notes left completely empty last time go without a trace.
  try {
    repos.dropEmptyNotes()
  } catch (err) {
    console.error('dropping empty notes failed', err)
  }
  if (devHooks && process.env['INKLING_SEED']) seedDemo()
  // Tasks from before checkboxes lived only in notes get a note of their own, and rows for
  // empty lines go. No step may keep the window from opening.
  try {
    repos.adoptLooseTasks()
  } catch (err) {
    console.error('adopting loose tasks failed', err)
  }
  try {
    repos.dropBlankTasks()
  } catch (err) {
    console.error('dropping blank tasks failed', err)
  }
  // First run: a welcome note, no wizard.
  try {
    repos.bootstrapFirstRun()
  } catch (err) {
    console.error('first run setup failed', err)
  }
  // Test hook: the profile is set up, no window needed (the MCP check uses it).
  if (devHooks && process.env['INKLING_NO_WINDOW']) return app.quit()
  registerIpc()
  createMainWindow()
  watchOutsideWrites()

  // Packaged builds only, never in dev or during a headless capture.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('update check failed', err))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})



app.on('window-all-closed', () => {
  app.quit()
})
