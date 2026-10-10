import { app } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import os from 'os'

/**
 * `Inkling --mcp`: no window, no single-instance lock, no updater. The Electron main process
 * gets no stdin on Windows, so the server runs in this same executable in Node mode, with the
 * client's pipes handed straight to it.
 */
export function startMcpHost(): void {
  // The client reads JSON-RPC from stdout; nothing else may land there.
  console.log = console.info = console.debug = (...args: unknown[]): void => console.error(...args)
  const dataDir = app.getPath('userData')
  // Chromium in this process keeps its files out of the profile the running app uses.
  const scratch = join(os.tmpdir(), 'inkling-mcp')
  app.setPath('userData', scratch)
  app.setPath('sessionData', scratch)
  app.disableHardwareAcceleration()
  app.dock?.hide()

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
}
