import { create } from 'zustand'
import type { TreeEntry } from '../../../common/types'

interface VaultState {
  vaultPath: string | null
  tree: TreeEntry[]
  openVault: () => Promise<void>
  setTree: (tree: TreeEntry[]) => void
  refreshTree: () => Promise<void>
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  tree: [],

  openVault: async () => {
    const result = await window.vaultApi.openVault()
    if (!result) return
    set({ vaultPath: result.vaultPath, tree: result.tree })
  },

  setTree: (tree) => set({ tree }),

  refreshTree: async () => {
    if (!get().vaultPath) return
    const tree = await window.vaultApi.getTree()
    set({ tree })
  }
}))
