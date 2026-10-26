/**
 * Title bar check: runs the built app on a throwaway seeded profile and fails when anything in
 * the title bar sits under the window buttons, at three widths, in both themes, and in full
 * screen when the window may go on screen (CI). On macOS the button rects come from the real
 * window through the accessibility API; elsewhere from the window controls overlay.
 *
 *   bun run build && bun run titlebar
 *
 * Shots of every state and the measurements land in TITLEBAR_SHOTS, or a temp folder.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
if (!existsSync(join(electronDir, 'path.txt'))) {
  console.error('the electron binary is missing. run: node node_modules/electron/install.js')
  process.exit(1)
}
const electron = join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())

const out = process.env.TITLEBAR_SHOTS ? resolve(process.env.TITLEBAR_SHOTS) : mkdtempSync(join(tmpdir(), 'inkling-titlebar-'))
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'inkling-titlebar-profile-'))
// Off CI the window stays a capture window: off screen, never focused, no full screen.
const onScreen = !!process.env.CI

const run = spawnSync(electron, [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    NODE_OPTIONS: `--require ${JSON.stringify(join(root, 'scripts', 'titlebar-probe.cjs'))}`,
    INKLING_USERDATA: profile,
    INKLING_SEED: '1',
    TITLEBAR_OUT: out,
    TITLEBAR_ONSCREEN: onScreen ? '1' : '0',
    // Capture mode keeps the window off screen; the snippet never settles, so the probe decides when to quit.
    ...(onScreen
      ? {}
      : { INKLING_SCREENSHOT: join(profile, 'unused.png'), INKLING_EVAL: 'new Promise(() => {})', INKLING_EVAL_RESULT: join(profile, 'unused.txt') })
  },
  stdio: 'inherit',
  timeout: 180_000
})
rmSync(profile, { recursive: true, force: true })

const resultFile = join(out, 'results.txt')
if (run.status !== 0 || !existsSync(resultFile)) {
  console.error(`the title bar check did not complete (electron exit ${run.status})`)
  process.exit(1)
}
const lines = readFileSync(resultFile, 'utf8').trim().split('\n')
console.log(lines.join('\n'))
console.log(`\nshots and measurements: ${out}`)
const failed = lines.filter((l) => l.startsWith('FAIL'))
if (failed.length > 0 || lines.length === 0) {
  console.error(`\n${failed.length} check(s) failed`)
  process.exit(1)
}
console.log(`\nall ${lines.length} checks passed`)
