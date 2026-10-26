import { describe, expect, it } from 'vitest'
import { firstSize } from '../src/main/window'

describe('firstSize', () => {
  it('opens at the usual size where the screen has room', () => {
    expect(firstSize({ width: 2560, height: 1415 })).toEqual({ width: 1360, height: 860 })
  })

  it('fits the space left by the menu bar and the Dock on a small screen', () => {
    expect(firstSize({ width: 1440, height: 801 })).toEqual({ width: 1360, height: 801 })
    expect(firstSize({ width: 1280, height: 672 })).toEqual({ width: 1280, height: 672 })
  })

  it('never goes below the smallest size the window allows', () => {
    expect(firstSize({ width: 800, height: 500 })).toEqual({ width: 860, height: 560 })
  })
})
