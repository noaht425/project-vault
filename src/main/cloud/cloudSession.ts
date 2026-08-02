import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { readRefreshToken, writeRefreshToken, clearRefreshToken } from './cloudSessionStore'
import { readCachedTree, writeCachedTree } from './cloudTreeCache'
import type {
  CloudBacklink,
  CloudEventSummary,
  CloudFolder,
  CloudGraphData,
  CloudNoteData,
  CloudSaveResult,
  CloudSearchResult,
  CloudSessionSummary,
  CloudSignUpResult,
  CloudTitleMatch,
  CloudTreeNode,
  CloudWorkspaceSettings
} from '../../common/cloudTypes'

// URL and anon key for project-vault-cloud's Supabase project. Both are the
// "publishable" pair meant to ship inside a client (same values the web
// test harness uses in the browser) — never the service_role secret.
const SUPABASE_URL = 'https://qrkixhzglpillaqtzfxu.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_uQP5hIZcHJdQyFnx7wk4Cg_SDXZvP0z'

// Deployed at https://vercel.com/noaht425-project-vault/project-vault-cloud
// (its own dedicated Vercel team, separate from the abentfork one).
const API_BASE_URL = 'https://project-vault-cloud.vercel.app'

const MAP_IMAGES_BUCKET = 'map-images'
const SIGNED_URL_TTL_SECONDS = 60 * 60

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

interface SupabaseTokenResponse {
  access_token?: string
  refresh_token?: string
  user?: { id: string }
  error_description?: string
  msg?: string
  // Only present on a /signup response when email confirmation is required
  // — gotrue returns the raw new user row (id at the top level) instead of
  // a session in that case, rather than nesting it under `user`.
  id?: string
}

export interface CloudSessionHandlers {
  onTreeUpdated(tree: CloudTreeNode[]): void
  onSessionRestored(session: { userId: string } | null): void
}

// Raw shapes as project-vault-cloud's API returns them (snake_case,
// straight off the Postgres rows per supabase/migrations/0001_init_schema.sql)
// — mapped to the camelCase types the rest of the app sees.
interface RawNote {
  id: string
  name: string
  folder_id: string | null
  frontmatter: Record<string, unknown>
  body: string
  note_type: string | null
  version: number
}

interface RawFolder {
  id: string
  name: string
  parent_id: string | null
}

function mapNote(raw: RawNote): CloudNoteData {
  return {
    id: raw.id,
    name: raw.name,
    folderId: raw.folder_id,
    frontmatter: raw.frontmatter,
    body: raw.body,
    noteType: raw.note_type,
    version: raw.version
  }
}

function mapFolder(raw: RawFolder): CloudFolder {
  return { id: raw.id, name: raw.name, parentId: raw.parent_id }
}

// Runs in the main process so the renderer never makes a direct
// cross-origin fetch to Supabase or project-vault-cloud, matching how
// vaultApi keeps all real I/O out of the renderer. Entirely separate from
// VaultSession — nothing here touches local vault files.
export class CloudSession {
  private accessToken: string | null = null
  private userId: string | null = null
  private cachedTree: CloudTreeNode[] | null = null

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

  // Separate from signIn/requestToken (rather than reusing it) because a
  // /signup response doesn't always carry a session the way /token does —
  // whether it does depends on this Supabase project's "Confirm email"
  // Auth setting, which isn't visible from here. With confirmation on,
  // gotrue creates the account but returns the raw user row with no
  // access_token, and the account can't sign in until the user clicks the
  // confirmation email. Both cases are handled rather than assumed.
  async signUp(email: string, password: string): Promise<CloudSignUpResult> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password })
    })
    const data = (await res.json()) as SupabaseTokenResponse
    if (!res.ok) {
      throw new Error(data.error_description ?? data.msg ?? 'Could not create account')
    }
    if (data.access_token && data.user) {
      await this.applyTokenResponse(data)
      return { userId: this.getSession()!.userId, needsEmailConfirmation: false }
    }
    const userId = data.user?.id ?? data.id
    if (!userId) throw new Error('Could not create account')
    return { userId, needsEmailConfirmation: true }
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

  // Supabase access tokens expire after about an hour — every API call in
  // this class used to build its own `authHeaders()` and just let an
  // expired token 401 straight through, with nothing anywhere that ever
  // got a new one after the one-time refresh in restore() at app launch.
  // In practice that meant any note click more than ~an hour into a
  // session (or after the computer slept through that boundary) silently
  // failed with no UI feedback (see CloudFileTree.tsx's un-caught
  // `void openNote(...)`). This wraps every authenticated request: on a
  // 401, transparently refresh using the stored refresh token and retry
  // ONCE before giving up — the same mechanism restore() already uses,
  // just triggered reactively instead of only at launch.
  private async authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const withAuth = (): RequestInit => ({ ...init, headers: { ...init.headers, ...this.authHeaders() } })
    const res = await fetch(input, withAuth())
    if (res.status !== 401) return res

    const refreshToken = await readRefreshToken(this.userDataDir)
    if (!refreshToken) return res // nothing to refresh with — let the caller see the original 401

    try {
      await this.applyTokenResponse(await this.requestToken('refresh_token', { refresh_token: refreshToken }))
    } catch {
      // Refresh token itself is stale/invalid — same as restore()'s
      // failure path, require a fresh sign-in rather than looping forever.
      await clearRefreshToken(this.userDataDir)
      this.accessToken = null
      this.userId = null
      this.handlers.onSessionRestored(null)
      return res
    }
    return fetch(input, withAuth())
  }

  async createNote(args: {
    name: string
    folderId?: string | null
    frontmatter?: Record<string, unknown>
    body?: string
  }): Promise<CloudNoteData> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    })
    return mapNote(await this.parseOrThrow<RawNote>(res))
  }

  async getNote(id: string): Promise<CloudNoteData> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/notes/${id}`)
    return mapNote(await this.parseOrThrow<RawNote>(res))
  }

  // Optimistic-concurrency update — mirrors project-vault-cloud's PATCH
  // /api/notes/[id]: caller sends the version it last read, and a 409 with
  // the current row (rather than a thrown error) means someone else's
  // write landed first. renameNote/moveNote are just this with one field
  // set, matching what the API actually does under the hood.
  async saveNote(
    id: string,
    req: {
      version: number
      name?: string
      folderId?: string | null
      frontmatter?: Record<string, unknown>
      body?: string
    }
  ): Promise<CloudSaveResult> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/notes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    })
    if (res.status === 409) {
      const data = (await res.json()) as { current: RawNote }
      return { status: 'conflict', current: mapNote(data.current) }
    }
    return { status: 'saved', note: mapNote(await this.parseOrThrow<RawNote>(res)) }
  }

  async renameNote(id: string, newName: string, version: number): Promise<CloudSaveResult> {
    return this.saveNote(id, { version, name: newName })
  }

  async moveNote(id: string, newFolderId: string | null, version: number): Promise<CloudSaveResult> {
    return this.saveNote(id, { version, folderId: newFolderId })
  }

  async deleteNote(id: string): Promise<void> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/notes/${id}`, { method: 'DELETE' })
    await this.parseOrThrow(res)
  }

  async createFolder(name: string, parentId: string | null = null): Promise<CloudFolder> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId })
    })
    return mapFolder(await this.parseOrThrow<RawFolder>(res))
  }

  // Folders have no version column (see 0001_init_schema.sql) — unlike
  // notes, there's no optimistic-concurrency conflict to handle here.
  async renameFolder(id: string, newName: string): Promise<CloudFolder> {
    return this.patchFolder(id, { name: newName })
  }

  async moveFolder(id: string, newParentId: string | null): Promise<CloudFolder> {
    return this.patchFolder(id, { parentId: newParentId })
  }

  private async patchFolder(id: string, patch: { name?: string; parentId?: string | null }): Promise<CloudFolder> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    return mapFolder(await this.parseOrThrow<RawFolder>(res))
  }

  async deleteFolder(id: string): Promise<void> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/folders/${id}`, { method: 'DELETE' })
    await this.parseOrThrow(res)
  }

  async searchTitles(query: string, type?: string): Promise<CloudTitleMatch[]> {
    const params = new URLSearchParams({ q: query })
    if (type) params.set('type', type)
    const res = await this.authedFetch(`${API_BASE_URL}/api/notes?${params}`)
    return this.parseOrThrow<CloudTitleMatch[]>(res)
  }

  async getBacklinks(id: string): Promise<CloudBacklink[]> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/notes/${id}/backlinks`)
    return this.parseOrThrow<CloudBacklink[]>(res)
  }

  async search(query: string, type?: string): Promise<CloudSearchResult[]> {
    const params = new URLSearchParams({ q: query })
    if (type) params.set('type', type)
    const res = await this.authedFetch(`${API_BASE_URL}/api/search?${params}`)
    return this.parseOrThrow<CloudSearchResult[]>(res)
  }

  async getGraph(): Promise<CloudGraphData> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/graph`)
    return this.parseOrThrow<CloudGraphData>(res)
  }

  async listSessions(): Promise<CloudSessionSummary[]> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/sessions`)
    return this.parseOrThrow<CloudSessionSummary[]>(res)
  }

  async listEvents(): Promise<CloudEventSummary[]> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/events`)
    return this.parseOrThrow<CloudEventSummary[]>(res)
  }

  // Step 5 of docs/plans/2026-07-28-calendar-timeline-system.md (local
  // copy of the plan — project-vault-cloud doesn't keep one). Confirmed
  // with the user: called once per workspace open (see App.tsx's signedIn
  // effect) rather than as a manual action — safe to call repeatedly,
  // idempotent by construction (see the route's own comment).
  async migrateDates(): Promise<{ migrated: number; skipped: number }> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/migrate-dates`, { method: 'POST' })
    return this.parseOrThrow<{ migrated: number; skipped: number }>(res)
  }

  // Step 6 of docs/plans/2026-07-28-calendar-timeline-system.md — per-
  // workspace (not per-user), same setting the local vault stores in
  // .project-vault-settings.json.
  async getWorkspaceSettings(): Promise<CloudWorkspaceSettings> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/workspace-settings`)
    return this.parseOrThrow<CloudWorkspaceSettings>(res)
  }

  async updateWorkspaceSettings(patch: Partial<CloudWorkspaceSettings>): Promise<CloudWorkspaceSettings> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/workspace-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    return this.parseOrThrow<CloudWorkspaceSettings>(res)
  }

  // Instant, never-blocks-on-network read of whatever was cached — from
  // this session's last refresh, or loaded from disk on a cold start. Can
  // be null the very first time, before any refresh has ever completed.
  getCachedTree(): CloudTreeNode[] | null {
    return this.cachedTree
  }

  // Always hits the network, updates the cache (memory + disk), and
  // notifies the renderer via the same push-event pattern the local vault
  // already uses for vault:treeUpdated.
  async refreshTree(): Promise<CloudTreeNode[]> {
    const res = await this.authedFetch(`${API_BASE_URL}/api/tree`)
    const tree = await this.parseOrThrow<CloudTreeNode[]>(res)
    this.cachedTree = tree
    await writeCachedTree(this.userDataDir, tree)
    this.handlers.onTreeUpdated(tree)
    return tree
  }

  // Storage.uploadMapImage/getMapImageUrl talk to Supabase Storage directly
  // rather than through project-vault-cloud's API — this session already
  // holds a bearer token straight from Supabase Auth (see requestToken
  // above), so routing image bytes through Vercel too would just be a
  // redundant hop. A fresh bearer-scoped client per call mirrors how
  // project-vault-cloud's own apiAuth.ts authenticates non-cookie callers.
  private storageClient(): ReturnType<typeof createSupabaseClient> {
    if (!this.accessToken) throw new Error('Not signed in')
    return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${this.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }

  // Object paths are namespaced under the caller's own user id — the
  // "map_images_owner_all" RLS policy (0002_map_images_storage.sql) checks
  // exactly that first path segment, mirroring the owner_id-scoping every
  // Postgres table already uses.
  async uploadMapImage(localFilePath: string): Promise<{ path: string }> {
    if (!this.userId) throw new Error('Not signed in')
    const bytes = await readFile(localFilePath)
    const ext = extname(localFilePath).toLowerCase()
    const objectPath = `${this.userId}/${randomUUID()}${ext}`

    const { error } = await this.storageClient()
      .storage.from(MAP_IMAGES_BUCKET)
      .upload(objectPath, bytes, { contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' })
    if (error) throw new Error(error.message)

    return { path: objectPath }
  }

  async getMapImageUrl(path: string): Promise<string> {
    const { data, error } = await this.storageClient()
      .storage.from(MAP_IMAGES_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (error || !data) throw new Error(error?.message ?? 'Failed to create signed URL')

    return data.signedUrl
  }

  private async parseOrThrow<T>(res: Response): Promise<T> {
    const data: unknown = await res.json()
    if (!res.ok) {
      const message = (data as { error?: string })?.error ?? `Request failed (${res.status})`
      throw new Error(message)
    }
    return data as T
  }
}
