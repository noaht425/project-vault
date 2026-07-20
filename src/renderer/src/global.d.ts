import type { VaultApi } from '../../preload'

declare global {
  interface Window {
    vaultApi: VaultApi
  }
}

export {}
