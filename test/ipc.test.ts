import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The IPC handlers, called the way the renderer calls them, over mocked repos. */
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  setSetting: vi.fn(),
  reviewCard: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void mocks.handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {}
}))
vi.mock('better-sqlite3', () => ({ default: class {} }))
vi.mock('../src/main/repos', async (orig) => ({ ...(await orig<object>()), setSetting: mocks.setSetting, reviewCard: mocks.reviewCard }))

const { registerIpc } = await import('../src/main/ipc')

const call = (channel: string, ...args: unknown[]): unknown => mocks.handlers.get(channel)!({}, ...args)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  registerIpc()
})

describe('settings.set', () => {
  it('writes the theme', () => {
    call('settings.set', 'theme', 'dark')
    expect(mocks.setSetting).toHaveBeenCalledWith('theme', 'dark')
  })

  it('refuses a key the app does not write', () => {
    expect(() => call('settings.set', 'fsrs_params', '[1,2,3]')).toThrow()
    expect(mocks.setSetting).not.toHaveBeenCalled()
  })
})

describe('decks.review', () => {
  it('passes a known grade on', () => {
    call('decks.review', 4, 'good')
    expect(mocks.reviewCard).toHaveBeenCalledWith(4, 'good')
  })

  it('refuses a grade that is not one of the four', () => {
    for (const grade of ['perfect', 3, 'toString', undefined]) expect(() => call('decks.review', 4, grade)).toThrow()
    expect(mocks.reviewCard).not.toHaveBeenCalled()
  })
})
