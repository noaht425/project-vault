import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CloudSession } from '../src/main/cloud/cloudSession'

// cloudSession.ts pulls in cloudSessionStore.ts, which imports Electron's
// safeStorage — irrelevant to the HTTP/mapping logic under test here, but
// the import chain still needs a stub or it fails to resolve outside a
// real Electron process. vi.mock calls are hoisted above imports by
// vitest, so this takes effect before cloudSession.ts is ever loaded.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(),
    decryptString: vi.fn()
  }
}))

const noopHandlers = { onTreeUpdated: vi.fn(), onSessionRestored: vi.fn() }

function mockFetchOnce(status: number, body: unknown): void {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
}

function lastRequestBody(): unknown {
  const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
  const options = call[1] as RequestInit
  return JSON.parse(options.body as string)
}

async function signedInSession(): Promise<InstanceType<typeof CloudSession>> {
  const session = new CloudSession('/tmp/project-vault-test-userdata', noopHandlers)
  mockFetchOnce(200, { access_token: 'token-123', refresh_token: 'refresh-123', user: { id: 'user-1' } })
  await session.signIn('a@b.com', 'pw')
  return session
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('CloudSession', () => {
  it('signIn sets the session and exposes the userId', async () => {
    const session = await signedInSession()
    expect(session.getSession()).toEqual({ userId: 'user-1' })
  })

  it('signIn rejects with the server error message on failure', async () => {
    const session = new CloudSession('/tmp/project-vault-test-userdata', noopHandlers)
    mockFetchOnce(400, { error_description: 'Invalid credentials' })
    await expect(session.signIn('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials')
  })

  it('rejects an authenticated call made before signing in', async () => {
    const session = new CloudSession('/tmp/project-vault-test-userdata', noopHandlers)
    await expect(session.createNote({ name: 'Test' })).rejects.toThrow('Not signed in')
  })

  it('createNote maps the snake_case API response to camelCase', async () => {
    const session = await signedInSession()
    mockFetchOnce(201, {
      id: 'note-1',
      name: 'Test',
      folder_id: null,
      frontmatter: { type: 'note' },
      body: 'hi',
      note_type: 'note',
      version: 1
    })

    const note = await session.createNote({ name: 'Test' })

    expect(note).toEqual({
      id: 'note-1',
      name: 'Test',
      folderId: null,
      frontmatter: { type: 'note' },
      body: 'hi',
      noteType: 'note',
      version: 1
    })
  })

  it('saveNote returns a saved result on success', async () => {
    const session = await signedInSession()
    mockFetchOnce(200, {
      id: 'note-1',
      name: 'Test',
      folder_id: null,
      frontmatter: {},
      body: 'updated',
      note_type: 'note',
      version: 2
    })

    const result = await session.saveNote('note-1', { version: 1, body: 'updated' })

    expect(result).toEqual({
      status: 'saved',
      note: { id: 'note-1', name: 'Test', folderId: null, frontmatter: {}, body: 'updated', noteType: 'note', version: 2 }
    })
  })

  // The whole point of the version column: a stale write comes back as a
  // typed conflict result, not a thrown error and not a silent overwrite.
  it('saveNote returns a conflict result (not a thrown error) on 409', async () => {
    const session = await signedInSession()
    mockFetchOnce(409, {
      error: 'Version conflict',
      current: {
        id: 'note-1',
        name: 'Test',
        folder_id: null,
        frontmatter: {},
        body: "someone else's edit",
        note_type: 'note',
        version: 5
      }
    })

    const result = await session.saveNote('note-1', { version: 1, body: 'my edit' })

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.current.version).toBe(5)
      expect(result.current.body).toBe("someone else's edit")
    }
  })

  it('renameNote sends a PATCH with only version and name', async () => {
    const session = await signedInSession()
    mockFetchOnce(200, {
      id: 'note-1',
      name: 'New Name',
      folder_id: null,
      frontmatter: {},
      body: '',
      note_type: 'note',
      version: 2
    })

    await session.renameNote('note-1', 'New Name', 1)

    expect(lastRequestBody()).toEqual({ version: 1, name: 'New Name' })
  })

  it('moveNote sends a PATCH with only version and folderId', async () => {
    const session = await signedInSession()
    mockFetchOnce(200, {
      id: 'note-1',
      name: 'Test',
      folder_id: 'folder-1',
      frontmatter: {},
      body: '',
      note_type: 'note',
      version: 2
    })

    await session.moveNote('note-1', 'folder-1', 1)

    expect(lastRequestBody()).toEqual({ version: 1, folderId: 'folder-1' })
  })

  it('deleteNote resolves without throwing on success', async () => {
    const session = await signedInSession()
    mockFetchOnce(200, { deleted: true })
    await expect(session.deleteNote('note-1')).resolves.toBeUndefined()
  })

  it('rejects with the server error message on a non-conflict failure', async () => {
    const session = await signedInSession()
    mockFetchOnce(404, { error: 'Not found' })
    await expect(session.getNote('missing')).rejects.toThrow('Not found')
  })

  // Vercel's own 413 "Request Entity Too Large" rejection (hit before
  // project-vault-cloud's own PATCH handler ever runs on an oversized
  // settlement save) is plain text, not JSON — parseOrThrow needs to
  // surface something readable instead of letting res.json() throw a raw
  // SyntaxError. See docs/plans/2026-08-03-cloud-settlement-storage-offload.md.
  it('saveNote surfaces a readable error on a plain-text 413 response', async () => {
    const session = await signedInSession()
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Request Entity Too Large', { status: 413 })
    )
    await expect(session.saveNote('note-1', { version: 1, body: 'huge' })).rejects.toThrow(
      'That request was too large for the server to accept.'
    )
  })
})
