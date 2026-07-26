import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNoteRefApi } from '../../src/renderer/src/lib/noteRefApi'

// createNoteRefApi doesn't touch window.vaultApi/cloudApi directly (that's
// the two hooks' job) — only window.alert, for the "no note found"/error
// paths, so a plain stub is enough without a real DOM environment.
beforeEach(() => {
  ;(globalThis as unknown as { window: { alert: ReturnType<typeof vi.fn> } }).window = { alert: vi.fn() }
})

describe('createNoteRefApi', () => {
  it('searchTitles passes through to the injected function unchanged', async () => {
    const searchTitles = vi.fn().mockResolvedValue([{ title: 'Alice', ref: '1' }])
    const api = createNoteRefApi(searchTitles, vi.fn(), vi.fn())
    const result = await api.searchTitles('ali', 'npc')
    expect(searchTitles).toHaveBeenCalledWith('ali', 'npc')
    expect(result).toEqual([{ title: 'Alice', ref: '1' }])
  })

  describe('openByTitle', () => {
    it('opens the exact case-insensitive match', async () => {
      const searchTitles = vi.fn().mockResolvedValue([{ title: 'Alice', ref: 'note-1' }])
      const openByRef = vi.fn().mockResolvedValue(undefined)
      const api = createNoteRefApi(searchTitles, openByRef, vi.fn())

      await api.openByTitle('alice')

      expect(openByRef).toHaveBeenCalledWith('note-1')
      expect(window.alert).not.toHaveBeenCalled()
    })

    it('alerts instead of opening when no exact match exists', async () => {
      const searchTitles = vi.fn().mockResolvedValue([{ title: 'Bob', ref: 'note-2' }])
      const openByRef = vi.fn()
      const api = createNoteRefApi(searchTitles, openByRef, vi.fn())

      await api.openByTitle('Alice')

      expect(openByRef).not.toHaveBeenCalled()
      expect(window.alert).toHaveBeenCalledWith('No note titled "Alice" yet.')
    })

    it('alerts with the error message instead of throwing on failure', async () => {
      const searchTitles = vi.fn().mockRejectedValue(new Error('network down'))
      const api = createNoteRefApi(searchTitles, vi.fn(), vi.fn())

      await expect(api.openByTitle('Alice')).resolves.toBeUndefined()
      expect(window.alert).toHaveBeenCalledWith('network down')
    })
  })

  describe('readBodyByTitle', () => {
    it('returns the body of the exact match', async () => {
      const searchTitles = vi.fn().mockResolvedValue([{ title: 'Fighter', ref: 'cr-1' }])
      const readBodyByRef = vi.fn().mockResolvedValue('## Level 1\nSecond Wind')
      const api = createNoteRefApi(searchTitles, vi.fn(), readBodyByRef)

      const body = await api.readBodyByTitle('fighter')

      expect(readBodyByRef).toHaveBeenCalledWith('cr-1')
      expect(body).toBe('## Level 1\nSecond Wind')
    })

    it('returns null without calling readBodyByRef when there is no exact match', async () => {
      const searchTitles = vi.fn().mockResolvedValue([])
      const readBodyByRef = vi.fn()
      const api = createNoteRefApi(searchTitles, vi.fn(), readBodyByRef)

      const body = await api.readBodyByTitle('Fighter')

      expect(body).toBeNull()
      expect(readBodyByRef).not.toHaveBeenCalled()
    })
  })
})
