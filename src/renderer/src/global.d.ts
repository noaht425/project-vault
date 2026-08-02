import type { AppApi, CloudApi, VaultApi } from '../../preload'

declare global {
  interface Window {
    vaultApi: VaultApi
    cloudApi: CloudApi
    appApi: AppApi
  }
}

export {}
