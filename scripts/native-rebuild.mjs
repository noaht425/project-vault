#!/usr/bin/env node
// better-sqlite3 is a native module compiled against a specific Node ABI.
// The app runs under Electron's bundled Node (one ABI); `vitest` runs
// under the system Node (a different ABI). Whichever one last fetched its
// binary "wins" until the other is fetched again — so `npm test` and
// `npm run dev`/`build` each make sure the binary matching THEIR runtime
// is in place first, via this script.
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  console.error('Usage: node scripts/native-rebuild.mjs <node|electron>')
  process.exit(1)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const betterSqlite3Dir = join(root, 'node_modules', 'better-sqlite3')
const prebuildInstall = join(root, 'node_modules', '.bin', 'prebuild-install')

const runtimeTarget =
  target === 'electron'
    ? JSON.parse(await readFile(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
    : process.versions.node

execFileSync(
  prebuildInstall,
  ['--runtime', target, '--target', runtimeTarget, '--arch', process.arch, '--platform', process.platform],
  { cwd: betterSqlite3Dir, stdio: 'inherit' }
)
