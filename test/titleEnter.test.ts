import { describe, it, expect } from 'vitest'
import { focusBody } from '../src/renderer/src/lib/editorKeys'

/** An editor whose focus command, like the real one, sets the caret now and takes focus a frame later. */
function fakeEditor(): { editor: Parameters<typeof focusBody>[0]; state: { focused: string; caret: string | null }; frame: () => void } {
  const state = { focused: 'title', caret: null as string | null }
  const frames: Array<() => void> = []
  const editor = {
    commands: {
      focus: (position: 'start') => {
        state.caret = position
        frames.push(() => (state.focused = 'body'))
        return true
      }
    },
    view: { focus: () => (state.focused = 'body') }
  }
  return { editor, state, frame: () => frames.splice(0).forEach((f) => f()) }
}

describe('focusBody', () => {
  it('moves focus to the body before the next frame, so text sent right after Enter lands there', () => {
    const { editor, state } = fakeEditor()
    focusBody(editor)
    expect(state.focused).toBe('body')
  })

  it('puts the caret at the start of the body', () => {
    const { editor, state, frame } = fakeEditor()
    focusBody(editor)
    frame()
    expect(state.caret).toBe('start')
    expect(state.focused).toBe('body')
  })
})
