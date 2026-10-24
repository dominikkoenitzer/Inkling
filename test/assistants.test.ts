import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { assistantStatus, connectAssistant, disconnectAssistant, setupJson, type Launch, type Places } from '../src/main/assistants'

// Every test works in a folder of its own; nothing here reads or writes a real home folder.
let home: string
let places: Places
const launch: Launch = { command: '/Apps/Inkling/Inkling', args: ['--mcp'] }

const desktopFile = (): string => join(home, '.config', 'Claude', 'claude_desktop_config.json')
const cliFile = (): string => join(home, '.claude.json')
const write = (file: string, text: string): void => {
  fs.mkdirSync(join(file, '..'), { recursive: true })
  fs.writeFileSync(file, text)
}
const read = (file: string): Record<string, unknown> => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const states = (): Record<string, string> => Object.fromEntries(assistantStatus(places, launch).map((a) => [a.id, a.state]))
const leftovers = (dir: string): string[] => fs.readdirSync(dir).filter((f) => f.includes('.inkling-'))

beforeEach(() => {
  home = fs.mkdtempSync(join(os.tmpdir(), 'inkling-assistants-'))
  places = { home, appData: join(home, 'AppData', 'Roaming'), localAppData: join(home, 'AppData', 'Local'), platform: 'linux' }
})

afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

describe('assistantStatus', () => {
  it('finds nothing in an empty home', () => {
    expect(states()).toEqual({ 'desktop': 'missing', 'terminal': 'missing' })
  })

  it('tells installed, connected, another copy and a broken file apart', () => {
    fs.mkdirSync(join(home, '.config', 'Claude'), { recursive: true })
    write(cliFile(), JSON.stringify({ mcpServers: { inkling: { type: 'stdio', command: '/old/Inkling', args: ['--mcp'] } } }))
    expect(states()).toEqual({ 'desktop': 'off', 'terminal': 'stale' })

    write(desktopFile(), '{ "mcpServers": { ')
    expect(states()['desktop']).toBe('unreadable')
  })

  it('looks inside the Store package on Windows, then in AppData', () => {
    const win: Places = { ...places, platform: 'win32' }
    fs.mkdirSync(join(home, 'AppData', 'Roaming', 'Claude'), { recursive: true })
    expect(assistantStatus(win, launch)[0].file).toBe(join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'))
    const pkg = join(home, 'AppData', 'Local', 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude')
    fs.mkdirSync(pkg, { recursive: true })
    expect(assistantStatus(win, launch)[0]).toMatchObject({ state: 'off', file: join(pkg, 'claude_desktop_config.json') })
  })
})

describe('connectAssistant', () => {
  it('adds Inkling and keeps every other server and setting as it was', () => {
    const before = {
      numStartups: 12,
      projects: { '/code': { allowedTools: ['Read'] } },
      mcpServers: { files: { type: 'stdio', command: 'files-server', args: ['--root', '/x'], env: { A: '1' } } }
    }
    write(cliFile(), JSON.stringify(before, null, 2) + '\n')
    connectAssistant(places, 'terminal', launch)

    const after = read(cliFile())
    expect(after).toEqual({
      ...before,
      mcpServers: { ...before.mcpServers, inkling: { type: 'stdio', command: launch.command, args: ['--mcp'], env: {} } }
    })
    expect(fs.readFileSync(cliFile(), 'utf8').endsWith('}\n')).toBe(true)
    expect(states()['terminal']).toBe('on')
    expect(leftovers(home)).toEqual([])
  })

  it('makes the desktop file when the app has none yet, and keeps tabs and a BOM', () => {
    fs.mkdirSync(join(home, '.config', 'Claude'), { recursive: true })
    connectAssistant(places, 'desktop', launch)
    expect(read(desktopFile())).toEqual({ mcpServers: { inkling: { command: launch.command, args: ['--mcp'] } } })

    write(desktopFile(), '\uFEFF{\n\t"theme": "dark"\n}')
    connectAssistant(places, 'desktop', launch)
    const text = fs.readFileSync(desktopFile(), 'utf8')
    expect(text.startsWith('\uFEFF{\n\t"theme"')).toBe(true)
    expect(read(desktopFile())).toEqual({ theme: 'dark', mcpServers: { inkling: { command: launch.command, args: ['--mcp'] } } })
  })

  it('points an old entry at this copy under the name it already has', () => {
    write(cliFile(), JSON.stringify({ mcpServers: { notes: { command: 'C:\\Old\\Inkling.exe', args: ['--mcp'] } } }))
    connectAssistant(places, 'terminal', launch)
    expect(Object.keys(read(cliFile()).mcpServers as object)).toEqual(['notes'])
    expect(states()['terminal']).toBe('on')
  })

  it('leaves a broken file untouched and says so', () => {
    write(cliFile(), '{ broken')
    expect(() => connectAssistant(places, 'terminal', launch)).toThrow(/not valid JSON, so it was left alone/)
    expect(fs.readFileSync(cliFile(), 'utf8')).toBe('{ broken')
    expect(leftovers(home)).toEqual([])
  })

  it('refuses an assistant that is not installed', () => {
    expect(() => connectAssistant(places, 'desktop', launch)).toThrow(/not on this computer/)
    expect(fs.existsSync(desktopFile())).toBe(false)
  })

  it('puts the original back when the new file cannot be written', () => {
    const original = JSON.stringify({ keep: true })
    write(cliFile(), original)
    // A folder where the temporary file goes makes the write fail half-way.
    fs.mkdirSync(`${cliFile()}.inkling-tmp`)
    expect(() => connectAssistant(places, 'terminal', launch)).toThrow(/Could not write/)
    expect(fs.readFileSync(cliFile(), 'utf8')).toBe(original)
    expect(fs.existsSync(`${cliFile()}.inkling-backup`)).toBe(false)
  })

  it('says one plain sentence, without the system error, when the file cannot be written', () => {
    const original = JSON.stringify({ keep: true })
    write(cliFile(), original)
    fs.mkdirSync(`${cliFile()}.inkling-tmp`)
    expect(() => connectAssistant(places, 'terminal', launch)).toThrow(/^Could not write the assistant's settings file\.$/)
    fs.rmdirSync(`${cliFile()}.inkling-tmp`)
    // A folder where the copy of the original goes makes the write fail before it starts.
    fs.mkdirSync(`${cliFile()}.inkling-backup`)
    expect(() => connectAssistant(places, 'terminal', launch)).toThrow(/^Could not write the assistant's settings file\.$/)
    expect(fs.readFileSync(cliFile(), 'utf8')).toBe(original)
  })

  it('says the same sentence when another program holds the file and it cannot be put back', () => {
    const original = JSON.stringify({ keep: true })
    write(cliFile(), original)
    const file = cliFile()
    const busy = (): never => {
      throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${file}'`), { code: 'EBUSY' })
    }
    const writeFile = fs.writeFileSync
    const copyFile = fs.copyFileSync
    vi.spyOn(fs, 'renameSync').mockImplementation(busy)
    vi.spyOn(fs, 'writeFileSync').mockImplementation((f, data, options) => (f === file ? busy() : writeFile(f, data, options)))
    vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, mode) => (to === file ? busy() : copyFile(from, to, mode)))
    try {
      expect(() => connectAssistant(places, 'terminal', launch)).toThrow(/^Could not write the assistant's settings file\.$/)
    } finally {
      vi.restoreAllMocks()
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(leftovers(home)).toEqual([])
  })
})

describe('disconnectAssistant', () => {
  it('takes only Inkling out', () => {
    write(cliFile(), JSON.stringify({ mcpServers: { files: { command: 'f', args: [] } }, other: 1 }))
    connectAssistant(places, 'terminal', launch)
    disconnectAssistant(places, 'terminal', launch)
    expect(read(cliFile())).toEqual({ mcpServers: { files: { command: 'f', args: [] } }, other: 1 })
    expect(states()['terminal']).toBe('off')
  })

  it('leaves the file as it was before Connect', () => {
    fs.mkdirSync(join(home, '.config', 'Claude'), { recursive: true })
    const text = JSON.stringify({ preferences: { sidebar: 'open' } }, null, 2) + '\n'
    write(desktopFile(), text)
    connectAssistant(places, 'desktop', launch)
    disconnectAssistant(places, 'desktop', launch)
    expect(fs.readFileSync(desktopFile(), 'utf8')).toBe(text)
  })

  it('does not rewrite a file that has no Inkling in it', () => {
    const text = '{"compact":true}'
    write(cliFile(), text)
    disconnectAssistant(places, 'terminal', launch)
    expect(fs.readFileSync(cliFile(), 'utf8')).toBe(text)
  })
})

describe('setupJson', () => {
  it('is the entry any MCP client takes, with the profile when there is one', () => {
    expect(JSON.parse(setupJson(launch))).toEqual({ mcpServers: { inkling: { command: launch.command, args: ['--mcp'] } } })
    const withProfile = JSON.parse(setupJson({ ...launch, env: { INKLING_USERDATA: '/tmp/p' } }))
    expect(withProfile.mcpServers.inkling.env).toEqual({ INKLING_USERDATA: '/tmp/p' })
  })
})
