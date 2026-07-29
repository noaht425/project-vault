import { promises as fs } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { shell } from 'electron'
import type Database from 'better-sqlite3'
import { fileWriteQueue, readNote as readNoteFromDisk, readVersion } from './fileWriteQueue'
import { stringifyNote, parseNote } from '../../common/frontmatter'
import { sessionFrontmatterSchema } from '../../common/noteTypes/session'
import { eventFrontmatterSchema } from '../../common/noteTypes/event'
import { calendarFrontmatterSchema } from '../../common/noteTypes/calendar'
import { extractHistoryFacts, extractBornDiedFacts } from '../../common/worldTimeline'
import { compareWorldDates } from '../../common/worldDate'
import { computeDateMigration, type CalendarCandidate } from '../../common/dateMigration'
import { buildGraph, type GraphData } from '../../common/graph'
import { TEMPLATE_DEFAULTS, TEMPLATE_STARTER_BODY } from '../../common/noteTemplateDefaults'
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
  VaultOpenResult,
  VaultSettings
} from '../../common/types'

// Hidden (dot-prefixed) file at the vault root — both tree.ts's buildTree
// and index-db/indexer.ts's rebuildIndex already skip any dot-prefixed
// entry, so this is automatically invisible to the file tree and search
// index with no special-casing needed elsewhere, same as any other dotfile
// a vault might contain.
const VAULT_SETTINGS_FILENAME = '.project-vault-settings.json'

// searchTitles powers every autocomplete/datalist picker in the app
// (Location/Calendar fields, the Settlement religion picker, Family Tree's
// person picker, ...). A picker with no type filter — Family Tree's, e.g.,
// which spans every note in the vault — can easily have more than a couple
// dozen candidates; a low cap combined with `ORDER BY title` silently hides
// anything alphabetically past the cutoff (confirmed bug: a PC named
// starting with a later letter never appeared while an earlier-alphabet one
// did). High enough that it's effectively "no vault will ever hit this" for
// a single-user campaign tool, while still bounding a pathological case.
const SEARCH_TITLES_LIMIT = 500

function defaultVaultSettings(): VaultSettings {
  return { activeCalendarNoteTitles: [] }
}

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
    // Fire-and-forget: an enhancement, not required for the vault to be
    // usable — a failure here must never block opening the vault itself.
    // Safe to run on every open (see computeDateMigration's own idempotency
    // comment): only events with no structuredDate yet are ever touched.
    void this.migrateEventDates().catch((err) => console.error('Event date migration failed:', err))
    return { vaultPath: vaultRoot, tree }
  }

  /**
   * Step 5 of docs/plans/2026-07-28-calendar-timeline-system.md — populates
   * event.structuredDate from the existing free-text date field by
   * matching it against whatever `calendar` notes exist in this vault (see
   * common/dateMigration.ts for the actual matching logic, kept pure/
   * shared with a future cloud-side equivalent). Confirmed with the user:
   * runs automatically on every vault open rather than as a manual action,
   * and any event whose date can't be matched to a calendar is left
   * undated (original free text untouched either way).
   */
  private async migrateEventDates(): Promise<void> {
    const db = this.requireDb()
    const rows = db.prepare(`SELECT path, type FROM notes WHERE type IN ('event', 'calendar')`).all() as {
      path: string
      type: string
    }[]

    const calendars: CalendarCandidate[] = []
    const events: { path: string; date: string; hasStructuredDate: boolean }[] = []

    for (const row of rows) {
      const note = await readNoteFromDisk(row.path).catch(() => null)
      if (!note) continue
      const { frontmatter } = parseNote(note.content)

      if (row.type === 'calendar') {
        const parsed = calendarFrontmatterSchema.safeParse(frontmatter)
        if (parsed.success) calendars.push({ noteTitle: titleFromPath(row.path), frontmatter: parsed.data })
      } else {
        const parsed = eventFrontmatterSchema.safeParse(frontmatter)
        if (parsed.success) events.push({ path: row.path, date: parsed.data.date, hasStructuredDate: parsed.data.structuredDate !== null })
      }
    }

    if (calendars.length === 0) return // nothing to migrate against yet

    for (const update of computeDateMigration(events, calendars)) {
      // Re-read fresh right before writing (rather than reusing the read
      // above) so a concurrent edit to this exact note during the scan is
      // still caught by saveFile's version check instead of silently
      // clobbered.
      const note = await readNoteFromDisk(update.path).catch(() => null)
      if (!note) continue
      const { frontmatter, body } = parseNote(note.content)
      const content = stringifyNote({ frontmatter: { ...frontmatter, structuredDate: update.structuredDate }, body })
      const result = await fileWriteQueue.saveFile(update.path, content, note.version)
      // On conflict: skip silently, same as leaving an unparseable date
      // undated — the note changed since the scan, and the next vault open
      // will simply retry against whatever's there then.
      if (result.status === 'saved') indexNote(db, update.path, result.version, content)
    }

    await this.refreshTree()
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
    const frontmatter = TEMPLATE_DEFAULTS[template]?.() ?? { type: 'note', tags: [] }
    const body = TEMPLATE_STARTER_BODY[template] ?? '\n'
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

  /** Step 6 of docs/plans/2026-07-28-calendar-timeline-system.md — per-vault
   * (confirmed with the user, not per-user) list of which calendar notes
   * currently format displayed dates. Missing/corrupt file reads back as
   * defaults rather than throwing, same "don't fail vault-open over an
   * optional enhancement" spirit as migrateEventDates. */
  async getSettings(): Promise<VaultSettings> {
    const root = this.requireVault()
    try {
      const raw = await fs.readFile(join(root, VAULT_SETTINGS_FILENAME), 'utf8')
      const parsed = JSON.parse(raw)
      return { activeCalendarNoteTitles: Array.isArray(parsed?.activeCalendarNoteTitles) ? parsed.activeCalendarNoteTitles : [] }
    } catch {
      return defaultVaultSettings()
    }
  }

  async updateSettings(patch: Partial<VaultSettings>): Promise<VaultSettings> {
    const root = this.requireVault()
    const current = await this.getSettings()
    const next = { ...current, ...patch }
    await fs.writeFile(join(root, VAULT_SETTINGS_FILENAME), JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  async searchTitles(query: string, type?: string): Promise<NoteTitleMatch[]> {
    const db = this.requireDb()
    const rows = type
      ? (db
          .prepare(`SELECT path, title FROM notes WHERE title LIKE ? AND type = ? ORDER BY title LIMIT ${SEARCH_TITLES_LIMIT}`)
          .all(`%${query}%`, type) as { path: string; title: string }[])
      : (db
          .prepare(`SELECT path, title FROM notes WHERE title LIKE ? ORDER BY title LIMIT ${SEARCH_TITLES_LIMIT}`)
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
   * Used by listSessions — "every note of this type, sorted by its date
   * field." Sorts fine as plain string comparison since session dates are
   * real-world ISO dates (see noteTypes/session.ts); undated entries sort
   * first since '' < any digit. listEvents has its own logic below, since
   * it scans every note (not just type "event") and its dates are in-world
   * fictional dates that need calendar-aware sorting instead.
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

  /**
   * The Events timeline shows the whole world's history, not just notes of
   * type "event" — every note gets scanned for a "## History" section and
   * bare "Born:"/"Died:" lines (see common/worldTimeline.ts) so a kingdom's
   * founding or a king's death shows up alongside dedicated Event notes.
   * Sorted with compareWorldDates, which understands the in-world AF/AM
   * calendar (session dates are real-world ISO dates, so listSessions
   * keeps the plain string sort above).
   */
  async listEvents(): Promise<EventSummary[]> {
    const db = this.requireDb()
    const rows = db.prepare('SELECT path, type FROM notes').all() as { path: string; type: string }[]

    const entries: EventSummary[] = []
    for (const row of rows) {
      const note = await readNoteFromDisk(row.path).catch(() => null)
      if (!note) continue
      const { frontmatter, body } = parseNote(note.content)
      const title = titleFromPath(row.path)

      if (row.type === 'event') {
        const parsed = eventFrontmatterSchema.safeParse(frontmatter)
        entries.push({
          path: row.path,
          title,
          date: parsed.success ? parsed.data.date : '',
          summary: parsed.success ? parsed.data.summary : '',
          noteType: 'event',
          location: parsed.success ? parsed.data.location : null,
          structuredDate: parsed.success ? parsed.data.structuredDate : null
        })
      }

      for (const fact of [...extractHistoryFacts(body), ...extractBornDiedFacts(body)]) {
        entries.push({
          path: row.path,
          title,
          date: fact.date,
          summary: fact.description,
          noteType: row.type
        })
      }
    }

    return entries.sort((a, b) => compareWorldDates(a.date, b.date))
  }

  /** Every note as a node and every [[wiki-link]] as an edge — see common/graph.ts for the actual graph-building logic. */
  async getGraph(): Promise<GraphData> {
    const db = this.requireDb()
    const notes = db.prepare('SELECT path, title, type FROM notes').all() as {
      path: string
      title: string
      type: string
    }[]
    const links = db.prepare('SELECT source_path AS sourcePath, target_title AS targetTitle FROM links').all() as {
      sourcePath: string
      targetTitle: string
    }[]
    return buildGraph(notes, links)
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
