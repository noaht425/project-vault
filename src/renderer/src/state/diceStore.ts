import { create } from 'zustand'
import { rollDice, type DiceRollResult } from '../../../common/dice'

const HISTORY_KEY = 'diceHistory'
const REROLL_LOW_KEY = 'diceRerollLowRolls'
const MAX_HISTORY = 50
// Great Weapon Fighting-style reroll: any die at or below this face gets
// rerolled once, keeping whatever it lands on next.
const REROLL_THRESHOLD = 2

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

function loadRerollLowRolls(): boolean {
  try {
    return localStorage.getItem(REROLL_LOW_KEY) === 'true'
  } catch {
    return false
  }
}

interface DiceState {
  history: DiceRollResult[]
  // When on, every roll rerolls 1s and 2s once (Great Weapon Fighting-style)
  // instead of a one-off action, since it's meant to stay set for a string
  // of damage rolls rather than be re-toggled each time.
  rerollLowRolls: boolean
  roll: (notation: string) => DiceRollResult | null
  clearHistory: () => void
  toggleRerollLowRolls: () => void
}

export const useDiceStore = create<DiceState>((set, get) => ({
  history: loadHistory(),
  rerollLowRolls: loadRerollLowRolls(),

  roll: (notation) => {
    const options = get().rerollLowRolls ? { rerollAtOrBelow: REROLL_THRESHOLD } : {}
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

  toggleRerollLowRolls: () => {
    const next = !get().rerollLowRolls
    set({ rerollLowRolls: next })
    try {
      localStorage.setItem(REROLL_LOW_KEY, String(next))
    } catch {
      // localStorage can throw in restrictive environments — the toggle
      // still works for the rest of the session, it just won't persist.
    }
  }
}))
