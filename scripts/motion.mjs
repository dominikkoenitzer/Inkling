/**
 * Motion check: runs the built app on a throwaway seeded profile, steps every main interaction
 * frame by frame (once as is, once with reduced motion), checks that closing a sheet hands the
 * keyboard back at once, and lays each interaction out as a strip of frames.
 *
 *   bun run build && node scripts/motion.mjs [out]
 *
 * Frames, strips and results land in [out] (or MOTION_SHOTS, or a temp folder).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
if (!existsSync(join(electronDir, 'path.txt'))) {
  console.error('the electron binary is missing. run: node node_modules/electron/install.js')
  process.exit(1)
}
const electron = join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())
const outArg = process.argv[2] || process.env.MOTION_SHOTS
const out = outArg ? resolve(outArg) : mkdtempSync(join(tmpdir(), 'inkling-motion-'))

function capture(dir, reduced) {
  mkdirSync(dir, { recursive: true })
  const profile = mkdtempSync(join(tmpdir(), 'inkling-motion-profile-'))
  const run = spawnSync(
    electron,
    [
      root,
      // A capture window is never visible, so keep it from being treated as hidden and slowed.
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
      '--mute-audio',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        NODE_OPTIONS: `--require ${JSON.stringify(join(root, 'scripts', 'motion-probe.cjs'))}`,
        INKLING_USERDATA: profile,
        INKLING_SEED: '1',
        MOTION_OUT: dir,
        MOTION_REDUCED: reduced ? '1' : '0',
        INKLING_SCREENSHOT: join(profile, 'unused.png'),
        INKLING_EVAL: 'new Promise(() => {})',
        INKLING_EVAL_RESULT: join(profile, 'unused.txt')
      },
      stdio: 'inherit',
      timeout: 300_000
    }
  )
  rmSync(profile, { recursive: true, force: true })
  if (run.status !== 0 || !existsSync(join(dir, 'results.txt'))) {
    console.error(`the motion run did not complete (electron exit ${run.status})`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(join(dir, 'scenes.json'), 'utf8'))
}

/** One row per clip: the frames side by side, each labelled with its time and running animations. */
async function strips(dir, data) {
  const pad = 8
  const label = 22
  for (const scene of data.scenes) {
    const meta = await sharp(scene.frames[0].file).metadata()
    const scale = meta.width / data.width
    for (const [name, box] of Object.entries(scene.boxes)) {
      if (!box) continue
      const left = Math.max(0, Math.round(box.x * scale))
      const top = Math.max(0, Math.round(box.y * scale))
      const width = Math.min(meta.width - left, Math.round(box.w * scale))
      const height = Math.min(meta.height - top, Math.round(box.h * scale))
      if (width < 2 || height < 2) continue
      const tiles = []
      for (const [i, f] of scene.frames.entries()) {
        const x = pad + i * (width + pad)
        tiles.push({ input: await sharp(f.file).extract({ left, top, width, height }).png().toBuffer(), left: x, top: label + pad })
        const text = `${f.t} ms${f.running ? ` (${f.running} running)` : ''}`
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${label}"><text x="2" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#444">${text}</text></svg>`
        tiles.push({ input: Buffer.from(svg), left: x, top: pad })
      }
      const n = scene.frames.length
      await sharp({ create: { width: pad + n * (width + pad), height: label + height + pad * 2, channels: 3, background: '#e9e9e9' } })
        .composite(tiles)
        .png()
        .toFile(join(dir, `${scene.name}-${name}.png`))
    }
  }
}

let failed = 0
for (const [sub, reduced] of [
  ['normal', false],
  ['reduced', true]
]) {
  const dir = join(out, sub)
  const data = capture(dir, reduced)
  await strips(dir, data)
  const lines = readFileSync(join(dir, 'results.txt'), 'utf8').trim().split('\n').filter(Boolean)
  console.log(`${sub}:\n${lines.join('\n')}`)
  failed += lines.filter((l) => l.startsWith('FAIL')).length
}
console.log(`\nframes, strips and results: ${out}`)
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
