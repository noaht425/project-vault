import type Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { readNote } from '../vault/fileWriteQueue'
import { extractWikiLinkTitles } from '../../common/wikiLinks'
import { parseNote } from '../../common/frontmatter'
import type { FileVersion } from '../../common/types'

export function titleFromPath(path: string): string {
  return basename(path, '.md')
}

/**
 * Turns free-typed user search input into a safe FTS5 MATCH expression.
 * Raw user text can't be used directly — FTS5's query syntax treats
 * quotes, hyphens, colons, parens, etc. as operators, so unescaped input
 * throws a syntax error on anything but the simplest queries. Wrapping
 * each word as its own quoted phrase (with internal quotes doubled, the
 * standard FTS5 escape) makes every token literal and immune to that,
 * while space-separated quoted phrases still implicitly AND together.
 */
export function toFtsQuery(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ')
}

/**
 * Recursively collects every string value anywhere in a frontmatter object
 * (tags, class, subclass, role, cr, summary, classRef, nested objects,
 * etc.) into one search-friendly blob. Without this, a PC's `class:
 * Fighter` / `subclass: Champion` fields — structured data that's clearly
 * "about" that character — would be invisible to search just because they
 * live in frontmatter rather than the note's body or title.
 */
function extractSearchableText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(extractSearchableText)
  if (value && typeof value === 'object') return Object.values(value).flatMap(extractSearchableText)
  return []
}

/**
 * Upserts a note's row, fully replaces its outgoing links, and refreshes
 * its full-text search entry. Needs the note's content (not just its
 * path/version) to re-extract [[wiki-links]], frontmatter `type`, and
 * body/metadata text — every caller that changes what's on disk should
 * have that content on hand already (it just wrote or just read it).
 */
export function indexNote(db: Database.Database, path: string, version: FileVersion, content: string): void {
  const { frontmatter, body } = parseNote(content)
  const type = typeof frontmatter.type === 'string' && frontmatter.type ? frontmatter.type : 'note'
  const metadataText = extractSearchableText(frontmatter).join(' ')
  const title = titleFromPath(path)

  db.prepare(
    `INSERT INTO notes (path, title, type, mtime_ms, content_hash, updated_at)
     VALUES (@path, @title, @type, @mtimeMs, @contentHash, @updatedAt)
     ON CONFLICT(path) DO UPDATE SET
       title = excluded.title,
       type = excluded.type,
       mtime_ms = excluded.mtime_ms,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`
  ).run({
    path,
    title,
    type,
    mtimeMs: version.mtimeMs,
    contentHash: version.contentHash,
    updatedAt: new Date().toISOString()
  })

  db.prepare('DELETE FROM links WHERE source_path = ?').run(path)
  const insertLink = db.prepare('INSERT INTO links (source_path, target_title) VALUES (?, ?)')
  for (const linkTitle of extractWikiLinkTitles(content)) {
    insertLink.run(path, linkTitle)
  }

  // FTS5 has no upsert — delete-then-insert is the standard pattern.
  db.prepare('DELETE FROM notes_fts WHERE path = ?').run(path)
  db.prepare('INSERT INTO notes_fts (path, title, body, metadata) VALUES (?, ?, ?, ?)').run(
    path,
    title,
    body,
    metadataText
  )
}

export function removeNote(db: Database.Database, path: string): void {
  db.prepare('DELETE FROM notes WHERE path = ?').run(path)
  db.prepare('DELETE FROM links WHERE source_path = ?').run(path)
  db.prepare('DELETE FROM notes_fts WHERE path = ?').run(path)
}

export function getKnownHash(db: Database.Database, path: string): string | undefined {
  const row = db.prepare('SELECT content_hash FROM notes WHERE path = ?').get(path) as
    | { content_hash: string }
    | undefined
  return row?.content_hash
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkMarkdownFiles(full)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Wipes and rescans the vault from disk. This is the "if the db and the
 * files disagree, the files win" recovery path — the index is a disposable
 * cache, never the source of truth.
 */
export async function rebuildIndex(db: Database.Database, vaultRoot: string): Promise<void> {
  const files = await walkMarkdownFiles(vaultRoot)
  const entries: { path: string; version: FileVersion; content: string }[] = []
  for (const file of files) {
    const { content, version } = await readNote(file)
    entries.push({ path: file, version, content })
  }

  const applyAll = db.transaction((rows: typeof entries) => {
    db.prepare('DELETE FROM notes').run()
    db.prepare('DELETE FROM links').run()
    db.prepare('DELETE FROM notes_fts').run()
    for (const entry of rows) indexNote(db, entry.path, entry.version, entry.content)
  })
  applyAll(entries)
}
