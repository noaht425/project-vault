import { ABILITY_KEYS, formatModifier, type AbilityKey, type AbilityScores } from '../../../../common/noteTypes/creatureStats'

const LABELS: Record<AbilityKey, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA'
}

export function AbilityScoreGrid({
  stats,
  onChange
}: {
  stats: AbilityScores
  onChange: (key: AbilityKey, value: number) => void
}): React.JSX.Element {
  return (
    <div className="ability-grid">
      {ABILITY_KEYS.map((key) => (
        <label key={key} className="ability-box">
          <span className="ability-label">{LABELS[key]}</span>
          <input type="number" value={stats[key]} onChange={(e) => onChange(key, Number(e.target.value))} />
          <span className="ability-mod">{formatModifier(stats[key])}</span>
        </label>
      ))}
    </div>
  )
}
