import { readRefreshToken, writeRefreshToken, clearRefreshToken } from './cloudSessionStore'
import { readCachedTree, writeCachedTree } from './cloudTreeCache'

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
  refresh_token?: string
  user?: { id: string }
  error_description?: string
  msg?: string
}

export interface CloudSessionHandlers {
  onTreeUpdated(tree: unknown): void
  onSessionRestored(session: { userId: string } | null): void
}

// Runs in the main process so the renderer never makes a direct
// cross-origin fetch to Supabase or project-vault-cloud, matching how
// vaultApi keeps all real I/O out of the renderer. Entirely separate from
// VaultSession — nothing here touches local vault files.
export class CloudSession {
  private accessToken: string | null = null
  private userId: string | null = null
  private cachedTree: unknown = null

  constructor(
    private readonly userDataDir: string,
    private readonly handlers: CloudSessionHandlers
  ) {}

  getSession(): { userId: string } | null {
    return this.userId ? { userId: this.userId } : null
  }

  // Called once at startup, deliberately NOT awaited by the caller before
  // showing the window — a slow or failing network request here must
  // never delay app launch the way an in-progress vault reopen can.
  async restore(): Promise<void> {
    this.cachedTree = await readCachedTree(this.userDataDir)

    const refreshToken = await readRefreshToken(this.userDataDir)
    if (!refreshToken) {
      this.handlers.onSessionRestored(null)
      return
    }

    try {
      await this.applyTokenResponse(await this.requestToken('refresh_token', { refresh_token: refreshToken }))
      this.handlers.onSessionRestored(this.getSession())
    } catch {
      // Stored refresh token is stale/invalid — fall back to requiring a
      // fresh sign-in rather than looping on a doomed retry.
      await clearRefreshToken(this.userDataDir)
      this.handlers.onSessionRestored(null)
    }
  }

  async signIn(email: string, password: string): Promise<{ userId: string }> {
    await this.applyTokenResponse(await this.requestToken('password', { email, password }))
    return this.getSession()!
  }

  private async requestToken(grantType: string, body: Record<string, string>): Promise<SupabaseTokenResponse> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body)
    })
    const data = (await res.json()) as SupabaseTokenResponse
    if (!res.ok || !data.access_token || !data.user) {
      throw new Error(data.error_description ?? data.msg ?? 'Authentication failed')
    }
    return data
  }

  private async applyTokenResponse(data: SupabaseTokenResponse): Promise<void> {
    this.accessToken = data.access_token!
    this.userId = data.user?.id ?? this.userId
    if (data.refresh_token) {
      await writeRefreshToken(this.userDataDir, data.refresh_token)
    }
  }

  private authHeaders(): Record<string, string> {
    if (!this.accessToken) throw new Error('Not signed in')
    return { Authorization: `Bearer ${this.accessToken}` }
  }

  async createNote(args: { name: string; frontmatter?: Record<string, unknown>; body?: string }): Promise<unknown> {
    const res = await fetch(`${API_BASE_URL}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(args)
    })
    return this.parseOrThrow(res)
  }

  async getNote(id: string): Promise<unknown> {
    const res = await fetch(`${API_BASE_URL}/api/notes/${id}`, { headers: this.authHeaders() })
    return this.parseOrThrow(res)
  }

  // Instant, never-blocks-on-network read of whatever was cached — from
  // this session's last refresh, or loaded from disk on a cold start. Can
  // be null the very first time, before any refresh has ever completed.
  getCachedTree(): unknown {
    return this.cachedTree
  }

  // Always hits the network, updates the cache (memory + disk), and
  // notifies the renderer via the same push-event pattern the local vault
  // already uses for vault:treeUpdated.
  async refreshTree(): Promise<unknown> {
    const res = await fetch(`${API_BASE_URL}/api/tree`, { headers: this.authHeaders() })
    const tree = await this.parseOrThrow(res)
    this.cachedTree = tree
    await writeCachedTree(this.userDataDir, tree)
    this.handlers.onTreeUpdated(tree)
    return tree
  }

  private async parseOrThrow(res: Response): Promise<unknown> {
    const data: unknown = await res.json()
    if (!res.ok) {
      const message = (data as { error?: string })?.error ?? `Request failed (${res.status})`
      throw new Error(message)
    }
    return data
  }
}
