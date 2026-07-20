export function CommonCombatFields({
  ac,
  hp,
  maxHp,
  onChange
}: {
  ac: number
  hp: number
  maxHp: number
  onChange: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  return (
    <>
      <label className="sheet-field sheet-field-narrow">
        AC
        <input type="number" value={ac} onChange={(e) => onChange({ ac: Number(e.target.value) })} />
      </label>
      <label className="sheet-field sheet-field-narrow">
        HP
        <input type="number" value={hp} onChange={(e) => onChange({ hp: Number(e.target.value) })} />
      </label>
      <label className="sheet-field sheet-field-narrow">
        Max HP
        <input type="number" value={maxHp} onChange={(e) => onChange({ maxHp: Number(e.target.value) })} />
      </label>
    </>
  )
}
