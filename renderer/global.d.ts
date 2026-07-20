import type { GsdApi } from '../shared/types'

declare global {
  interface Window {
    gsd: GsdApi
  }
}

export {}
