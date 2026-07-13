import type { InklingApi } from '../shared/api'

declare global {
  interface Window {
    inkling: InklingApi
  }
}

export {}
