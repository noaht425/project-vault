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

function typeFromFrontmatter(content: string): string {
  const { frontmatter } = parseNote(content)
  return typeof frontmatter.type === 'string' && frontmatter.type ? frontmatter.type : 'note'
}

/**
 * Upserts a note's row and fully replaces its outgoing links. Needs the
 * note's content (not just its path/version) so it can re-extract
 * [[wiki-links]] and its frontmatter `type` — every caller that changes
 * what's on disk should have that content on hand already (it just wrote
 * or just read it).
 */
export function indexNote(db: Database.Database, path: string, version: FileVersion, content: string): void {
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
    title: titleFromPath(path),
    type: typeFromFrontmatter(content),
    mtimeMs: version.mtimeMs,
    contentHash: version.contentHash,
    updatedAt: new Date().toISOString()
  })

  db.prepare('DELETE FROM links WHERE source_path = ?').run(path)
  const insertLink = db.prepare('INSERT INTO links (source_path, target_title) VALUES (?, ?)')
  for (const title of extractWikiLinkTitles(content)) {
    insertLink.run(path, title)
  }
}

export function removeNote(db: Database.Database, path: string): void {
  db.prepare('DELETE FROM notes WHERE path = ?').run(path)
  db.prepare('DELETE FROM links WHERE source_path = ?').run(path)
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
    for (const entry of rows) indexNote(db, entry.path, entry.version, entry.content)
  })
  applyAll(entries)
}
