import { create } from 'zustand'
import { rollDice, type DiceRollResult } from '../../../common/dice'

const HISTORY_KEY = 'diceHistory'
const MAX_HISTORY = 50

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

interface DiceState {
  history: DiceRollResult[]
  roll: (notation: string) => DiceRollResult | null
  clearHistory: () => void
}

export const useDiceStore = create<DiceState>((set, get) => ({
  history: loadHistory(),

  roll: (notation) => {
    const result = rollDice(notation)
    if (!result) return null
    const history = [result, ...get().history].slice(0, MAX_HISTORY)
    set({ history })
    saveHistory(history)
    return result
  },

  clearHistory: () => {
    set({ history: [] })
    saveHistory([])
  }
}))
