import { describe, expect, it } from 'vitest'
import config from '../electron.vite.config'

describe('renderer build', () => {
  it('ships the renderer minified, with function names kept for stack traces', () => {
    const build = config.renderer?.build
    expect(build?.minify).toBe(true)
    const output = build?.rolldownOptions?.output
    expect(Array.isArray(output) ? undefined : output?.keepNames).toBe(true)
  })
})
