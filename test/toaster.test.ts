import { afterEach, describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = { inkling: {} }
})

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Toaster } from '../src/renderer/src/components/ui'
import { useApp } from '../src/renderer/src/stores/app'

const regions = (html: string): string[] => html.match(/<[a-z]+[^>]*role="status"[^>]*>[^<]*<\/[a-z]+>/g) ?? []

describe('Toaster', () => {
  afterEach(() => {
    useApp.getInitialState().toast = null
  })

  it('keeps one empty live region with no toast up', () => {
    const html = renderToString(createElement(Toaster))
    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(regions(html).map((r) => r.replace(/<[^>]*>/g, ''))).toEqual([''])
  })

  it('puts only the message in that region', () => {
    // A server render reads the store's first state object, so the toast goes in there for this one render.
    useApp.getInitialState().toast = { id: 7, message: 'Note deleted', actionLabel: 'Undo', onAction: () => {} }
    const html = renderToString(createElement(Toaster))
    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(regions(html).map((r) => r.replace(/<[^>]*>/g, ''))).toEqual(['Note deleted'])
  })
})
