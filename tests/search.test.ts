import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openVaultDb } from '../src/main/index-db/db'
import { indexNote, removeNote, toFtsQuery } from '../src/main/index-db/indexer'
import { SNIPPET_MATCH_START, SNIPPET_MATCH_END, parseSnippet } from '../src/common/searchSnippet'

const dirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'vault-search-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

function search(db: ReturnType<typeof openVaultDb>, query: string, type?: string) {
  const ftsQuery = toFtsQuery(query)
  const sql = `
    SELECT notes_fts.path AS path, n.title AS title, n.type AS type,
           snippet(notes_fts, -1, ?, ?, '…', 10) AS snippet
    FROM notes_fts
    JOIN notes n ON n.path = notes_fts.path
    WHERE notes_fts MATCH ?
    ${type ? 'AND n.type = ?' : ''}
    ORDER BY rank
  `
  const params: unknown[] = [SNIPPET_MATCH_START, SNIPPET_MATCH_END, ftsQuery]
  if (type) params.push(type)
  return db.prepare(sql).all(...params) as { path: string; title: string; type: string; snippet: string }[]
}

describe('full-text search (FTS5)', () => {
  it('finds a note by body content and highlights the match', async () => {
    const dir = await makeTmpDir()
    const db = openVaultDb(join(dir, 'index.sqlite'))

    const path = join(dir, 'Grommash.md')
    const content = '---\ntype: npc\ntags: []\n---\n\nGrommash wields a massive greataxe and hates goblins.\n'
    indexNote(db, path, { mtimeMs: 1, contentHash: 'a' }, content)

    const results = search(db, 'greataxe')
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe(path)
    expect(results[0].title).toBe('Grommash')
    expect(results[0].type).toBe('npc')

    const segments = parseSnippet(results[0].snippet)
    const highlighted = segments.filter((s) => s.highlighted).map((s) => s.text.toLowerCase())
    expect(highlighted).toContain('greataxe')
  })

  it('filters by type', async () => {
    const dir = await makeTmpDir()
    const db = openVaultDb(join(dir, 'index.sqlite'))

    indexNote(
      db,
      join(dir, 'a.md'),
      { mtimeMs: 1, contentHash: 'a' },
      '---\ntype: npc\ntags: []\n---\n\nA tavern keeper named Boros.\n'
    )
    indexNote(
      db,
      join(dir, 'b.md'),
      { mtimeMs: 1, contentHash: 'b' },
      '---\ntype: session\ntags: []\ndate: "2026-01-01"\nsummary: ""\n---\n\nThe party met Boros at the tavern.\n'
    )

    expect(search(db, 'Boros').length).toBe(2)
    expect(search(db, 'Boros', 'npc').length).toBe(1)
    expect(search(db, 'Boros', 'session').length).toBe(1)
  })

  it('does not throw on special characters in the query (quotes, colons, hyphens)', async () => {
    const dir = await makeTmpDir()
    const db = openVaultDb(join(dir, 'index.sqlite'))
    indexNote(
      db,
      join(dir, 'a.md'),
      { mtimeMs: 1, contentHash: 'a' },
      '---\ntype: note\ntags: []\n---\n\nSome ordinary text.\n'
    )

    expect(() => search(db, 'a "quote" and: a-hyphen (paren)')).not.toThrow()
  })

  it('removeNote takes the note out of search results', async () => {
    const dir = await makeTmpDir()
    const db = openVaultDb(join(dir, 'index.sqlite'))
    const path = join(dir, 'a.md')
    indexNote(db, path, { mtimeMs: 1, contentHash: 'a' }, '---\ntype: note\ntags: []\n---\n\nfindable text\n')
    expect(search(db, 'findable').length).toBe(1)

    removeNote(db, path)
    expect(search(db, 'findable').length).toBe(0)
  })

  it('finds a note by a frontmatter field value that appears in neither the title nor the body (regression)', async () => {
    const dir = await makeTmpDir()
    const db = openVaultDb(join(dir, 'index.sqlite'))
    // "Grommash.md" the filename, "Zzyzxqvorp" only in the subclass field —
    // previously only `tags` was indexed from frontmatter, so class/
    // subclass/classRef/role/cr fields were invisible to search entirely.
    indexNote(
      db,
      join(dir, 'Grommash.md'),
      { mtimeMs: 1, contentHash: 'a' },
      '---\ntype: pc\ntags: []\nclass: Fighter\nsubclass: Zzyzxqvorp\n---\n\nNo mention of the subclass name here.\n'
    )

    expect(search(db, 'Zzyzxqvorp').length).toBe(1)
    expect(search(db, 'Fighter').length).toBe(1)
  })
})
