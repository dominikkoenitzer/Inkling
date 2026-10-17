import { BrowserWindow } from 'electron'
import { getDb } from './db'

/** How often the app looks for writes from another process. The check is one pragma read. */
const EVERY_MS = 1500

/**
 * Tells the windows when another process, such as an assistant through the MCP server, has
 * committed to the database, so open views reload instead of waiting for the window to get
 * focus. SQLite bumps `data_version` only for commits from other connections.
 */
export function watchOutsideWrites(): void {
  const version = (): number | null => {
    try {
      return getDb().pragma('data_version', { simple: true }) as number
    } catch {
      return null
    }
  }
  let last = version()
  if (last === null) return
  setInterval(() => {
    const now = version()
    if (now === null || now === last) return
    last = now
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('data.changed')
    }
  }, EVERY_MS).unref()
}
