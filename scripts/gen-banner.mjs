/**
 * Rebuilds docs/banner.png from the app's own icon and a current screenshot.
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
const shot = pathToFileURL(join(root, 'docs', 'today.png')).href

const html = `<!doctype html>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { width: 1200px; height: 600px; overflow: hidden; }
  body {
    width: 1200px; height: 600px; overflow: hidden;
    background: radial-gradient(900px 600px at 8% 30%, #12222b 0%, #0b0d10 55%, #08090b 100%);
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    color: #e8e9ec; position: relative;
  }
  .left { position: absolute; left: 72px; top: 74px; width: 452px; }
  .brand { display: flex; align-items: center; gap: 22px; }
  .brand img { width: 86px; height: 86px; border-radius: 20px; }
  .brand h1 { font-size: 70px; font-weight: 700; letter-spacing: -2px; line-height: 1; }
  .tagline { margin-top: 40px; font-size: 29px; line-height: 1.3; color: #c9ccd2; font-weight: 400; }
  .tagline b { display: block; color: #2fbf87; font-weight: 700; margin-top: 6px; }
  .pills { margin-top: 46px; display: flex; flex-wrap: wrap; gap: 12px; max-width: 452px; }
  .pill {
    border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.035);
    border-radius: 999px; padding: 11px 20px; font-size: 19px; font-weight: 600; color: #dfe2e7;
  }
  .shot {
    position: absolute; right: -70px; top: 96px; width: 700px;
    border-radius: 14px; overflow: hidden;
    box-shadow: 0 50px 90px rgba(0,0,0,0.6);
    transform: perspective(2000px) rotateY(-14deg) rotateX(2deg) rotate(-1.5deg);
    transform-origin: left center;
  }
  .shot img { width: 100%; display: block; }
</style>
<div class="left">
  <div class="brand"><img src="${icon}" alt="" /><h1>Inkling</h1></div>
  <div class="tagline">Notes, tasks, flashcards and grades.<b>Studying, made fun.</b></div>
  <div class="pills">
    <span class="pill">Daily study plan</span>
    <span class="pill">Spaced repetition</span>
    <span class="pill">Linked tasks</span>
    <span class="pill">Swiss 1-6 grades</span>
    <span class="pill">Streaks</span>
  </div>
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
    backgroundColor: '#08090b',
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
