import type { InklingApi } from '../shared/api'

declare global {
  interface Window {
    inkling: InklingApi
  }
  /** Injected by electron-vite from package.json — see the renderer `define` block. */
  const __APP_VERSION__: string
}

export {}
