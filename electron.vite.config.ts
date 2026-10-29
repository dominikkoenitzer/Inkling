import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { version } from './package.json'

export default defineConfig({
  main: {
    // The MCP SDK and zod are bundled into mcp.js, so the installer carries only what it uses.
    plugins: [externalizeDepsPlugin({ exclude: ['@modelcontextprotocol/sdk', 'zod'] })],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      lib: {
        entry: {
          index: resolve(__dirname, 'src/main/index.ts'),
          mcp: resolve(__dirname, 'src/main/mcp/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    plugins: [react()],
    // Single source of truth for the version shown in Settings. It used to be typed by
    // hand there and had already drifted a release behind package.json.
    define: { __APP_VERSION__: JSON.stringify(version) },
    // electron-vite leaves the renderer unminified; kept names leave stack frames readable without source maps.
    build: { minify: true, rolldownOptions: { output: { keepNames: true } } },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
