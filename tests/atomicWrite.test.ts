import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWrite } from '../src/main/vault/atomicWrite'

const dirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'vault-atomic-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('atomicWrite', () => {
  it('writes content that can be read back exactly', async () => {
    const dir = await makeTmpDir()
    const target = join(dir, 'note.md')
    await atomicWrite(target, 'hello world\n')
    expect(await fs.readFile(target, 'utf8')).toBe('hello world\n')
  })

  it('leaves no temp file behind after a successful write', async () => {
    const dir = await makeTmpDir()
    const target = join(dir, 'note.md')
    await atomicWrite(target, 'content\n')
    const files = await fs.readdir(dir)
    expect(files).toEqual(['note.md'])
  })

  it('overwrites an existing file atomically (readers never see a torn write)', async () => {
    const dir = await makeTmpDir()
    const target = join(dir, 'note.md')
    await atomicWrite(target, 'version 1\n')

    const bigContent = 'x'.repeat(500_000) + '\n' // large enough that a naive in-place write would take measurable time
    await atomicWrite(target, bigContent)

    const finalContent = await fs.readFile(target, 'utf8')
    expect(finalContent).toBe(bigContent)
  })

  it('rejects (rather than hanging or partially writing) when the target directory does not exist', async () => {
    const dir = await makeTmpDir()
    const missingDir = join(dir, 'does-not-exist')
    await expect(atomicWrite(join(missingDir, 'note.md'), 'x')).rejects.toThrow()
  })
})
