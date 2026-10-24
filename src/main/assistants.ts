/**
 * One-click setup of Inkling's MCP server in the assistant apps on this computer. Each app
 * keeps a JSON file with an "mcpServers" list; connecting adds one entry there and leaves
 * everything else in the file exactly as it was. No Electron here, so tests point it at a
 * folder of their own.
 */
import fs from 'fs'
import os from 'os'
import { dirname, join } from 'path'
import type { AssistantId, AssistantStatus } from '@shared/types'

export type { AssistantId, AssistantStatus }

/** How an assistant starts Inkling's server. */
export interface Launch {
  command: string
  args: string[]
  env?: Record<string, string>
}

/** Where to look. Tests set `home` to a temporary folder and everything else follows from it. */
export interface Places {
  home: string
  appData: string
  localAppData: string
  platform: NodeJS.Platform
  /** Set when the terminal assistant keeps its files somewhere else than the home folder. */
  cliConfigDir?: string
}

type AssistantState = AssistantStatus['state']

const KEY = 'inkling'

/** The places of this computer, or of a stand-in home folder. */
export function placesFor(home?: string): Places {
  if (home) {
    return { home, appData: join(home, 'AppData', 'Roaming'), localAppData: join(home, 'AppData', 'Local'), platform: process.platform }
  }
  const h = os.homedir()
  return {
    home: h,
    appData: process.env['APPDATA'] || join(h, 'AppData', 'Roaming'),
    localAppData: process.env['LOCALAPPDATA'] || join(h, 'AppData', 'Local'),
    platform: process.platform,
    cliConfigDir: process.env['CLAUDE_CONFIG_DIR'] || undefined
  }
}

/** The desktop app's settings folder. The Store build on Windows keeps it inside its package. */
function desktopDir(p: Places): string {
  if (p.platform === 'darwin') return join(p.home, 'Library', 'Application Support', 'Claude')
  if (p.platform !== 'win32') return join(p.home, '.config', 'Claude')
  const packages = join(p.localAppData, 'Packages')
  try {
    for (const name of fs.readdirSync(packages)) {
      if (!name.startsWith('Claude_')) continue
      const dir = join(packages, name, 'LocalCache', 'Roaming', 'Claude')
      if (fs.existsSync(dir)) return dir
    }
  } catch {
    // no Packages folder
  }
  return join(p.appData, 'Claude')
}

interface Target {
  id: AssistantId
  name: string
  file: string
  installed: boolean
  entry: (l: Launch) => Record<string, unknown>
}

function targets(p: Places): Target[] {
  const desktop = desktopDir(p)
  const cliFile = join(p.cliConfigDir ?? p.home, '.claude.json')
  return [
    {
      id: 'desktop',
      name: 'Desktop assistant',
      file: join(desktop, 'claude_desktop_config.json'),
      installed: fs.existsSync(desktop),
      entry: (l) => ({ command: l.command, args: l.args, ...(l.env ? { env: l.env } : {}) })
    },
    {
      id: 'terminal',
      name: 'Terminal assistant',
      file: cliFile,
      // The terminal assistant writes this file on its first run.
      installed: fs.existsSync(cliFile),
      entry: (l) => ({ type: 'stdio', command: l.command, args: l.args, env: l.env ?? {} })
    }
  ]
}

/** The setup any MCP client takes, for "Copy setup". */
export function setupJson(l: Launch): string {
  return JSON.stringify({ mcpServers: { [KEY]: { command: l.command, args: l.args, ...(l.env ? { env: l.env } : {}) } } }, null, 2)
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** The file's JSON and how it was laid out. Missing or empty reads as {}. Throws on anything else. */
function readJson(file: string): { data: Json; bom: boolean; indent: string | number; newline: boolean; exists: boolean } {
  if (!fs.existsSync(file)) return { data: {}, bom: false, indent: 2, newline: true, exists: false }
  const raw = fs.readFileSync(file, 'utf8')
  const bom = raw.startsWith('\uFEFF')
  const text = bom ? raw.slice(1) : raw
  const data: unknown = text.trim() ? JSON.parse(text) : {}
  if (!isObject(data)) throw new Error('not a JSON object')
  const lead = /\n([ \t]+)"/.exec(text)?.[1]
  const indent = !lead ? 2 : lead.startsWith('\t') ? '\t' : lead.length
  return { data, bom, indent, newline: text.endsWith('\n') || !text.trim(), exists: true }
}

/** Inkling's key in a server list: ours by name, or an entry that starts some Inkling with --mcp. */
function findKey(servers: Json): string | null {
  if (KEY in servers) return KEY
  for (const [key, value] of Object.entries(servers)) {
    if (!isObject(value) || typeof value.command !== 'string' || !Array.isArray(value.args)) continue
    const words = [value.command, ...value.args.filter((a): a is string => typeof a === 'string')]
    if (words.some((w) => /inkling/i.test(w)) && value.args.includes('--mcp')) return key
  }
  return null
}

const sameLaunch = (value: unknown, l: Launch): boolean =>
  isObject(value) &&
  value.command === l.command &&
  JSON.stringify(value.args) === JSON.stringify(l.args) &&
  JSON.stringify(value.env ?? {}) === JSON.stringify(l.env ?? {})

function stateOf(t: Target, l: Launch): AssistantState {
  if (!t.installed) return 'missing'
  let data: Json
  try {
    data = readJson(t.file).data
  } catch {
    return 'unreadable'
  }
  const servers = isObject(data.mcpServers) ? data.mcpServers : {}
  const key = findKey(servers)
  if (key === null) return 'off'
  return sameLaunch(servers[key], l) ? 'on' : 'stale'
}

export function assistantStatus(p: Places, l: Launch): AssistantStatus[] {
  return targets(p).map((t) => ({ id: t.id, name: t.name, state: stateOf(t, l), file: t.file }))
}

const WRITE_FAILED = "Could not write the assistant's settings file."

/**
 * Rewrites a JSON file through `change`. The original is copied next to it while the new
 * one is written and checked, put back if anything fails, and removed afterwards.
 */
function rewrite(file: string, change: (data: Json) => void): void {
  let current: ReturnType<typeof readJson>
  try {
    current = readJson(file)
  } catch {
    throw new Error("The assistant's settings file is not valid JSON, so it was left alone. Fix it, or use Copy setup and add Inkling by hand.")
  }
  const before = JSON.stringify(current.data)
  change(current.data)
  if (current.exists && JSON.stringify(current.data) === before) return
  const text = (current.bom ? '\uFEFF' : '') + JSON.stringify(current.data, null, current.indent) + (current.newline ? '\n' : '')

  const copy = `${file}.inkling-backup`
  const temp = `${file}.inkling-tmp`
  let mode = 0o600
  try {
    if (current.exists) {
      mode = fs.statSync(file).mode & 0o777
      fs.copyFileSync(file, copy)
    } else fs.mkdirSync(dirname(file), { recursive: true })
  } catch (err) {
    throw new Error(WRITE_FAILED, { cause: err })
  }
  try {
    fs.writeFileSync(temp, text, { mode })
    try {
      fs.renameSync(temp, file)
    } catch {
      // Another program has the file open: write it in place, the copy still covers us.
      fs.writeFileSync(file, text)
    }
    JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (err) {
    try {
      if (current.exists) fs.copyFileSync(copy, file)
      else fs.rmSync(file, { force: true })
    } catch {
      // a file another program holds; the write's own error is the one kept
    }
    throw new Error(WRITE_FAILED, { cause: err })
  } finally {
    for (const f of current.exists ? [temp, copy] : [temp]) {
      try {
        fs.rmSync(f, { force: true })
      } catch {
        // not ours to remove (a folder of that name)
      }
    }
  }
}

function target(p: Places, id: AssistantId): Target {
  const t = targets(p).find((x) => x.id === id)
  if (!t) throw new Error(`unknown assistant: ${String(id)}`)
  if (!t.installed) throw new Error(`The ${t.name.toLowerCase()} is not on this computer.`)
  return t
}

/** Adds Inkling to the assistant's list, or points an old entry at this copy. */
export function connectAssistant(p: Places, id: AssistantId, l: Launch): AssistantStatus[] {
  const t = target(p, id)
  rewrite(t.file, (data) => {
    const servers = isObject(data.mcpServers) ? data.mcpServers : {}
    const key = findKey(servers) ?? KEY
    servers[key] = t.entry(l)
    data.mcpServers = servers
  })
  return assistantStatus(p, l)
}

/** Takes Inkling out of the assistant's list; every other server stays. */
export function disconnectAssistant(p: Places, id: AssistantId, l: Launch): AssistantStatus[] {
  const t = target(p, id)
  rewrite(t.file, (data) => {
    if (!isObject(data.mcpServers)) return
    const key = findKey(data.mcpServers)
    if (key === null) return
    delete data.mcpServers[key]
    // A list that only ever held Inkling goes too, so the file is as it was before Connect.
    if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers
  })
  return assistantStatus(p, l)
}
