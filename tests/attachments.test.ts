import { describe, it, expect, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultSession } from '../src/main/vault/session'

const dirs: string[] = []

async function makeTmpVault(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'vault-attachments-'))
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

describe('VaultSession.saveLocalImage (docs/plans/2026-08-04-cloud-to-local-copy.md Phase 2)', () => {
  it('copies the source file into a hidden .attachments/ folder and returns a vault-root-relative path', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    const sourceDir = await makeTmpVault()
    const sourcePath = join(sourceDir, 'Continent Map.png')
    await fs.writeFile(sourcePath, 'fake png bytes')

    const { path } = await session.saveLocalImage(sourcePath)

    expect(path.startsWith('.attachments/')).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    const copied = await fs.readFile(join(vaultDir, path), 'utf8')
    expect(copied).toBe('fake png bytes')
    await session.closeVault()
  })

  it('sanitizes the original filename but keeps it recognizable, prefixed with a unique id', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    const sourceDir = await makeTmpVault()
    const sourcePath = join(sourceDir, 'weird name!! (final).jpg')
    await fs.writeFile(sourcePath, 'bytes')

    const { path } = await session.saveLocalImage(sourcePath)
    const fileName = path.split('/')[1]

    expect(fileName).toMatch(/^[0-9a-f-]{36}-weird-name-final-\.jpg$/)
    await session.closeVault()
  })

  it('two uploads of the same filename never collide', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    const sourceDir = await makeTmpVault()
    const sourcePath = join(sourceDir, 'map.png')
    await fs.writeFile(sourcePath, 'bytes')

    const first = await session.saveLocalImage(sourcePath)
    const second = await session.saveLocalImage(sourcePath)

    expect(first.path).not.toBe(second.path)
    await expect(fs.readFile(join(vaultDir, first.path))).resolves.toBeDefined()
    await expect(fs.readFile(join(vaultDir, second.path))).resolves.toBeDefined()
    await session.closeVault()
  })

  it('the .attachments/ folder stays invisible to the note tree, same as .project-vault-settings.json', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    const sourceDir = await makeTmpVault()
    const sourcePath = join(sourceDir, 'map.png')
    await fs.writeFile(sourcePath, 'bytes')
    await session.saveLocalImage(sourcePath)

    const tree = await session.getTree()
    expect(tree.some((e) => e.name.startsWith('.attachments'))).toBe(false)
    await session.closeVault()
  })

  it('saveLocalImageBytes writes already-in-memory bytes without needing a source file on disk', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    const { path } = await session.saveLocalImageBytes(new TextEncoder().encode('downloaded bytes'), 'Continent Map.png')

    expect(path.startsWith('.attachments/')).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(await fs.readFile(join(vaultDir, path), 'utf8')).toBe('downloaded bytes')
    await session.closeVault()
  })

  it('getVaultRoot reflects the currently open vault, or null when none is open', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)

    expect(session.getVaultRoot()).toBeNull()
    await session.openVault(vaultDir)
    expect(session.getVaultRoot()).toBe(vaultDir)
    await session.closeVault()
    expect(session.getVaultRoot()).toBeNull()
  })
})
