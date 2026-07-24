import type { CloudApi, VaultApi } from '../../preload'

declare global {
  interface Window {
    vaultApi: VaultApi
    cloudApi: CloudApi
  }
}

export {}
