import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseEncounter, type Encounter } from '../../common/initiative'
import { atomicWrite } from './atomicWrite'

// Deliberately NOT part of the vault's note files — an encounter is app-level
// scratch state (no wiki-links, no search, no backlinks), same reasoning as
// lastVault.ts. Stored once per userData dir (not per-vault), so there's a
// single active encounter regardless of which vault is open — fine for how
// this app is actually used (one session at a time).
function encounterFilePath(userDataDir: string): string {
  return join(userDataDir, 'current-encounter.json')
}

export async function readEncounter(userDataDir: string): Promise<Encounter> {
  try {
    const raw = await fs.readFile(encounterFilePath(userDataDir), 'utf8')
    return parseEncounter(JSON.parse(raw))
  } catch {
    return parseEncounter(undefined)
  }
}

export async function writeEncounter(userDataDir: string, encounter: Encounter): Promise<void> {
  await atomicWrite(encounterFilePath(userDataDir), JSON.stringify(encounter)).catch(() => {})
}
