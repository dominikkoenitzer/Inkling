import { afterEach, describe, expect, it, vi } from 'vitest'

/** Just enough of Electron for the main process to start up without a window on screen. */
const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const windows: unknown[] = []
  class BrowserWindow {
    static getAllWindows = (): unknown[] => windows
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() }
    on = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isDestroyed = vi.fn(() => false)
    isMinimized = vi.fn(() => true)
    restore = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    constructor() {
      windows.push(this)
    }
  }
  const app = {
    isPackaged: false,
    setPath: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => void handlers.set(event, fn)),
    whenReady: vi.fn(() => Promise.resolve())
  }
  return { app, BrowserWindow, handlers, windows, openDb: vi.fn() }
})

vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow, shell: { openExternal: vi.fn() } }))
vi.mock('electron-updater', () => ({ autoUpdater: { checkForUpdatesAndNotify: vi.fn() } }))
vi.mock('../src/main/db', () => ({ openDb: electron.openDb, getDb: vi.fn() }))
vi.mock('../src/main/ipc', () => ({ registerIpc: vi.fn() }))
vi.mock('../src/main/repos', () => ({ purgeExpiredNotes: vi.fn(), bootstrapFirstRun: vi.fn() }))

type FakeWindow = InstanceType<typeof electron.BrowserWindow>

/** Load the main process as a fresh launch, with or without the lock another copy may hold. */
async function launch(gotLock: boolean): Promise<void> {
  vi.resetModules()
  vi.clearAllMocks()
  electron.handlers.clear()
  electron.windows.length = 0
  electron.app.requestSingleInstanceLock.mockReturnValue(gotLock)
  await import('../src/main/index')
  await new Promise((resolve) => setTimeout(resolve, 0)) // let whenReady() settle
}

afterEach(() => {
  delete process.env['INKLING_USERDATA']
})

describe('one running copy per profile', () => {
  it('quits a second copy before it opens the database', async () => {
    await launch(false)

    expect(electron.app.quit).toHaveBeenCalled()
    expect(electron.openDb).not.toHaveBeenCalled()
    expect(electron.windows).toHaveLength(0)
  })

  it('brings the running window back when a second copy starts', async () => {
    await launch(true)
    expect(electron.app.quit).not.toHaveBeenCalled()
    expect(electron.windows).toHaveLength(1)
    const window = electron.windows[0] as FakeWindow

    electron.handlers.get('second-instance')?.()

    expect(window.restore).toHaveBeenCalled()
    expect(window.focus).toHaveBeenCalled()
  })

  it('takes the lock for the INKLING_USERDATA profile, not the default one', async () => {
    process.env['INKLING_USERDATA'] = 'C:\\temp\\inkling-smoke'
    await launch(true)

    expect(electron.app.setPath).toHaveBeenCalledWith('userData', 'C:\\temp\\inkling-smoke')
    const [setPathAt] = electron.app.setPath.mock.invocationCallOrder
    const [lockAt] = electron.app.requestSingleInstanceLock.mock.invocationCallOrder
    expect(lockAt).toBeGreaterThan(setPathAt)
  })
})
