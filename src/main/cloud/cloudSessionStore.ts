import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// Prototype-stage: plaintext JSON in userData, same pattern as
// vault/lastVault.ts. A refresh token is meaningfully sensitive (it's a
// long-lived credential), so before this is anything more than a proof of
// concept it should move to Electron's safeStorage (OS keychain-backed)
// instead of a plain file.
function cloudSessionFilePath(userDataDir: string): string {
  return join(userDataDir, 'cloud-session.json')
}

export async function readRefreshToken(userDataDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(cloudSessionFilePath(userDataDir), 'utf8')
    const data: unknown = JSON.parse(raw)
    const refreshToken = (data as { refreshToken?: unknown })?.refreshToken
    return typeof refreshToken === 'string' ? refreshToken : null
  } catch {
    return null
  }
}

export async function writeRefreshToken(userDataDir: string, refreshToken: string): Promise<void> {
  await fs.writeFile(cloudSessionFilePath(userDataDir), JSON.stringify({ refreshToken }), 'utf8').catch(() => {})
}

export async function clearRefreshToken(userDataDir: string): Promise<void> {
  await fs.rm(cloudSessionFilePath(userDataDir), { force: true }).catch(() => {})
}
