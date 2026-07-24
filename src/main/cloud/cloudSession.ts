// URL and anon key for project-vault-cloud's Supabase project. Both are the
// "publishable" pair meant to ship inside a client (same values the web
// test harness uses in the browser) — never the service_role secret.
const SUPABASE_URL = 'https://qrkixhzglpillaqtzfxu.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_uQP5hIZcHJdQyFnx7wk4Cg_SDXZvP0z'

// Prototype-stage: points at project-vault-cloud's local dev server.
// Needs to become a real deployed URL once that project ships.
const API_BASE_URL = 'http://localhost:3000'

interface SupabaseTokenResponse {
  access_token?: string
  user?: { id: string }
  error_description?: string
  msg?: string
}

// Holds the signed-in session in memory only — proof-of-concept scope, not
// persisted across app restarts yet (unlike the local vault's
// lastVault.ts). Runs in the main process so the renderer never makes a
// direct cross-origin fetch to Supabase or project-vault-cloud, matching
// how vaultApi keeps all real I/O out of the renderer.
export class CloudSession {
  private accessToken: string | null = null

  async signIn(email: string, password: string): Promise<{ userId: string }> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password })
    })
    const data = (await res.json()) as SupabaseTokenResponse
    if (!res.ok || !data.access_token || !data.user) {
      throw new Error(data.error_description ?? data.msg ?? 'Sign-in failed')
    }
    this.accessToken = data.access_token
    return { userId: data.user.id }
  }

  async createNote(args: {
    name: string
    frontmatter?: Record<string, unknown>
    body?: string
  }): Promise<unknown> {
    if (!this.accessToken) throw new Error('Not signed in')
    const res = await fetch(`${API_BASE_URL}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(args)
    })
    const data: unknown = await res.json()
    if (!res.ok) {
      const message = (data as { error?: string })?.error ?? 'Create note failed'
      throw new Error(message)
    }
    return data
  }
}
