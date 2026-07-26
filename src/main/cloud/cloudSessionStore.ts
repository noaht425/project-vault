import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

// A refresh token is a long-lived credential, so it's encrypted at rest via
// Electron's safeStorage (macOS Keychain-backed) rather than written as
// plaintext — this used to be a plain JSON file, same pattern as
// vault/lastVault.ts, back when this was only a local proof of concept.
function cloudSessionFilePath(userDataDir: string): string {
  return join(userDataDir, 'cloud-session.enc')
}

export async function readRefreshToken(userDataDir: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = await fs.readFile(cloudSessionFilePath(userDataDir))
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

export async function writeRefreshToken(userDataDir: string, refreshToken: string): Promise<void> {
  // No plaintext fallback if encryption isn't available (some Linux setups
  // without a keyring) — silently persisting an unencrypted credential
  // would defeat the point, so the session just won't survive a restart.
  if (!safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(refreshToken)
  await fs.writeFile(cloudSessionFilePath(userDataDir), encrypted).catch(() => {})
}

export async function clearRefreshToken(userDataDir: string): Promise<void> {
  await fs.rm(cloudSessionFilePath(userDataDir), { force: true }).catch(() => {})
}
