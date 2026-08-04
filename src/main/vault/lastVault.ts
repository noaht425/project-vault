import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from './atomicWrite'

function lastVaultFilePath(userDataDir: string): string {
  return join(userDataDir, 'last-vault.json')
}

export async function readLastVaultPath(userDataDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(lastVaultFilePath(userDataDir), 'utf8')
    const data: unknown = JSON.parse(raw)
    const vaultPath = (data as { vaultPath?: unknown })?.vaultPath
    return typeof vaultPath === 'string' ? vaultPath : null
  } catch {
    return null
  }
}

export async function writeLastVaultPath(userDataDir: string, vaultPath: string): Promise<void> {
  await atomicWrite(lastVaultFilePath(userDataDir), JSON.stringify({ vaultPath })).catch(() => {})
}
