import { describe, it, expect } from 'vitest'
import { DEFAULT_CONDITIONS } from '../src/common/conditions'

describe('DEFAULT_CONDITIONS', () => {
  it('has no blank names or descriptions', () => {
    for (const c of DEFAULT_CONDITIONS) {
      expect(c.name.trim()).not.toBe('')
      expect(c.description.trim()).not.toBe('')
    }
  })

  it('has no duplicate names', () => {
    const names = DEFAULT_CONDITIONS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('includes all six exhaustion levels', () => {
    for (let level = 1; level <= 6; level++) {
      expect(DEFAULT_CONDITIONS.some((c) => c.name === `Exhaustion ${level}`)).toBe(true)
    }
  })
})
