import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = { inkling: {} }
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandPalette } from '../src/renderer/src/components/shell/CommandPalette'
import { ReviewSession } from '../src/renderer/src/components/study/ReviewSession'
import type { Deck } from '../src/shared/types'

describe('search palette', () => {
  it('ends a name too long for the panel with an ellipsis instead of cutting it off', () => {
    const html = renderToStaticMarkup(createElement(CommandPalette))
    const label = html.match(/<span class="([^"]*)">New note<\/span>/)?.[1].split(' ') ?? []
    expect(label).toContain('truncate')
    expect(label).toContain('min-w-0')
    expect(label).not.toContain('shrink-0')
  })
})

describe('review session', () => {
  it('scrolls a card taller than a zoomed window instead of cutting off its top and the grades', () => {
    const deck = { id: 1, name: 'Throwaway' } as Deck
    const html = renderToStaticMarkup(createElement(ReviewSession, { deck, onDone: () => {} }))
    const area = html.match(/<div class="([^"]*)"><div class="motion-rise text-muted">Loading cards/)?.[1].split(' ') ?? []
    expect(area).toContain('overflow-y-auto')
    expect(area).toContain('justify-center-safe')
    expect(area).not.toContain('justify-center')
  })
})
