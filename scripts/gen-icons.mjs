/**
 * Regenerates every raster app icon from resources/logo.svg.
 *
 * The SVG is the single source of truth for the brand mark; run this after
 * changing it so the .png/.ico set never drifts from the vector.
 *
 *   bun run icons
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = (name) => join(root, 'resources', name)

// Sizes shipped in resources/. 256 doubles as the canonical icon.png.
const SIZES = [16, 24, 32, 48, 64, 128, 256]
// Windows .ico bundles these; >256 is not supported by the BMP-based format.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
// At and below this size the detailed mark's mouth/cheeks render as mush, so
// the simplified variant is used instead.
const SMALL_MAX = 24

const detailed = await readFile(join(root, 'resources', 'logo.svg'))
const small = await readFile(join(root, 'resources', 'logo-small.svg'))

const render = (size) =>
  sharp(size <= SMALL_MAX ? small : detailed, { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer()

for (const size of SIZES) {
  await writeFile(out(`icon-${size}.png`), await render(size))
  console.log(`  icon-${size}.png`)
}

// icon.png is what electron-builder uses for macOS/Linux; keep it at 256.
await writeFile(out('icon.png'), await render(256))
console.log('  icon.png (256)')

const icoBuffers = await Promise.all(ICO_SIZES.map(render))
await writeFile(out('icon.ico'), await pngToIco(icoBuffers))
console.log(`  icon.ico (${ICO_SIZES.join(', ')})`)

console.log('\nIcons regenerated from resources/logo.svg')
