/**
 * Rebuilds docs/banner.png from the app icon and docs/notes.png.
 *
 *   bun run build && bun run banner
 *
 * Rasterised by Electron rather than a headless browser so the banner uses the same font
 * stack the app does. The window must be frameless with useContentSize, or the chrome eats
 * part of the 1200x600 layout and the output is clipped.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const electron = join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())
const work = mkdtempSync(join(tmpdir(), 'inkling-banner-'))

const icon = pathToFileURL(join(root, 'resources', 'icon-256.png')).href
const shot = pathToFileURL(join(root, 'docs', 'notes.png')).href

const html = `<!doctype html>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 600px; overflow: hidden; }
  body {
    background: #f4f2ee; position: relative; color: #1f1d1a;
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  }
  .left { position: absolute; left: 76px; top: 0; bottom: 0; width: 420px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 20px; }
  .brand img { width: 76px; height: 76px; border-radius: 17px; }
  .brand h1 { font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; font-size: 64px; font-weight: 600; letter-spacing: -1.5px; }
  .tagline { margin-top: 30px; font-size: 27px; line-height: 1.4; color: #6b665e; }
  .shot {
    position: absolute; left: 560px; top: 74px; width: 860px;
    border-radius: 12px; overflow: hidden; border: 1px solid #e8e4dd;
    box-shadow: 0 24px 60px rgba(30, 26, 20, 0.12), 0 2px 6px rgba(30, 26, 20, 0.06);
  }
  .shot img { width: 100%; display: block; }
</style>
<div class="left">
  <div class="brand"><img src="${icon}" alt="" /><h1>Inkling</h1></div>
  <div class="tagline">A calm place for your notes, to-dos and flashcards.</div>
</div>
<div class="shot"><img src="${shot}" alt="" /></div>
`

const page = join(work, 'banner.html')
writeFileSync(page, html, 'utf8')

const main = `
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
app.disableHardwareAcceleration()
// The capture comes out at the window's device scale factor; pin it so the banner is
// always 2400x1200 regardless of the display the script happens to run on.
app.commandLine.appendSwitch('force-device-scale-factor', '2')
app.commandLine.appendSwitch('high-dpi-support', '1')
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200, height: 600, useContentSize: true, frame: false, show: false,
    backgroundColor: '#f4f2ee',
    webPreferences: { zoomFactor: 1, offscreen: false }
  })
  await win.loadFile(${JSON.stringify(page)})
  await new Promise((r) => setTimeout(r, 1200))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(${JSON.stringify(join(root, 'docs', 'banner.png').replace(/\\/g, '/'))}, image.toPNG())
  app.quit()
})
`
const mainPath = join(work, 'main.js')
writeFileSync(mainPath, main, 'utf8')
writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'banner', main: 'main.js' }), 'utf8')

const args = process.platform === 'linux' ? [work, '--no-sandbox'] : [work]
const run = spawnSync(electron, args, {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: 'inherit',
  timeout: 60_000
})
rmSync(work, { recursive: true, force: true })
if (run.status !== 0) {
  console.error(`banner render failed (exit ${run.status})`)
  process.exit(1)
}
console.log('wrote docs/banner.png')
