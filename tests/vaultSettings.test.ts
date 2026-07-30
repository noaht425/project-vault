import { describe, it, expect, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultSession } from '../src/main/vault/session'

const dirs: string[] = []

async function makeTmpVault(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'vault-settings-'))
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

describe('VaultSession settings (build step 6 of the calendar/timeline plan)', () => {
  it('defaults to no active calendars for a brand-new vault', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    expect(await session.getSettings()).toEqual({ activeCalendarNoteTitles: [], campaignDate: null })
    await session.closeVault()
  })

  it('persists updateSettings across a close/reopen', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    await session.updateSettings({ activeCalendarNoteTitles: ['Age of the Many', 'Kingdom of Krotaphos'] })
    expect(await session.getSettings()).toEqual({
      activeCalendarNoteTitles: ['Age of the Many', 'Kingdom of Krotaphos'],
      campaignDate: null
    })
    await session.closeVault()

    const reopened = makeSession(userDataDir)
    await reopened.openVault(vaultDir)
    expect(await reopened.getSettings()).toEqual({
      activeCalendarNoteTitles: ['Age of the Many', 'Kingdom of Krotaphos'],
      campaignDate: null
    })
    await reopened.closeVault()
  })

  it('persists a campaignDate across a close/reopen', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    const campaignDate = { calendarNoteTitle: 'Age of the Many', eraId: 'am', year: 42, monthId: 'aucaela', day: 15 }
    await session.updateSettings({ campaignDate })
    expect(await session.getSettings()).toEqual({ activeCalendarNoteTitles: [], campaignDate })
    await session.closeVault()

    const reopened = makeSession(userDataDir)
    await reopened.openVault(vaultDir)
    expect(await reopened.getSettings()).toEqual({ activeCalendarNoteTitles: [], campaignDate })
    await reopened.closeVault()
  })

  it('falls back to a null campaignDate for a malformed value rather than throwing', async () => {
    const vaultDir = await makeTmpVault()
    await fs.writeFile(
      join(vaultDir, '.project-vault-settings.json'),
      JSON.stringify({ activeCalendarNoteTitles: [], campaignDate: { calendarNoteTitle: 'Age of the Many' } }), // missing required keys
      'utf8'
    )
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    expect(await session.getSettings()).toEqual({ activeCalendarNoteTitles: [], campaignDate: null })
    await session.closeVault()
  })

  it('writes the settings file as a hidden dotfile invisible to the note tree', async () => {
    const vaultDir = await makeTmpVault()
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)
    await session.updateSettings({ activeCalendarNoteTitles: ['Age of the Many'] })

    const tree = await session.getTree()
    expect(tree.some((e) => e.name.includes('project-vault-settings'))) .toBe(false)
    await session.closeVault()
  })

  it('falls back to defaults for a corrupt settings file rather than throwing', async () => {
    const vaultDir = await makeTmpVault()
    await fs.writeFile(join(vaultDir, '.project-vault-settings.json'), 'not valid json{{{', 'utf8')
    const userDataDir = await makeTmpVault()
    const session = makeSession(userDataDir)
    await session.openVault(vaultDir)

    expect(await session.getSettings()).toEqual({ activeCalendarNoteTitles: [], campaignDate: null })
    await session.closeVault()
  })
})
