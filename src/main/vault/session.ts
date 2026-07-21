import { promises as fs } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { shell } from 'electron'
import type Database from 'better-sqlite3'
import { fileWriteQueue, readNote as readNoteFromDisk, readVersion } from './fileWriteQueue'
import { stringifyNote } from '../../common/frontmatter'
import { defaultPcFrontmatter } from '../../common/noteTypes/pc'
import { defaultNpcFrontmatter } from '../../common/noteTypes/npc'
import { defaultClassReferenceFrontmatter } from '../../common/noteTypes/classReference'
import { defaultSessionFrontmatter, sessionFrontmatterSchema } from '../../common/noteTypes/session'
import { defaultEventFrontmatter, eventFrontmatterSchema } from '../../common/noteTypes/event'
import { defaultFactionFrontmatter } from '../../common/noteTypes/faction'
import { defaultItemFrontmatter } from '../../common/noteTypes/item'
import { defaultLocationFrontmatter } from '../../common/noteTypes/location'
import { parseNote } from '../../common/frontmatter'
import { buildTree } from './tree'
import { createVaultWatcher, type VaultWatcher } from './watcher'
import { openVaultDb, vaultDbPath } from '../index-db/db'
import { getKnownHash, indexNote, rebuildIndex, removeNote, titleFromPath, toFtsQuery } from '../index-db/indexer'
import { SNIPPET_MATCH_START, SNIPPET_MATCH_END } from '../../common/searchSnippet'
import type { z } from 'zod'
import type {
  Backlink,
  EventSummary,
  ExternalChangeEvent,
  NoteData,
  NoteTemplate,
  NoteTitleMatch,
  SaveNoteRequest,
  SaveNoteResult,
  SearchResult,
  SessionSummary,
  TreeEntry,
  VaultOpenResult
} from '../../common/types'

export interface VaultSessionHandlers {
  onExternalChange(event: ExternalChangeEvent): void
  onTreeUpdated(tree: TreeEntry[]): void
  onVaultOpened(vaultPath: string): void
}

export class VaultSession {
  private vaultRoot: string | null = null
  private db: Database.Database | null = null
  private watcher: VaultWatcher | null = null

  constructor(
    private readonly userDataDir: string,
    private readonly handlers: VaultSessionHandlers
  ) {}

  async openVault(vaultRoot: string): Promise<VaultOpenResult> {
    await this.closeVault()

    this.vaultRoot = vaultRoot
    this.db = openVaultDb(vaultDbPath(this.userDataDir, vaultRoot))
    await rebuildIndex(this.db, vaultRoot)

    this.watcher = createVaultWatcher(vaultRoot, {
      getKnownHash: (path) => getKnownHash(this.db!, path),
      onExternalChange: (event) => {
        void (async () => {
          if (event.kind === 'unlink') {
            removeNote(this.db!, event.path)
          } else {
            const note = await readNoteFromDisk(event.path)
            indexNote(this.db!, event.path, note.version, note.content)
          }
          this.handlers.onExternalChange(event)
          await this.refreshTree()
        })()
      }
    })

    const tree = await buildTree(vaultRoot)
    this.handlers.onVaultOpened(vaultRoot)
    return { vaultPath: vaultRoot, tree }
  }

  async getCurrentVault(): Promise<VaultOpenResult | null> {
    if (!this.vaultRoot) return null
    return { vaultPath: this.vaultRoot, tree: await buildTree(this.vaultRoot) }
  }

  async closeVault(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.vaultRoot = null
  }

  private requireVault(): string {
    if (!this.vaultRoot) throw new Error('No vault is open')
    return this.vaultRoot
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('No vault is open')
    return this.db
  }

  private async refreshTree(): Promise<void> {
    const root = this.requireVault()
    this.handlers.onTreeUpdated(await buildTree(root))
  }

  async getTree(): Promise<TreeEntry[]> {
    return buildTree(this.requireVault())
  }

  async readNote(path: string): Promise<NoteData> {
    const { content, version } = await readNoteFromDisk(path)
    return { path, content, version }
  }

  async saveNote(req: SaveNoteRequest): Promise<SaveNoteResult> {
    const db = this.requireDb()
    const result = await fileWriteQueue.saveFile(req.path, req.content, req.baseVersion)

    if (result.status === 'saved') {
      indexNote(db, req.path, result.version, req.content)
    } else {
      // Re-sync the index with whatever is actually on disk at the
      // original path (it changed out from under us), and index the new
      // conflict copy we just wrote.
      const actual = await readNoteFromDisk(req.path).catch(() => null)
      if (actual) indexNote(db, req.path, actual.version, actual.content)
      const conflictNote = await readNoteFromDisk(result.conflictPath).catch(() => null)
      if (conflictNote) indexNote(db, result.conflictPath, conflictNote.version, conflictNote.content)
    }

    await this.refreshTree()
    return result
  }

  async createNote(parentDir: string, name: string, template: NoteTemplate = 'note'): Promise<NoteData> {
    const db = this.requireDb()
    const fileName = name.endsWith('.md') ? name : `${name}.md`
    const path = join(parentDir, fileName)

    const existing = await readVersion(path)
    if (existing) throw new Error(`A note named "${fileName}" already exists here.`)

    // No auto-inserted "# Title" heading here — the editor's own title bar
    // (derived from the filename) already shows the name, and a heading in
    // the body would only drift out of sync on rename since renaming never
    // touches file content.
    const frontmatter =
      template === 'pc'
        ? defaultPcFrontmatter()
        : template === 'npc'
          ? defaultNpcFrontmatter()
          : template === 'class-reference'
            ? defaultClassReferenceFrontmatter()
            : template === 'session'
              ? defaultSessionFrontmatter()
              : template === 'event'
                ? defaultEventFrontmatter()
                : template === 'faction'
                  ? defaultFactionFrontmatter()
                  : template === 'item'
                    ? defaultItemFrontmatter()
                    : template === 'location'
                      ? defaultLocationFrontmatter()
                      : { type: 'note', tags: [] }
    const body =
      template === 'class-reference'
        ? '\n*Add a "## Level N" heading for each level this subclass actually gets a feature at — skip any that don\'t apply.*\n\n'
        : '\n'
    const content = stringifyNote({ frontmatter, body })

    const result = await fileWriteQueue.saveFile(path, content, null)
    if (result.status !== 'saved') {
      throw new Error('Could not create note: a file unexpectedly already exists at this path.')
    }
    indexNote(db, path, result.version, content)
    await this.refreshTree()
    return { path, content, version: result.version }
  }

  async createFolder(parentDir: string, name: string): Promise<void> {
    await fs.mkdir(join(parentDir, name), { recursive: false })
    await this.refreshTree()
  }

  async renameNote(path: string, newName: string): Promise<{ newPath: string }> {
    const ext = extname(path)
    const fileName = newName.endsWith(ext) ? newName : `${newName}${ext}`
    const newPath = join(dirname(path), fileName)
    return this.movePath(path, newPath)
  }

  async movePath(path: string, newPath: string): Promise<{ newPath: string }> {
    const db = this.requireDb()
    if (path === newPath) return { newPath }

    // A plain existence check on newPath false-positives for a case-only
    // rename on a case-insensitive filesystem (macOS APFS, Windows NTFS
    // default) — "Untitled.md" -> "untitled.md" resolves newPath to the
    // very file we're about to rename, which hasn't moved yet. Comparing
    // inodes distinguishes "this is actually a different file" from "this
    // is the same file, just seen through its not-yet-renamed name."
    const sourceStat = await fs.stat(path)
    const destStat = await fs.stat(newPath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    })
    if (destStat && destStat.ino !== sourceStat.ino) {
      throw new Error('A file or folder already exists at the destination.')
    }

    await fs.rename(path, newPath)

    if (sourceStat.isDirectory()) {
      // Every file under a renamed/moved folder just changed path — a full
      // rescan is simpler and less error-prone than remapping each path by
      // hand, and the index is disposable/cheap to rebuild anyway.
      await rebuildIndex(db, this.requireVault())
    } else {
      removeNote(db, path)
      const { content, version } = await readNoteFromDisk(newPath)
      indexNote(db, newPath, version, content)
    }

    await this.refreshTree()
    return { newPath }
  }

  async searchTitles(query: string, type?: string): Promise<NoteTitleMatch[]> {
    const db = this.requireDb()
    const rows = type
      ? (db
          .prepare('SELECT path, title FROM notes WHERE title LIKE ? AND type = ? ORDER BY title LIMIT 20')
          .all(`%${query}%`, type) as { path: string; title: string }[])
      : (db
          .prepare('SELECT path, title FROM notes WHERE title LIKE ? ORDER BY title LIMIT 20')
          .all(`%${query}%`) as { path: string; title: string }[])
    return rows
  }

  async searchFullText(query: string, type?: string): Promise<SearchResult[]> {
    const db = this.requireDb()
    const ftsQuery = toFtsQuery(query)
    if (!ftsQuery) return []

    // snippet()'s column arg of -1 lets SQLite pick whichever indexed
    // column (title/body/metadata) best matched, rather than assuming body.
    // notes_fts can't be aliased on the side that appears in MATCH — FTS5
    // only recognizes the real virtual table name there ("f MATCH ?"
    // fails with "no such column: f" even though f.path works everywhere
    // else in the query).
    const sql = `
      SELECT notes_fts.path AS path, n.title AS title, n.type AS type,
             snippet(notes_fts, -1, ?, ?, '…', 10) AS snippet
      FROM notes_fts
      JOIN notes n ON n.path = notes_fts.path
      WHERE notes_fts MATCH ?
      ${type ? 'AND n.type = ?' : ''}
      ORDER BY rank
      LIMIT 30
    `
    const params: unknown[] = [SNIPPET_MATCH_START, SNIPPET_MATCH_END, ftsQuery]
    if (type) params.push(type)

    return db.prepare(sql).all(...params) as SearchResult[]
  }

  /**
   * Shared by listSessions/listEvents — both are just "every note of this
   * type, sorted by its date field." Sorts fine as plain string comparison
   * as long as dates are consistently formatted; undated entries sort
   * first since '' < any digit/letter.
   */
  private async listByDateType(
    type: string,
    schema: z.ZodType<{ date: string; summary: string }>
  ): Promise<{ path: string; title: string; date: string; summary: string }[]> {
    const db = this.requireDb()
    const rows = db.prepare('SELECT path FROM notes WHERE type = ?').all(type) as { path: string }[]

    const summaries: { path: string; title: string; date: string; summary: string }[] = []
    for (const row of rows) {
      const note = await readNoteFromDisk(row.path).catch(() => null)
      if (!note) continue
      const parsed = schema.safeParse(parseNote(note.content).frontmatter)
      summaries.push({
        path: row.path,
        title: titleFromPath(row.path),
        date: parsed.success ? parsed.data.date : '',
        summary: parsed.success ? parsed.data.summary : ''
      })
    }

    return summaries.sort((a, b) => a.date.localeCompare(b.date))
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.listByDateType('session', sessionFrontmatterSchema)
  }

  async listEvents(): Promise<EventSummary[]> {
    return this.listByDateType('event', eventFrontmatterSchema)
  }

  async getBacklinks(path: string): Promise<Backlink[]> {
    const db = this.requireDb()
    const title = titleFromPath(path)
    const rows = db
      .prepare(
        `SELECT DISTINCT n.path AS sourcePath, n.title AS sourceTitle
         FROM links l
         JOIN notes n ON n.path = l.source_path
         WHERE l.target_title = ? AND l.source_path != ?
         ORDER BY n.title`
      )
      .all(title, path) as { sourcePath: string; sourceTitle: string }[]
    return rows
  }

  async deleteNote(path: string): Promise<void> {
    const db = this.requireDb()
    const trashed = await shell.trashItem(path).then(
      () => true,
      () => false
    )
    if (!trashed) await fs.unlink(path)
    removeNote(db, path)
    await this.refreshTree()
  }
}
