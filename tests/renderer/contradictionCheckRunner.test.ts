import { describe, it, expect, vi } from 'vitest'
import { runContradictionCheck } from '../../src/renderer/src/lib/contradictionCheckRunner'
import type { NoteRefApi } from '../../src/renderer/src/lib/noteRefApi'

function makeNoteRefApi(overrides: Partial<NoteRefApi> = {}): NoteRefApi {
  const base: NoteRefApi = {
    isCloud: false,
    searchTitles: vi.fn().mockResolvedValue([]),
    openByTitle: vi.fn(),
    readBodyByTitle: vi.fn().mockResolvedValue(null),
    readFrontmatterByTitle: vi.fn().mockResolvedValue(null),
    // Composed from the two mocks above by default (like createNoteRefApi's
    // own fallback), so tests that only override readFrontmatterByTitle/
    // readBodyByTitle don't also need to duplicate that into readNoteByTitle.
    readNoteByTitle: vi.fn(async (title: string, type?: string) => {
      const [frontmatter, body] = await Promise.all([base.readFrontmatterByTitle(title, type), base.readBodyByTitle(title, type)])
      if (frontmatter === null && body === null) return null
      return { frontmatter: frontmatter ?? {}, body: body ?? '' }
    }),
    createNote: vi.fn(),
    listNotesInFolder: vi.fn().mockResolvedValue([]),
    listFolderPaths: vi.fn().mockResolvedValue([]),
    ...overrides
  }
  return base
}

describe('runContradictionCheck', () => {
  it('combines an event/death contradiction with a family-tree date contradiction from one run', async () => {
    const listFacts = vi.fn().mockResolvedValue([
      { title: 'Old Tomas', date: '5 Auctera, 390 AM', summary: 'Died' },
      { title: 'Aldric', date: '1 Aucaela, 350 AM', summary: 'Born' },
      { title: 'Mira', date: '1 Aucaela, 340 AM', summary: 'Born' }
    ])

    const noteRefApi = makeNoteRefApi({
      searchTitles: vi.fn(async (_query: string, type?: string) => {
        if (type === 'event') return [{ title: 'The Harvest Festival' }]
        if (type === 'family-tree') return [{ title: 'The Ashworth Family' }]
        return []
      }),
      readFrontmatterByTitle: vi.fn(async (title: string) => (title === 'The Harvest Festival' ? { date: '1 Morcaela, 395 AM' } : null)),
      readBodyByTitle: vi.fn(async (title: string) => {
        if (title === 'The Harvest Festival') return 'Everyone from town attended, including [[Old Tomas]].'
        if (title === 'The Ashworth Family') return '## Relationships\n- [[Aldric]] parent of [[Mira]]\n'
        return null
      })
    })

    const contradictions = await runContradictionCheck(listFacts, noteRefApi)

    expect(contradictions).toHaveLength(2)
    expect(contradictions.find((c) => c.noteBTitle === 'Old Tomas')?.noteATitle).toBe('The Harvest Festival')
    expect(contradictions.find((c) => c.noteBTitle === 'Mira')?.noteATitle).toBe('Aldric')
  })

  it('returns no contradictions when there are no events or family trees at all', async () => {
    const listFacts = vi.fn().mockResolvedValue([])
    const contradictions = await runContradictionCheck(listFacts, makeNoteRefApi())
    expect(contradictions).toEqual([])
  })

  it("ignores a family tree's non-parent relationships (spouse/sibling/social) entirely", async () => {
    const listFacts = vi.fn().mockResolvedValue([
      { title: 'Aldric', date: '1 Aucaela, 350 AM', summary: 'Born' },
      { title: 'Mira', date: '1 Aucaela, 340 AM', summary: 'Born' } // would violate parent/child if treated as one
    ])
    const noteRefApi = makeNoteRefApi({
      searchTitles: vi.fn(async (_q: string, type?: string) => (type === 'family-tree' ? [{ title: 'The Ashworth Family' }] : [])),
      readBodyByTitle: vi.fn().mockResolvedValue('## Relationships\n- [[Aldric]] spouse of [[Mira]]\n')
    })

    const contradictions = await runContradictionCheck(listFacts, noteRefApi)
    expect(contradictions).toEqual([])
  })
})
