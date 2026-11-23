import { describe, expect, it } from 'vitest'
import { SETUP_WAIT, takeLock, waitForSetup } from '../src/main/lock'

/** A clock that only moves when the code under test sleeps. */
function clock() {
  let now = 0
  return { now: () => now, sleep: async (ms: number) => void (now += ms) }
}

describe('takeLock', () => {
  it('takes a free lock at once', async () => {
    const c = clock()
    expect(await takeLock(() => true, () => false, c.sleep)).toBe(true)
    expect(c.now()).toBe(0)
  })

  it('hands over at once to an open app', async () => {
    const c = clock()
    let tries = 0
    expect(await takeLock(() => (tries++, false), () => true, c.sleep)).toBe(false)
    expect([tries, c.now()]).toEqual([1, 0])
  })

  // Inkling started while an assistant server sets up a fresh profile opens once that is done.
  it('waits while a server sets up a fresh profile, then opens', async () => {
    const c = clock()
    const ready = () => c.now() >= 1500
    const free = () => c.now() >= 1550
    expect(await takeLock(free, ready, c.sleep)).toBe(true)
    expect(c.now()).toBe(1550)
  })

  it('opens when a setup failed and let go of the lock without data', async () => {
    const c = clock()
    expect(await takeLock(() => c.now() >= 300, () => false, c.sleep)).toBe(true)
  })

  it('hands over to an app that set the profile up itself and keeps the lock', async () => {
    const c = clock()
    expect(await takeLock(() => false, () => c.now() >= 200, c.sleep)).toBe(false)
    expect(c.now()).toBeLessThan(SETUP_WAIT)
  })

  it('gives up after the setup wait when nothing moves', async () => {
    const c = clock()
    expect(await takeLock(() => false, () => false, c.sleep)).toBe(false)
    expect(c.now()).toBe(SETUP_WAIT)
  })
})

describe('waitForSetup', () => {
  it('returns once the data is ready, or after the setup wait', async () => {
    const c = clock()
    await waitForSetup(() => c.now() >= 400, c.sleep)
    expect(c.now()).toBe(400)
    const d = clock()
    await waitForSetup(() => false, d.sleep)
    expect(d.now()).toBe(SETUP_WAIT)
  })
})
