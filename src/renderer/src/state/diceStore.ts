import { create } from 'zustand'
import { rollDice, type DiceRollResult } from '../../../common/dice'

const HISTORY_KEY = 'diceHistory'
const REROLL_MODE_KEY = 'diceRerollMode'
const MAX_HISTORY = 50

export type RerollMode = 'off' | 'ones' | 'ones-and-twos'

// Great Weapon Fighting-style reroll: any die at or below the mode's
// threshold gets rerolled once, keeping whatever it lands on next.
// Mutually exclusive with each other — "ones" is a strict subset of
// "ones-and-twos", so having both on at once wouldn't mean anything beyond
// just "ones-and-twos" — a single mode field keeps that from being
// representable instead of needing to guard against it.
const REROLL_THRESHOLDS: Record<Exclude<RerollMode, 'off'>, number> = {
  ones: 1,
  'ones-and-twos': 2
}

function loadHistory(): DiceRollResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Drop any entries from an older result shape (pre-multi-term dice
    // expressions) rather than let them crash the history renderer.
    return parsed.filter(
      (entry): entry is DiceRollResult => !!entry && Array.isArray((entry as DiceRollResult).groups)
    )
  } catch {
    return []
  }
}

function saveHistory(history: DiceRollResult[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
}

function loadRerollMode(): RerollMode {
  try {
    const raw = localStorage.getItem(REROLL_MODE_KEY)
    return raw === 'ones' || raw === 'ones-and-twos' ? raw : 'off'
  } catch {
    return 'off'
  }
}

interface DiceState {
  history: DiceRollResult[]
  // Persists across rolls (not a one-off action) since it's meant to stay
  // set for a whole string of damage rolls rather than be re-toggled each
  // time.
  rerollMode: RerollMode
  roll: (notation: string) => DiceRollResult | null
  clearHistory: () => void
  setRerollMode: (mode: RerollMode) => void
}

export const useDiceStore = create<DiceState>((set, get) => ({
  history: loadHistory(),
  rerollMode: loadRerollMode(),

  roll: (notation) => {
    const mode = get().rerollMode
    const options = mode === 'off' ? {} : { rerollAtOrBelow: REROLL_THRESHOLDS[mode] }
    const result = rollDice(notation, undefined, options)
    if (!result) return null
    const history = [result, ...get().history].slice(0, MAX_HISTORY)
    set({ history })
    saveHistory(history)
    return result
  },

  clearHistory: () => {
    set({ history: [] })
    saveHistory([])
  },

  setRerollMode: (mode) => {
    set({ rerollMode: mode })
    try {
      localStorage.setItem(REROLL_MODE_KEY, mode)
    } catch {
      // localStorage can throw in restrictive environments — the toggle
      // still works for the rest of the session, it just won't persist.
    }
  }
}))
