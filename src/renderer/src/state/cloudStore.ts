import { create } from 'zustand'
import type { CloudTreeNode } from '../../../common/cloudTypes'

interface CloudState {
  checkingSession: boolean
  signedIn: boolean
  tree: CloudTreeNode[] | null
  signInError: string | null
  checkSession: () => Promise<void>
  onSessionRestored: (session: { userId: string } | null) => void
  signIn: (email: string, password: string) => Promise<void>
  setTree: (tree: CloudTreeNode[]) => void
  loadCachedTree: () => Promise<void>
  refreshTree: () => Promise<void>
}

export const useCloudStore = create<CloudState>((set) => ({
  checkingSession: true,
  signedIn: false,
  tree: null,
  signInError: null,

  // Called once at app start — a previous run may have left a signed-in
  // session on disk, restored by the main process before this ever runs
  // (see cloud/cloudSession.ts's restore()) or a moment after, in which
  // case onSessionRestored (wired to cloud:sessionRestored in App.tsx)
  // covers it instead.
  checkSession: async () => {
    const session = await window.cloudApi.getSession()
    if (session) set({ signedIn: true })
    set({ checkingSession: false })
  },

  onSessionRestored: (session) => {
    if (session) set({ signedIn: true })
    set({ checkingSession: false })
  },

  // Deliberately doesn't refresh the tree itself — App.tsx's `signedIn`
  // effect does that for both this path and the session-restored one, so
  // there's exactly one place that decides "signed in -> fetch the tree."
  signIn: async (email, password) => {
    try {
      await window.cloudApi.signIn(email, password)
      set({ signedIn: true, signInError: null })
    } catch (err) {
      set({ signInError: err instanceof Error ? err.message : String(err) })
    }
  },

  setTree: (tree) => set({ tree }),

  loadCachedTree: async () => {
    const cached = await window.cloudApi.getCachedTree()
    if (cached) set({ tree: cached })
  },

  refreshTree: async () => {
    const tree = await window.cloudApi.refreshTree()
    set({ tree })
  }
}))
