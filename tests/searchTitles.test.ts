import { describe, it, expect, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultSession } from '../src/main/vault/session'

const dirs: string[] = []

async function makeTmpVault(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'vault-search-titles-'))
  dirs.push(dir)
  return dir
}

function makeSession(userDataDir: string): VaultSession {
  return new VaultSession(userDataDir, {
    onExternalChange: vi.fn(),
    onTreeUpdated: vi.fn(),
    onVaultOpened: vi.fn()
  })
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('VaultSession.searchTitles', () => {
  // Confirmed bug: an empty-query, no-type-filter search (Family Tree's
  // person picker, which spans every note in the vault, unlike Location/
  // Calendar pickers which are narrowed by type) previously capped at 20
  // rows via `ORDER BY title LIMIT 20` — a note whose title sorted past the
  // 20th alphabetically (e.g. "Nerinè", reported missing while an
  // earlier-alphabet PC wasn't) never appeared in the results at all.
  it('returns a note whose title sorts well past the old 20-row cap', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    // 25 notes named to sort alphabetically before "Nerinè" ("Alpha 00".."Alpha 24"),
    // plus the note that used to fall outside the old LIMIT 20.
    for (let i = 0; i < 25; i++) {
      await session.createNote(vaultDir, `Alpha ${String(i).padStart(2, '0')}`)
    }
    await session.createNote(vaultDir, 'Nerinè')

    const results = await session.searchTitles('')
    expect(results.some((r) => r.title === 'Nerinè')).toBe(true)

    await session.closeVault()
  })

  it('still respects a type filter alongside the raised limit', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    await session.createNote(vaultDir, 'A Note', 'note')
    await session.createNote(vaultDir, 'An NPC', 'npc')

    const results = await session.searchTitles('', 'npc')
    expect(results.map((r) => r.title)).toEqual(['An NPC'])

    await session.closeVault()
  })
})
