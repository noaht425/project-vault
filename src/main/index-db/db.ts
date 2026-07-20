import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/**
 * The index lives outside the vault (in the app's userData dir), keyed by
 * a hash of the vault's absolute path. This keeps the vault folder 100%
 * plain markdown — nothing app-specific shows up when the user browses it
 * in Finder or another editor — and means the file watcher never has to
 * worry about the index file appearing in its own event stream.
 */
export function vaultDbPath(userDataDir: string, vaultRoot: string): string {
  const dir = join(userDataDir, 'vault-indexes')
  mkdirSync(dir, { recursive: true })
  const key = createHash('sha256').update(vaultRoot).digest('hex').slice(0, 16)
  return join(dir, `${key}.sqlite`)
}

export function openVaultDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  // The index is a disposable cache, fully rebuilt from disk every time a
  // vault is opened (see rebuildIndex) — dropping and recreating here means
  // schema changes between app versions never need a migration path.
  db.exec(`
    DROP TABLE IF EXISTS notes;
    DROP TABLE IF EXISTS links;

    CREATE TABLE notes (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL COLLATE NOCASE,
      mtime_ms REAL NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_notes_title ON notes(title);

    CREATE TABLE links (
      source_path TEXT NOT NULL,
      target_title TEXT NOT NULL COLLATE NOCASE
    );
    CREATE INDEX idx_links_source ON links(source_path);
    CREATE INDEX idx_links_target ON links(target_title);
  `)
  return db
}
