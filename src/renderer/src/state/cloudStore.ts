import { create } from 'zustand'
import type { CloudTreeNode } from '../../../common/cloudTypes'

interface CloudState {
  checkingSession: boolean
  signedIn: boolean
  tree: CloudTreeNode[] | null
  signInError: string | null
  signUpError: string | null
  // Set after a successful signUp that couldn't return a session (this
  // Supabase project requires confirming the new address first) — tells
  // the UI to show "check your email" instead of silently doing nothing.
  awaitingEmailConfirmation: boolean
  checkSession: () => Promise<void>
  onSessionRestored: (session: { userId: string } | null) => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  setTree: (tree: CloudTreeNode[]) => void
  loadCachedTree: () => Promise<void>
  refreshTree: () => Promise<void>
}

export const useCloudStore = create<CloudState>((set) => ({
  checkingSession: true,
  signedIn: false,
  tree: null,
  signInError: null,
  signUpError: null,
  awaitingEmailConfirmation: false,

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

  signUp: async (email, password) => {
    try {
      const result = await window.cloudApi.signUp(email, password)
      if (result.needsEmailConfirmation) {
        set({ signUpError: null, awaitingEmailConfirmation: true })
      } else {
        // Confirmation is off for this project — signUp already returned a
        // real session, same as signIn would have.
        set({ signedIn: true, signUpError: null })
      }
    } catch (err) {
      set({ signUpError: err instanceof Error ? err.message : String(err) })
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
