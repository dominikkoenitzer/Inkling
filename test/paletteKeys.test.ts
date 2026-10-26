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
})
