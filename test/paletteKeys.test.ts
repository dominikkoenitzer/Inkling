import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = { inkling: {} }
})

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { CommandPalette } from '../src/renderer/src/components/shell/CommandPalette'

describe('CommandPalette', () => {
  it('keeps the results out of the Tab order, so the keys stay in the search box', () => {
    const html = renderToString(createElement(CommandPalette))
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) expect(b).toContain('tabindex="-1"')
  })

  it('reads as a combobox whose list points at the picked result', () => {
    const html = renderToString(createElement(CommandPalette))
    const attr = (tag: string, name: string): string | undefined => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1]
    const input = html.match(/<input[^>]*>/)?.[0] ?? ''
    const list = html.match(/<div[^>]*role="listbox"[^>]*>/)?.[0] ?? ''
    const options = html.match(/<button[^>]*>/g) ?? []
    const ids = options.map((o) => attr(o, 'id'))
    expect(attr(input, 'role')).toBe('combobox')
    expect(attr(input, 'aria-expanded')).toBe('true')
    expect(attr(input, 'aria-autocomplete')).toBe('list')
    expect(attr(list, 'id')).toBeTruthy()
    expect(attr(input, 'aria-controls')).toBe(attr(list, 'id'))
    expect(options.map((o) => attr(o, 'role'))).toEqual(options.map(() => 'option'))
    expect(new Set(ids).size).toBe(options.length)
    expect(ids.every(Boolean)).toBe(true)
    expect(options.map((o) => attr(o, 'aria-selected'))).toEqual(options.map((_, i) => String(i === 0)))
    expect(attr(input, 'aria-activedescendant')).toBe(ids[0])
  })
})
