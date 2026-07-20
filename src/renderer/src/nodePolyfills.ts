// gray-matter (and its js-yaml dependency) expect Node's global Buffer/process
// to exist. The renderer is a browser context and has neither by default —
// this file must be imported before anything that touches gray-matter
// (see main.tsx, first import).
import { Buffer } from 'buffer'
import process from 'process'

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: unknown }
g.Buffer ??= Buffer
g.process ??= process
