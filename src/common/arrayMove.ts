// Swaps the item at `index` with its neighbor in `direction` — used
// wherever list ORDER carries meaning (calendar months/week days/eras, where
// position determines day-of-year/day-of-week math), unlike most other
// array-of-records fields in this codebase (settlement districts, wealth
// tiers, ...) where order is cosmetic only and no reorder control exists.
// No-op (returns the same array) at either end, so callers can render a
// move button unconditionally without checking bounds themselves.
export function arrayMove<T>(arr: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= arr.length) return arr
  const next = [...arr]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
