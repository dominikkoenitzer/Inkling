// How long a start waits for the app or an assistant server to finish setting up a fresh profile.
export const SETUP_WAIT = 5000
const STEP = 50
// Once the data is in place, a setup lets go of the lock at once; an app that keeps it is open.
const RELEASE_WAIT = 1000

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Takes the app's lock. An assistant server holds it while it sets up a fresh profile, so a start
 * that finds no data yet waits for that setup instead of quitting.
 */
export async function takeLock(tryLock: () => boolean, ready: () => boolean, sleep = pause): Promise<boolean> {
  if (tryLock()) return true
  // Data in place means an open app holds the lock, and it gets the window.
  if (ready()) return false
  let readyFor = 0
  for (let waited = 0; waited < SETUP_WAIT && readyFor < RELEASE_WAIT; waited += STEP) {
    await sleep(STEP)
    if (tryLock()) return true
    if (ready()) readyFor += STEP
  }
  return false
}

/** Waits until `ready` holds or the setup wait runs out. */
export async function waitForSetup(ready: () => boolean, sleep = pause): Promise<void> {
  for (let waited = 0; waited < SETUP_WAIT && !ready(); waited += STEP) await sleep(STEP)
}
