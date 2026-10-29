import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ALIASES: Array<[string, string]> = [
  ['@/', resolve(root, 'src/renderer/src')],
  ['@shared/', resolve(root, 'src/shared')]
]

function resolveLocal(from: string, spec: string): string | null {
  const alias = ALIASES.find(([prefix]) => spec.startsWith(prefix))
  const base = alias ? resolve(alias[1], spec.slice(alias[0].length)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  const file = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext).find((f) => existsSync(f) && statSync(f).isFile())
  return file ?? null
}

/** The static, non-type imports of one file. */
function importsOf(source: string): string[] {
  return [
    ...Array.from(source.matchAll(/^(?:import|export)\s+(?!type\s)[^'"]*?\sfrom\s+(['"])([^'"]+)\1/gm), (m) => m[2]),
    ...Array.from(source.matchAll(/^import\s+(['"])([^'"]+)\1/gm), (m) => m[2])
  ]
}

/** Every package the renderer loads before any lazy chunk: static, non-type imports from the entry on. */
function firstLoadPackages(entry: string): Set<string> {
  const seen = new Set<string>()
  const packages = new Set<string>()
  const walk = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      const local = resolveLocal(file, spec)
      if (local) walk(local)
      else if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('@shared/')) packages.add(spec)
    }
  }
  walk(entry)
  return packages
}

describe('first load', () => {
  it('reads imports in either quote style', () => {
    const source = ['import { a } from "@tiptap/core"', "import './b.css'", 'import "c"', "export * from 'd'"].join('\n')
    expect(importsOf(source).sort()).toEqual(['./b.css', '@tiptap/core', 'c', 'd'])
  })

  it('leaves the editor libraries to the note chunk', () => {
    const packages = Array.from(firstLoadPackages(resolve(root, 'src/renderer/src/main.tsx')))
    expect(packages).toContain('react')
    expect(packages.filter((p) => p.startsWith('@tiptap/') || p.startsWith('prosemirror'))).toEqual([])
  })
})
