import { describe, expect, it } from 'vitest'
import fs from 'fs'
import { join } from 'path'

// Reads the theme tokens and the rules that use them straight from the stylesheet, so a colour change is checked as shipped.
const root = join(import.meta.dirname, '..')
const css = fs.readFileSync(join(root, 'src/renderer/src/styles/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

type Theme = 'light' | 'dark'
type Rgba = [number, number, number, number]

// Innermost rules only: a block that holds no other block. Statements such as @import end before the selector.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(';').pop()!.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
  decls: Object.fromEntries([...m[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]))
}))
const declsOf = (selector: string): Record<string, string> =>
  Object.assign({}, ...rules.filter((r) => r.selectors.includes(selector)).map((r) => r.decls))
const themeVars = (theme: Theme): Record<string, string> => declsOf(`:root[data-theme='${theme}']`)

const parse = (value: string): Rgba => {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba
  const rgba = value.match(/^rgba\(([^)]+)\)$/)
  if (rgba) return rgba[1].split(',').map(Number) as Rgba
  throw new Error(`not a colour: ${value}`)
}
const token = (theme: Theme, name: string): Rgba => {
  const value = themeVars(theme)[name]
  if (!value) throw new Error(`no ${name} in the ${theme} theme`)
  return parse(value)
}
// The colour a rule gives an element, its theme's own rule first; undefined when it inherits.
const ruleColour = (theme: Theme, selector: string): Rgba | undefined => {
  const value = declsOf(`:root[data-theme='${theme}'] ${selector}`).color ?? declsOf(selector).color
  const v = value?.match(/^var\((--[\w-]+)\)$/)
  return v ? token(theme, v[1]) : undefined
}

const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as Rgba
const luminance = (c: Rgba): number => {
  const [r, g, b] = c.slice(0, 3).map((v) => Math.round(v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: Rgba, b: Rgba): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const texts = ['--text-primary', '--text-muted', '--text-faint', '--accent-text', '--danger']
const surfaces = ['--bg-app', '--bg-panel', '--bg-raised']
// Hover and selected rows, and ::selection, lie over every surface.
const fills = ['--bg-hover', '--bg-active', '--accent-soft']

// Every pair under its floor, as "text on surface ratio", so a failure names what to fix.
const below = (pairs: Array<[string, Rgba, Rgba]>, floor: number): string[] =>
  pairs.filter(([, fg, bg]) => ratio(fg, bg) < floor).map(([name, fg, bg]) => `${name} ${ratio(fg, bg).toFixed(2)}`)

describe.each<Theme>(['light', 'dark'])('%s theme contrast', (theme) => {
  const t = (name: string): Rgba => token(theme, name)

  it('keeps text at 4.5:1 on app, panel and raised', () => {
    const pairs = texts.flatMap((fg) => surfaces.map((bg): [string, Rgba, Rgba] => [`${fg} on ${bg}`, t(fg), t(bg)]))
    expect(below(pairs, 4.5)).toEqual([])
  })

  it('keeps text at 4.5:1 on hover, selected and soft fills', () => {
    const pairs = texts.flatMap((fg) =>
      surfaces.flatMap((bg) => fills.map((fill): [string, Rgba, Rgba] => [`${fg} on ${fill} over ${bg}`, t(fg), over(t(fill), t(bg))]))
    )
    expect(below(pairs, 4.5)).toEqual([])
  })

  it('keeps text inside a highlight at 4.5:1', () => {
    const mark = t('--mark')
    const inMark = ruleColour(theme, '.tiptap mark')
    const link = ruleColour(theme, '.tiptap a') ?? t('--accent-text')
    const pairs: Array<[string, Rgba, Rgba]> = ['--text-primary', '--text-muted', '--text-faint'].map((fg) => [`${fg} in a highlight`, inMark ?? t(fg), mark])
    // A link can sit around a highlight or inside one.
    pairs.push(['highlight inside a link', inMark ?? link, mark])
    pairs.push(['link inside a highlight', ruleColour(theme, '.tiptap mark a') ?? link, mark])
    expect(below(pairs, 4.5)).toEqual([])
  })

  it('keeps the primary button text at 4.5:1 and the focus ring at 3:1', () => {
    expect(below([['--bg-raised on --accent', t('--bg-raised'), t('--accent')]], 4.5)).toEqual([])
    expect(below(surfaces.map((bg): [string, Rgba, Rgba] => [`--accent on ${bg}`, t('--accent'), t(bg)]), 3)).toEqual([])
  })
})
