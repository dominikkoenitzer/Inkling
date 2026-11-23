import { app } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import { join, resolve } from 'path'
import os from 'os'
import { dataReady, getDb, openDb } from '../db'
import { settleData } from '../startup'
import { waitForSetup } from '../lock'

/**
 * A profile with no data yet gets it the way the app's first start makes it, under the app's own
 * lock, so the app or a second server never sets it up at the same time. An app started meanwhile
 * waits for it. Data already there, older ones included, is the app's to update.
 */
async function firstStart(dataDir: string): Promise<void> {
  const file = join(dataDir, 'inkling.db')
  if (fs.existsSync(file)) return
  if (!app.requestSingleInstanceLock()) return waitForSetup(() => dataReady(dataDir))
  try {
    // Test hook: keep the lock a while, so the MCP check can start the app inside it.
    const hold = app.isPackaged ? 0 : Number(process.env['INKLING_SETUP_HOLD'] ?? 0)
    if (hold > 0) {
      console.error('setup holds the lock')
      await new Promise((r) => setTimeout(r, hold))
    }
    // Whoever held the lock before has finished.
    if (fs.existsSync(file)) return
    openDb(dataDir)
    settleData()
  } catch (err) {
    console.error('Inkling could not set up its data:', err)
  } finally {
    try {
      getDb().close()
    } catch {
      // Never opened.
    }
    app.releaseSingleInstanceLock()
  }
}

/**
 * `Inkling --mcp`: no window and no updater, and the single-instance lock only while it sets up a
 * fresh profile. The Electron main process
 * gets no stdin on Windows, so the server runs in this same executable in Node mode, with the
 * client's pipes handed straight to it.
 */
export function startMcpHost(): void {
  // The client reads JSON-RPC from stdout; nothing else may land there.
  console.log = console.info = console.debug = (...args: unknown[]): void => console.error(...args)
  const dataDir = app.getPath('userData')
  // Before the path below changes, since the lock is keyed to it.
  const setup = firstStart(dataDir)
  // Chromium in this process keeps its files out of the profile the running app uses.
  const scratch = join(os.tmpdir(), 'inkling-mcp')
  app.setPath('userData', scratch)
  app.setPath('sessionData', scratch)
  app.disableHardwareAcceleration()
  app.dock?.hide()

  void setup.then(() => {
    const child = spawn(process.execPath, [join(__dirname, 'mcp.js')], {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        INKLING_MCP_DATA: dataDir,
        INKLING_MCP_VERSION: app.getVersion()
      }
    })
    child.on('error', (err) => {
      console.error('Inkling MCP server could not start:', err)
      app.exit(1)
    })
    child.on('exit', (code) => app.exit(code ?? 1))
  })

  // A Mac counts this process as the running app, so opening Inkling from Finder lands here.
  // Start the app itself; when it is already open, its own instance lock hands it the window.
  if (process.platform === 'darwin' && app.isPackaged) {
    app.on('activate', () => {
      const profile = process.env['INKLING_USERDATA']
      const env = profile ? ['--env', `INKLING_USERDATA=${profile}`] : []
      const opener = spawn('open', ['-n', ...env, resolve(process.execPath, '../../..')], { stdio: 'ignore', detached: true })
      opener.on('error', (err) => console.error('Inkling could not open the app:', err))
      opener.unref()
      app.dock?.hide()
    })
  }
}
