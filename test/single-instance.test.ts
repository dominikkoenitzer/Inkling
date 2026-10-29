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
    getPath: vi.fn(() => '/home/profile'),
    getVersion: vi.fn(() => '1.0.0'),
    setPath: vi.fn(),
    exit: vi.fn(),
    disableHardwareAcceleration: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => void handlers.set(event, fn)),
    whenReady: vi.fn(() => Promise.resolve())
  }
  const spawn = vi.fn(() => ({ on: vi.fn() }))
  const dialog = { showErrorBox: vi.fn() }
  // The db module as the app last loaded it, so errors raised from it match its own classes.
  const realDb: Partial<typeof import('../src/main/db')> = {}
  return { app, BrowserWindow, dialog, handlers, windows, openDb: vi.fn(), realDb, spawn }
})

vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow, dialog: electron.dialog, shell: { openExternal: vi.fn() } }))
vi.mock('electron-updater', () => ({ autoUpdater: { checkForUpdatesAndNotify: vi.fn() } }))
vi.mock('../src/main/db', async (importOriginal) => {
  Object.assign(electron.realDb, await importOriginal<typeof import('../src/main/db')>())
  return { openDb: electron.openDb, getDb: vi.fn(), startFailure: electron.realDb.startFailure }
})
vi.mock('../src/main/ipc', () => ({ registerIpc: vi.fn() }))
vi.mock('child_process', () => ({ spawn: electron.spawn }))
vi.mock('../src/main/repos', () => ({ purgeExpiredNotes: vi.fn(), adoptLooseTasks: vi.fn(), dropBlankTasks: vi.fn(), bootstrapFirstRun: vi.fn(), getSetting: vi.fn(() => null) }))

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
  process.argv = process.argv.filter((a) => a !== '--mcp')
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

describe('a database that cannot be opened', () => {
  it('says so in one plain sentence and quits instead of hanging without a window', async () => {
    electron.openDb.mockImplementationOnce(() => {
      throw new Error('file is not a database')
    })
    await launch(true)

    expect(electron.dialog.showErrorBox).toHaveBeenCalledTimes(1)
    const [, message] = electron.dialog.showErrorBox.mock.calls[0] as unknown as [string, string]
    expect(message).toBe('Inkling could not open its data.')
    expect(electron.app.quit).toHaveBeenCalled()
    expect(electron.windows).toHaveLength(0)
  })

  it('tells the user to update when the data comes from a newer Inkling', async () => {
    electron.openDb.mockImplementationOnce(() => electron.realDb.checkVersion!({ pragma: () => 1000 } as never))
    await launch(true)

    expect(electron.dialog.showErrorBox).toHaveBeenCalledTimes(1)
    const [, message] = electron.dialog.showErrorBox.mock.calls[0] as unknown as [string, string]
    expect(message).toBe('Your Inkling data is newer than this copy of Inkling. Update Inkling, then try again.')
    expect(electron.app.quit).toHaveBeenCalled()
    expect(electron.windows).toHaveLength(0)
  })
})

describe('--mcp', () => {
  it('starts the server in a Node-mode copy and leaves the lock, the window and the database alone', async () => {
    process.argv.push('--mcp')
    await launch(true)

    expect(electron.app.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
    expect(electron.openDb).not.toHaveBeenCalled()
    expect(electron.windows).toHaveLength(0)
    expect(electron.spawn).toHaveBeenCalledTimes(1)
    const [, args, options] = electron.spawn.mock.calls[0] as unknown as [string, string[], { stdio: string; env: Record<string, string> }]
    expect(args[0]).toMatch(/mcp\.js$/)
    expect(options.stdio).toBe('inherit')
    expect(options.env['ELECTRON_RUN_AS_NODE']).toBe('1')
    expect(options.env['INKLING_MCP_DATA']).toBe('/home/profile')
  })

  it('serves the INKLING_USERDATA profile and keeps Chromium out of it', async () => {
    process.env['INKLING_USERDATA'] = '/tmp/inkling-mcp-smoke'
    electron.app.getPath.mockImplementationOnce(() => '/tmp/inkling-mcp-smoke')
    process.argv.push('--mcp')
    await launch(true)

    const options = (electron.spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }])[2]
    expect(options.env['INKLING_MCP_DATA']).toBe('/tmp/inkling-mcp-smoke')
    expect(electron.app.setPath).toHaveBeenCalledWith('sessionData', expect.stringContaining('inkling-mcp'))
  })
})
