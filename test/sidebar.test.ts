import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  const never = (): Promise<never> => new Promise(() => {})
  ;(globalThis as unknown as { window: unknown }).window = {
    inkling: { notes: { list: vi.fn(never) }, decks: { list: vi.fn(never) } }
  }
})

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Sidebar } from '../src/renderer/src/components/shell/Sidebar'

describe('Sidebar', () => {
  it('says nothing about the notes before they have loaded', () => {
    const html = renderToString(createElement(Sidebar))
    expect(html).toContain('New note')
    expect(html).not.toContain('No notes yet.')
  })
})
