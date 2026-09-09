import { useCallback, useMemo, useRef, useState } from 'react'
import { parseNote } from '@common/frontmatter'
import {
  ABILITIES,
  BUILDER_CONDITIONS,
  DAMAGE_TYPES,
  defaultSetup,
  draftToCombatant,
  emptyDraft,
  exportCustomMonsters,
  loadCustomMonsters,
  loadoutSummary,
  monsterOptions,
  npcNoteToMonster,
  parseStatblock,
  pcNoteToCombatant,
  SIZES,
  standardParty,
  suggestedPb,
  SWEEP_DIMS,
  TEMPLATE_IDS,
  type BuilderDraft,
  type Combatant,
  type DamageType,
  type DmgDefense,
  type MonsterOption,
  type SimResult,
  type SimSetup,
  type SweepDim,
  type SweepOut
} from '@common/sim/ui'
import { runSimAsync, runSweepAsync } from './runner'

const SETUP_KEY = 'fightSimSetup'
const TRIAL_CHOICES = [100, 250, 500, 1000]

// localStorage only — a scenario is scratch, not campaign canon (same call the
// Initiative tracker made). It won't follow you between devices.
function loadSetup(): SimSetup {
  try {
    const raw = localStorage.getItem(SETUP_KEY)
    if (!raw) return defaultSetup()
    const parsed = JSON.parse(raw) as SimSetup
    if (!Array.isArray(parsed.party) || !Array.isArray(parsed.enemies)) return defaultSetup()
    // re-parse the stored custom pack so a stale / edited entry can't break every run
    const customMonsters = Array.isArray(parsed.customMonsters)
      ? loadCustomMonsters(parsed.customMonsters).monsters
      : []
    return { ...parsed, customMonsters }
  } catch {
    return defaultSetup()
  }
}

type Mode = 'single' | 'sweep'

export function SimulatorView(): React.JSX.Element {
  const [setup, setSetup] = useState<SimSetup>(() => loadSetup())
  const [mode, setMode] = useState<Mode>('single')
  const [result, setResult] = useState<SimResult | null>(null)
  const [sweep, setSweep] = useState<SweepOut | null>(null)
  const [sweepDim, setSweepDim] = useState<SweepDim>('level')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const options = useMemo(() => monsterOptions(setup.customMonsters), [setup.customMonsters])

  const persist = useCallback((next: SimSetup) => {
    setSetup(next)
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(next))
    } catch {
      /* non-fatal */
    }
  }, [])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      if (mode === 'single') {
        setResult(await runSimAsync(setup))
        setSweep(null)
      } else {
        setSweep(await runSweepAsync(setup, sweepDim))
        setResult(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
      setSweep(null)
    } finally {
      setRunning(false)
    }
  }, [setup, running, mode, sweepDim])

  const busy = running || setup.enemies.length === 0 || setup.party.length === 0
  const dimInfo = SWEEP_DIMS.find((d) => d.id === sweepDim)!

  return (
    <div className="sim-view">
      <div className="sim-wrap">
        <header className="sim-header">
          <h1>Fight Simulator</h1>
          <span className="sim-sub">
            Monte-Carlo a party against a stat block — win rate, TPK risk, where it breaks
          </span>
        </header>

        <EnemyEditor
          options={options}
          enemies={setup.enemies}
          onChange={(enemies) => persist({ ...setup, enemies })}
          customMonsters={setup.customMonsters}
          onCustomChange={(customMonsters) => persist({ ...setup, customMonsters })}
        />

        <PartyEditor party={setup.party} onChange={(party) => persist({ ...setup, party })} />

        <section className="sim-section">
          <div className="sim-seg">
            {(['single', 'sweep'] as Mode[]).map((m) => (
              <button
                key={m}
                className={mode === m ? 'active' : ''}
                onClick={() => setMode(m)}
              >
                {m === 'single' ? 'Single fight' : 'What-if sweep'}
              </button>
            ))}
          </div>

          <div className="sim-row sim-row-end">
            {mode === 'sweep' && (
              <label className="sim-field">
                <span>Vary</span>
                <select
                  value={sweepDim}
                  onChange={(e) => setSweepDim(e.target.value as SweepDim)}
                  style={{ minWidth: 160 }}
                >
                  {SWEEP_DIMS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="sim-field">
              <span>Trials{mode === 'sweep' ? ' / point' : ''}</span>
              <select
                style={{ minWidth: 96 }}
                value={setup.trials}
                onChange={(e) => persist({ ...setup, trials: Number(e.target.value) })}
              >
                {TRIAL_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="sim-field">
              <span>Seed</span>
              <input
                type="number"
                style={{ width: 96 }}
                value={setup.seed}
                onChange={(e) => persist({ ...setup, seed: Number(e.target.value) || 1 })}
              />
            </label>
            <button className="sim-primary" onClick={() => void run()} disabled={busy}>
              {running ? 'Running…' : mode === 'single' ? 'Run simulation' : 'Run sweep'}
            </button>
          </div>
          {mode === 'sweep' && (
            <p className="sim-sub" style={{ fontSize: 12 }}>
              {dimInfo.values.map((v) => dimInfo.fmt(v)).join(' · ')}
            </p>
          )}
        </section>

        {error && <p className="sim-error">{error}</p>}

        {result && !running && mode === 'single' && (
          <Results result={result} showLog={showLog} onToggleLog={() => setShowLog((v) => !v)} />
        )}
        {sweep && !running && mode === 'sweep' && <SweepResults out={sweep} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- enemies

function EnemyEditor({
  options,
  enemies,
  onChange,
  customMonsters,
  onCustomChange
}: {
  options: MonsterOption[]
  enemies: SimSetup['enemies']
  onChange: (e: SimSetup['enemies']) => void
  customMonsters: Combatant[]
  onCustomChange: (c: Combatant[]) => void
}): React.JSX.Element {
  const [pick, setPick] = useState('')
  const [customMsg, setCustomMsg] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [seed, setSeed] = useState<{ draft: BuilderDraft; warnings: string[] } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteErr, setPasteErr] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const byId = useMemo(() => Object.fromEntries(options.map((o) => [o.id, o])), [options])

  const add = (): void => {
    if (!pick) return
    onChange([...enemies, { id: pick, count: 1 }])
    setPick('')
  }

  const addCustom = (c: Combatant): void => {
    onCustomChange([...customMonsters.filter((m) => m.id !== c.id), c])
    setCustomMsg(`Added “${c.name}” to the custom list.`)
    setShowBuilder(false)
    setSeed(null)
  }

  const openBuilder = (s: { draft: BuilderDraft; warnings: string[] } | null): void => {
    setSeed(s)
    setShowBuilder(true)
    setPasteOpen(false)
  }

  const parsePaste = (): void => {
    setPasteErr(null)
    const r = parseStatblock(pasteText)
    if (r.draft) openBuilder({ draft: r.draft, warnings: r.warnings })
    else setPasteErr(r.error ?? "couldn't parse that")
  }

  const importFromNpcNotes = async (): Promise<void> => {
    setImporting(true)
    setCustomMsg(null)
    try {
      const matches = await window.vaultApi.searchTitles('', 'npc')
      if (!matches.length) {
        setCustomMsg('No NPC notes found in this vault.')
        return
      }
      const notes = await Promise.all(
        matches.slice(0, 40).map((m) =>
          window.vaultApi
            .readNote(m.path)
            .then((n) => {
              const parsed = parseNote(n.content)
              return { title: m.title, body: parsed.body ?? '', fm: parsed.frontmatter }
            })
            .catch(() => null)
        )
      )
      let fromBlock = 0
      let fromFm = 0
      let failed = 0
      const built: Combatant[] = []
      for (const n of notes) {
        if (!n || (n.fm as { type?: string })?.type !== 'npc') continue
        const res = npcNoteToMonster({ title: n.title, body: n.body, frontmatter: n.fm as Record<string, unknown> })
        if (res.combatant) {
          built.push(res.combatant)
          if (res.warnings.some((w) => /no "## Stat Block"/.test(w))) fromFm++
          else fromBlock++
        } else failed++
      }
      if (built.length) {
        const merged = [...customMonsters.filter((m) => !built.some((b) => b.id === m.id)), ...built]
        onCustomChange(merged)
      }
      setCustomMsg(
        `Imported ${built.length} NPC${built.length === 1 ? '' : 's'} — ${fromBlock} from a stat block, ${fromFm} from frontmatter + a generic attack${failed ? `, ${failed} failed` : ''}.`
      )
    } catch {
      setCustomMsg('No local vault open — open one to import NPCs.')
    } finally {
      setImporting(false)
    }
  }

  const onFile = async (file: File): Promise<void> => {
    setCustomMsg(null)
    const text = await file.text()
    const { monsters, errors } = loadCustomMonsters(text)
    if (monsters.length) {
      const merged = [...customMonsters.filter((m) => !monsters.some((n) => n.id === m.id)), ...monsters]
      onCustomChange(merged)
    }
    const parts = [
      monsters.length ? `Loaded ${monsters.length} stat block${monsters.length === 1 ? '' : 's'}` : 'Nothing loaded',
      errors.length ? `${errors.length} skipped: ${errors.slice(0, 2).join('; ')}${errors.length > 2 ? ' …' : ''}` : ''
    ].filter(Boolean)
    setCustomMsg(parts.join(' · '))
  }

  const exportPack = (): void => {
    const blob = new Blob([exportCustomMonsters(customMonsters)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'custom-monsters.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="sim-section">
      <div className="sim-row">
        <h2 className="sim-section-title">Enemies</h2>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
        <button className="sim-linkbtn" onClick={() => fileRef.current?.click()}>
          load JSON
        </button>
        <button
          className="sim-linkbtn"
          onClick={() => (showBuilder ? (setShowBuilder(false), setSeed(null)) : openBuilder(null))}
        >
          {showBuilder ? 'close builder' : 'make a monster'}
        </button>
        <button className="sim-linkbtn" onClick={() => setPasteOpen((v) => !v)}>
          paste a statblock
        </button>
        <button className="sim-linkbtn" onClick={() => void importFromNpcNotes()} disabled={importing}>
          {importing ? 'importing…' : 'import from NPC notes'}
        </button>
        {customMonsters.length > 0 && (
          <>
            <span className="sim-muted" style={{ fontSize: 12 }}>
              {customMonsters.length} custom loaded
            </span>
            <button className="sim-linkbtn" onClick={exportPack}>
              export
            </button>
            <button
              className="sim-x"
              onClick={() => {
                onCustomChange([])
                setCustomMsg(null)
              }}
            >
              clear
            </button>
          </>
        )}
      </div>
      {customMsg && (
        <p className="sim-sub" style={{ fontSize: 12 }}>
          {customMsg}
        </p>
      )}
      {pasteOpen && (
        <div className="sim-builder" style={{ gap: 6 }}>
          <span className="sim-muted" style={{ fontSize: 11 }}>
            Paste a stat block — markdown (5e.tools “Get as Markdown”, D&D Beyond, homebrewery) or 5e.tools bestiary JSON.
            Only paste content you have the rights to use; nothing is fetched.
          </span>
          <textarea
            style={{ width: '100%', height: 160, fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace' }}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'## Adult Red Dragon\n**Armor Class** 19\n**Hit Points** 256 (19d12 + 133)\n…'}
          />
          {pasteErr && (
            <span className="sim-tone-danger" style={{ fontSize: 12 }}>
              {pasteErr}
            </span>
          )}
          <div className="sim-row">
            <button className="sim-primary" onClick={parsePaste} disabled={!pasteText.trim()}>
              Parse into builder
            </button>
            <button onClick={() => setPasteOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {showBuilder && (
        <MonsterBuilder
          key={seed ? seed.draft.name + (seed.draft.cr ?? '') : 'blank'}
          initial={seed?.draft}
          initialWarnings={seed?.warnings}
          onSave={addCustom}
          onCancel={() => {
            setShowBuilder(false)
            setSeed(null)
          }}
        />
      )}
      <div className="sim-row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ minWidth: 210 }}>
          <option value="">Add a monster…</option>
          <optgroup label="Bosses">
            {options
              .filter((o) => o.kind === 'boss')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — CR {o.cr}
                </option>
              ))}
          </optgroup>
          <optgroup label="Monsters">
            {options
              .filter((o) => o.kind === 'monster')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — CR {o.cr}
                </option>
              ))}
          </optgroup>
          <optgroup label="Minions">
            {options
              .filter((o) => o.kind === 'minion')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — CR {o.cr}
                </option>
              ))}
          </optgroup>
        </select>
        <button onClick={add} disabled={!pick}>
          Add
        </button>
      </div>
      {enemies.length === 0 ? (
        <p className="sim-sub">No enemies yet.</p>
      ) : (
        <ul className="sim-list">
          {enemies.map((e, i) => (
            <li key={i} className="sim-card">
              <div className="sim-card-head">
                <span className="grow">
                  {byId[e.id]?.name ?? e.id} <span className="sim-muted">CR {byId[e.id]?.cr ?? '?'}</span>
                </span>
                <Stepper
                  value={e.count}
                  min={1}
                  max={12}
                  onChange={(count) =>
                    onChange(enemies.map((x, xi) => (xi === i ? { ...x, count } : x)))
                  }
                  suffix="×"
                />
                <button
                  className="sim-x"
                  onClick={() => onChange(enemies.filter((_, xi) => xi !== i))}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------- make a monster

const DMG_CHIP: Record<DmgDefense, string> = {
  none: 'sim-chip',
  resist: 'sim-chip resist',
  immune: 'sim-chip immune',
  vuln: 'sim-chip vuln'
}

function MonsterBuilder({
  onSave,
  onCancel,
  initial,
  initialWarnings
}: {
  onSave: (c: Combatant) => void
  onCancel: () => void
  initial?: BuilderDraft
  initialWarnings?: string[]
}): React.JSX.Element {
  const [draft, setDraft] = useState<BuilderDraft>(() => initial ?? emptyDraft())
  const set = (p: Partial<BuilderDraft>): void => setDraft((d) => ({ ...d, ...p }))
  const result = useMemo(() => draftToCombatant(draft), [draft])

  const patchAttack = (i: number, p: Partial<BuilderDraft['attacks'][number]>): void =>
    set({ attacks: draft.attacks.map((x, xi) => (xi === i ? { ...x, ...p } : x)) })
  const cycleDmg = (t: DamageType): void => {
    const order: DmgDefense[] = ['none', 'resist', 'immune', 'vuln']
    set({ damage: { ...draft.damage, [t]: order[(order.indexOf(draft.damage[t]) + 1) % 4] } })
  }
  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
  }

  return (
    <div className="sim-builder">
      <div className="sim-builder-head">
        <span style={{ fontWeight: 500 }}>Make a monster</span>
        <span className="sim-muted" style={{ fontSize: 11 }}>
          attacks + one breath + defenses — the fight-math essentials
        </span>
      </div>

      <div className="sim-builder-grid">
        <label className="lbl">
          <span>Name</span>
          <input style={{ width: 176 }} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Homebrew Horror" />
        </label>
        <label className="lbl">
          <span>CR</span>
          <input style={{ width: 56 }} value={draft.cr} onChange={(e) => set({ cr: e.target.value, pb: suggestedPb(e.target.value) })} />
        </label>
        <label className="lbl">
          <span>Size</span>
          <select value={draft.size} onChange={(e) => set({ size: e.target.value as BuilderDraft['size'] })}>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          <span>AC</span>
          <input type="number" style={{ width: 56 }} value={draft.ac} onChange={(e) => set({ ac: Number(e.target.value) || 0 })} />
        </label>
        <label className="lbl">
          <span>HP (dice or number)</span>
          <input style={{ width: 128 }} value={draft.hp} onChange={(e) => set({ hp: e.target.value })} placeholder="18d12+108" />
        </label>
        <label className="lbl">
          <span>PB</span>
          <input type="number" style={{ width: 48 }} value={draft.pb} onChange={(e) => set({ pb: Number(e.target.value) || 1 })} />
        </label>
      </div>

      <div className="sim-abilities">
        {ABILITIES.map((ab) => (
          <label key={ab} className="sim-ability">
            <span>{ab}</span>
            <input
              type="number"
              value={draft.abilities[ab]}
              onChange={(e) => set({ abilities: { ...draft.abilities, [ab]: Number(e.target.value) || 0 } })}
            />
            <button
              type="button"
              className={`sim-chip${draft.proficientSaves.includes(ab) ? ' on' : ''}`}
              onClick={() => set({ proficientSaves: toggle(draft.proficientSaves, ab) })}
            >
              save
            </button>
          </label>
        ))}
      </div>

      <div className="sim-builder-section">
        <span className="hd">Damage (click: resist / immune / vuln)</span>
        <div className="sim-chip-row">
          {DAMAGE_TYPES.map((t) => (
            <button key={t} type="button" className={DMG_CHIP[draft.damage[t]]} onClick={() => cycleDmg(t)}>
              {t}
              {draft.damage[t] !== 'none' && ` ·${draft.damage[t][0]}`}
            </button>
          ))}
        </div>
      </div>

      <div className="sim-builder-section">
        <span className="hd">Condition immunities</span>
        <div className="sim-chip-row">
          {BUILDER_CONDITIONS.map((c) => (
            <button
              key={c}
              type="button"
              className={`sim-chip${draft.conditionImmunities.includes(c) ? ' immune' : ''}`}
              onClick={() => set({ conditionImmunities: toggle(draft.conditionImmunities, c) })}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="sim-builder-section">
        <span className="hd">Attacks (a Multiattack is generated automatically)</span>
        {draft.attacks.map((a, i) => (
          <div key={i} className="sim-attack-row">
            <input style={{ width: 112 }} value={a.name} onChange={(e) => patchAttack(i, { name: e.target.value })} placeholder="Claw" />
            <span className="sim-muted" style={{ fontSize: 12 }}>
              +
            </span>
            <input type="number" style={{ width: 48 }} value={a.toHit} onChange={(e) => patchAttack(i, { toHit: Number(e.target.value) || 0 })} />
            <input style={{ width: 96 }} value={a.dice} onChange={(e) => patchAttack(i, { dice: e.target.value })} placeholder="2d6+4" />
            <select value={a.type} onChange={(e) => patchAttack(i, { type: e.target.value as DamageType })}>
              {DAMAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Stepper value={a.count} min={1} max={5} onChange={(count) => patchAttack(i, { count })} suffix="×" />
            <button className="sim-x" onClick={() => set({ attacks: draft.attacks.filter((_, xi) => xi !== i) })} aria-label="Remove attack">
              ✕
            </button>
          </div>
        ))}
        {draft.attacks.length < 6 && (
          <button
            className="sim-linkbtn"
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              set({ attacks: [...draft.attacks, { name: '', toHit: draft.pb + 3, dice: '1d8+3', type: 'bludgeoning', count: 1 }] })
            }
          >
            + add attack
          </button>
        )}
      </div>

      {draft.aoe ? (
        <div className="sim-builder-section sim-builder-divide">
          <div className="sim-row" style={{ justifyContent: 'space-between' }}>
            <span className="hd">Breath / area effect</span>
            <button className="sim-x" onClick={() => set({ aoe: null })}>
              remove
            </button>
          </div>
          <div className="sim-attack-row">
            <input style={{ width: 112 }} value={draft.aoe.name} onChange={(e) => set({ aoe: { ...draft.aoe!, name: e.target.value } })} placeholder="Fire Breath" />
            <select value={draft.aoe.shape} onChange={(e) => set({ aoe: { ...draft.aoe!, shape: e.target.value as 'cone' } })}>
              {['cone', 'line', 'sphere', 'emanation'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input type="number" style={{ width: 56 }} value={draft.aoe.size} onChange={(e) => set({ aoe: { ...draft.aoe!, size: Number(e.target.value) || 0 } })} />
            <span className="sim-muted" style={{ fontSize: 12 }}>
              ft ·
            </span>
            <select value={draft.aoe.ability} onChange={(e) => set({ aoe: { ...draft.aoe!, ability: e.target.value as 'dex' } })}>
              {ABILITIES.map((ab) => (
                <option key={ab} value={ab}>
                  {ab}
                </option>
              ))}
            </select>
            <span className="sim-muted" style={{ fontSize: 12 }}>
              DC
            </span>
            <input type="number" style={{ width: 48 }} value={draft.aoe.dc} onChange={(e) => set({ aoe: { ...draft.aoe!, dc: Number(e.target.value) || 0 } })} />
            <input style={{ width: 96 }} value={draft.aoe.dice} onChange={(e) => set({ aoe: { ...draft.aoe!, dice: e.target.value } })} placeholder="12d6" />
            <select value={draft.aoe.type} onChange={(e) => set({ aoe: { ...draft.aoe!, type: e.target.value as DamageType } })}>
              {DAMAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={draft.aoe.recharge} onChange={(e) => set({ aoe: { ...draft.aoe!, recharge: e.target.value as 'none' } })}>
              <option value="none">at will</option>
              <option value="roll:5-6">Recharge 5–6</option>
              <option value="roll:4-6">Recharge 4–6</option>
            </select>
          </div>
        </div>
      ) : (
        <button
          className="sim-linkbtn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            set({
              aoe: {
                name: 'Breath',
                shape: 'cone',
                size: 30,
                ability: 'dex',
                dc: 10 + draft.pb + Math.floor((draft.abilities.con - 10) / 2),
                dice: '10d6',
                type: 'fire',
                recharge: 'roll:5-6'
              }
            })
          }
        >
          + breath / area effect
        </button>
      )}

      <div className="sim-builder-foot" style={{ fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={draft.legendary} onChange={(e) => set({ legendary: e.target.checked })} />
          Legendary actions
        </label>
        {draft.legendary && (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              budget
              <Stepper value={draft.legendaryBudget} min={1} max={5} onChange={(legendaryBudget) => set({ legendaryBudget })} />
            </span>
            {draft.attacks
              .filter((a) => a.name.trim())
              .map((a) => (
                <button
                  key={a.name}
                  type="button"
                  className={`sim-chip${draft.legendaryAttacks.includes(a.name) ? ' on' : ''}`}
                  onClick={() => set({ legendaryAttacks: toggle(draft.legendaryAttacks, a.name) })}
                >
                  {a.name}
                </button>
              ))}
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          targets
          <select
            value={draft.ai.targetPriority}
            onChange={(e) => set({ ai: { ...draft.ai, targetPriority: e.target.value as BuilderDraft['ai']['targetPriority'] } })}
          >
            <option value="highestThreat">highest threat</option>
            <option value="squishiest">squishiest</option>
            <option value="lowestHp">lowest HP</option>
            <option value="nearest">nearest</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={draft.ai.keepDistance} onChange={(e) => set({ ai: { ...draft.ai, keepDistance: e.target.checked } })} />
          ranged / kites
        </label>
      </div>

      {initialWarnings && initialWarnings.length > 0 && (
        <ul className="sim-builder-divide" style={{ fontSize: 12, listStyle: 'none', margin: 0, padding: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {initialWarnings.map((w, i) => (
            <li key={i} className="sim-tone-warning">
              · {w}
            </li>
          ))}
        </ul>
      )}

      <div className="sim-builder-foot">
        {result.error ? (
          <span className="sim-tone-danger" style={{ fontSize: 12 }}>
            {result.error}
          </span>
        ) : result.warnings.length ? (
          <span className="sim-tone-warning" style={{ fontSize: 12 }}>
            saves with warnings: {result.warnings.slice(0, 2).join('; ')}
          </span>
        ) : (
          <span className="sim-tone-positive" style={{ fontSize: 12 }}>
            ✓ valid stat block
          </span>
        )}
        <span className="grow" />
        <button onClick={onCancel}>Cancel</button>
        <button
          className="sim-primary"
          disabled={!result.combatant}
          onClick={() => result.combatant && onSave(result.combatant)}
        >
          Save to custom list
        </button>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------- party

type PartySpec = SimSetup['party'][number]
type LoadoutT = NonNullable<PartySpec['loadout']>

function PartyEditor({
  party,
  onChange
}: {
  party: SimSetup['party']
  onChange: (p: SimSetup['party']) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const setAllLevels = (level: number): void => onChange(party.map((p) => ({ ...p, level })))
  const commonLevel = party.every((p) => p.level === party[0]?.level) ? party[0]?.level ?? 20 : null

  const importFromNotes = async (): Promise<void> => {
    setImporting(true)
    setImportMsg(null)
    try {
      // Empty query -> "every note of type pc" (title LIKE '%%'). No vault open
      // throws in main and lands in the catch below.
      const matches = await window.vaultApi.searchTitles('', 'pc')
      if (!matches.length) {
        setImportMsg('No PC notes found in this vault.')
        return
      }
      const notes = (
        await Promise.all(
          matches.slice(0, 8).map((m) =>
            window.vaultApi
              .readNote(m.path)
              .then((n) => {
                const parsed = parseNote(n.content)
                return { title: m.title, body: parsed.body ?? '', fm: parsed.frontmatter }
              })
              .catch(() => null)
          )
        )
      )
        .filter((n): n is { title: string; body: string; fm: Record<string, unknown> } => !!n && (n.fm as { type?: string })?.type === 'pc')
        .slice(0, 6)

      // resolve the linked class-reference note bodies (frontmatter.classRef is a title)
      const refTitles = new Set(notes.map((n) => String(n.fm.classRef ?? '').trim()).filter(Boolean))
      const refBodies = new Map<string, string>()
      for (const title of refTitles) {
        const hit = (await window.vaultApi.searchTitles(title, 'class-reference')).find(
          (m) => m.title.toLowerCase() === title.toLowerCase()
        )
        if (hit) {
          try {
            refBodies.set(title, parseNote((await window.vaultApi.readNote(hit.path)).content).body ?? '')
          } catch {
            /* skip */
          }
        }
      }

      const specs: SimSetup['party'] = []
      let usedRef = 0
      let fellBack = 0
      for (const n of notes) {
        const classRefBody = refBodies.get(String(n.fm.classRef ?? '').trim())
        const r = pcNoteToCombatant({ title: n.title, frontmatter: n.fm, classRefBody })
        if (!r.spec) continue
        specs.push({
          template: r.spec.combatant.templateId ?? 'gwm-fighter',
          name: r.spec.name,
          level: r.spec.level,
          combatant: r.spec.combatant
        })
        if (classRefBody && r.warnings.some((w) => w.startsWith('class reference:'))) usedRef++
        if (r.warnings.some((w) => /unrecognised class/.test(w))) fellBack++
      }
      if (!specs.length) {
        setImportMsg('PC notes found but none could be built.')
        return
      }
      onChange(specs)
      setImportMsg(
        `Imported ${specs.length} PC${specs.length === 1 ? '' : 's'} from their notes` +
          (usedRef ? `, ${usedRef} read features from a class reference` : '') +
          (fellBack ? `, ${fellBack} fell back to a template` : '') +
          '.'
      )
    } catch {
      setImportMsg('No local vault open — open one to import PCs.')
    } finally {
      setImporting(false)
    }
  }

  const patch = (i: number, m: Partial<PartySpec>): void =>
    onChange(party.map((x, xi) => (xi === i ? { ...x, ...m } : x)))
  const patchLoadout = (i: number, m: Partial<LoadoutT>): void => {
    const next = { ...(party[i].loadout ?? {}), ...m } as LoadoutT
    for (const k of Object.keys(next) as (keyof LoadoutT)[]) if (!next[k]) delete next[k]
    patch(i, { loadout: Object.keys(next).length ? next : undefined })
  }

  return (
    <section className="sim-section">
      <div className="sim-row">
        <h2 className="sim-section-title">Party</h2>
        <button className="sim-linkbtn" onClick={() => onChange(standardParty(commonLevel ?? 20))}>
          reset to standard 4
        </button>
        <button className="sim-linkbtn" onClick={() => void importFromNotes()} disabled={importing}>
          {importing ? 'importing…' : 'import from PC notes'}
        </button>
        {commonLevel !== null && (
          <span className="sim-muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            all levels
            <Stepper value={commonLevel} min={1} max={20} onChange={setAllLevels} />
          </span>
        )}
      </div>
      {importMsg && <p className="sim-sub" style={{ fontSize: 12 }}>{importMsg}</p>}
      <ul className="sim-list">
        {party.map((p, i) => (
          <li key={i} className="sim-card">
            <div className="sim-card-head">
              <input
                className="sim-name-input"
                value={p.name ?? ''}
                placeholder="name"
                onChange={(e) => patch(i, { name: e.target.value })}
              />
              {p.combatant ? (
                <span className="sim-template-select sim-muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sim-normal" style={{ color: 'var(--text-normal)' }}>{p.combatant.templateId ?? 'pc'}</span>
                  <span style={{ opacity: 0.7 }}>· built from note</span>
                  <button className="sim-linkbtn" onClick={() => patch(i, { combatant: undefined })} title="switch to an editable template">
                    detach
                  </button>
                </span>
              ) : (
                <select
                  className="sim-template-select"
                  value={p.template}
                  onChange={(e) => patch(i, { template: e.target.value })}
                >
                  {TEMPLATE_IDS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
              <span className="sim-muted" style={{ fontSize: 12 }}>
                lvl
              </span>
              {p.combatant ? (
                <span style={{ width: 32, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{p.level}</span>
              ) : (
                <Stepper value={p.level} min={1} max={20} onChange={(level) => patch(i, { level })} />
              )}
              <button
                className={`sim-gearbtn${open.has(i) ? ' open' : ''}`}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    return n
                  })
                }
                aria-label="Loadout"
                title="feats & magic items"
              >
                ⚙
                {loadoutSummary(p.loadout) && <span className="chip">{loadoutSummary(p.loadout)}</span>}
              </button>
              <button
                className="sim-x"
                onClick={() => onChange(party.filter((_, xi) => xi !== i))}
                aria-label="Remove"
                disabled={party.length <= 1}
              >
                ✕
              </button>
            </div>
            {open.has(i) && (
              <div className="sim-loadout">
                <LoadoutStepper
                  label="Weapon +"
                  value={p.loadout?.weaponBonus ?? 0}
                  onChange={(weaponBonus) =>
                    patchLoadout(i, { weaponBonus: (weaponBonus || undefined) as 1 | 2 | 3 | undefined })
                  }
                />
                <LoadoutStepper
                  label="AC +"
                  value={p.loadout?.acItem ?? 0}
                  onChange={(acItem) =>
                    patchLoadout(i, { acItem: (acItem || undefined) as 1 | 2 | 3 | undefined })
                  }
                />
                <LoadoutStepper
                  label="Saves +"
                  value={p.loadout?.saveItem ?? 0}
                  onChange={(saveItem) =>
                    patchLoadout(i, { saveItem: (saveItem || undefined) as 1 | 2 | 3 | undefined })
                  }
                />
                <label>
                  <input
                    type="checkbox"
                    checked={!!p.loadout?.resilientCon}
                    onChange={(e) => patchLoadout(i, { resilientCon: e.target.checked || undefined })}
                  />
                  Resilient (Con)
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!p.loadout?.toughHp}
                    onChange={(e) => patchLoadout(i, { toughHp: e.target.checked || undefined })}
                  />
                  Tough (+2 HP/lvl)
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>
      {party.length < 6 && (
        <button
          className="sim-linkbtn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            onChange([
              ...party,
              { template: TEMPLATE_IDS[0], name: `PC ${party.length + 1}`, level: commonLevel ?? 20 }
            ])
          }
        >
          + add PC
        </button>
      )}
    </section>
  )
}

// ------------------------------------------------------------------- results

function Results({
  result,
  showLog,
  onToggleLog
}: {
  result: SimResult
  showLog: boolean
  onToggleLog: () => void
}): React.JSX.Element {
  const { mc, sample, budget } = result
  const win = mc.partyWinRate
  const verdict =
    win >= 0.85
      ? { label: 'Party favoured', tone: 'sim-tone-positive' }
      : win >= 0.5
        ? { label: 'Party favoured but bloodied', tone: 'sim-tone-warning' }
        : win >= 0.15
          ? { label: 'Party in trouble', tone: 'sim-tone-warning' }
          : { label: 'Near-certain wipe', tone: 'sim-tone-danger' }

  return (
    <section className="sim-results">
      <div className="sim-panel">
        <div className="sim-verdict-line">
          <span className={`sim-verdict ${verdict.tone}`}>{verdict.label}</span>
          <span className="sim-sub" style={{ fontSize: 12 }}>
            {mc.trials} trials · {mc.vsParty}
          </span>
        </div>
        <div className="sim-stats">
          <Stat label="Party win" value={pct(mc.partyWinRate)} big />
          <Stat
            label="TPK"
            value={pct(mc.tpkRate)}
            big
            tone={mc.tpkRate > 0.4 ? 'sim-tone-danger' : undefined}
          />
          <Stat label="Rounds" value={`${mc.avgRounds}`} sub={`${mc.roundsP10}–${mc.roundsP90}`} big />
          <Stat
            label="Party HP on win"
            value={`${mc.avgPartyHpPctOnWin}%`}
            sub={`${mc.avgSurvivorsOnWin} up`}
            big
          />
        </div>
        <div className="sim-budget">
          <span>
            Encounter budget: <b>{budget.rating.toUpperCase()}</b> ({budget.deadlyRatio}× the party&apos;s
            Deadly budget · {budget.adjustedXp.toLocaleString()} adj XP)
          </span>
          {mc.firstToFall && (
            <span>
              First to fall: <b>{mc.firstToFall.name}</b>
              {mc.firstDownRoundP50 != null && ` around round ${mc.firstDownRoundP50}`} (
              {pct(mc.firstToFall.rate)} of fights)
            </span>
          )}
        </div>
      </div>

      <div className="sim-two-col">
        <DamageList title="Party output" rows={mc.partyDamage} />
        <DamageList title="Enemy output" rows={mc.monsterDamage} />
      </div>

      <div className="sim-collapse">
        <button onClick={onToggleLog}>
          <span>
            Narrated fight <span className="sim-muted">(seed {result.seed})</span>
          </span>
          <span className="sim-muted">{showLog ? '▾' : '▸'}</span>
        </button>
        {showLog && <pre className="sim-log">{sample.log.join('\n')}</pre>}
      </div>
    </section>
  )
}

function DamageList({
  title,
  rows
}: {
  title: string
  rows: { name: string; avgDealt: number; pctOfSide: number }[]
}): React.JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r.avgDealt))
  return (
    <div className="sim-damage">
      <span className="sim-damage-title">{title}</span>
      {rows.length === 0 ? (
        <span className="sim-sub" style={{ fontSize: 12 }}>
          —
        </span>
      ) : (
        rows.slice(0, 6).map((r) => (
          <div key={r.name} className="sim-damage-row">
            <div className="line">
              <span>{r.name}</span>
              <span className="sim-muted">
                {r.avgDealt} <span style={{ opacity: 0.6 }}>({Math.round(r.pctOfSide * 100)}%)</span>
              </span>
            </div>
            <div className="sim-bar">
              <i style={{ width: `${(r.avgDealt / max) * 100}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// --------------------------------------------------------------- sweep table

function SweepResults({ out }: { out: SweepOut }): React.JSX.Element {
  const label = SWEEP_DIMS.find((d) => d.id === out.dimension)!.label
  return (
    <section className="sim-panel">
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {label} · win rate across {out.rows.length} points
      </span>
      <table className="sim-sweep-table">
        <thead>
          <tr>
            <th>{label}</th>
            <th style={{ width: '50%' }}>Party win</th>
            <th className="num">TPK</th>
            <th className="num">Rounds</th>
            <th className="num">HP on win</th>
          </tr>
        </thead>
        <tbody>
          {out.rows.map((r) => (
            <tr key={r.value} className={r.value === out.baselineValue ? 'now' : ''}>
              <td>
                {r.label}
                {r.value === out.baselineValue && <span className="sim-muted" style={{ fontSize: 11 }}> · now</span>}
              </td>
              <td>
                <div className="sim-sweep-winbar">
                  <div className="sim-bar">
                    <i style={{ width: `${Math.round(r.winRate * 100)}%` }} />
                  </div>
                  <span className="pctval">{Math.round(r.winRate * 100)}%</span>
                </div>
              </td>
              <td className="num">{Math.round(r.tpkRate * 100)}%</td>
              <td className="num">{r.avgRounds}</td>
              <td className="num">{r.hpPctOnWin}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sim-sub" style={{ fontSize: 12 }}>
        Each row is a full Monte-Carlo run — the highlighted row is the setup as it stands.
      </p>
    </section>
  )
}

// -------------------------------------------------------------------- bits

function Stat({
  label,
  value,
  sub,
  big,
  tone
}: {
  label: string
  value: string
  sub?: string
  big?: boolean
  tone?: string
}): React.JSX.Element {
  return (
    <div className="sim-stat">
      <span className="label">{label}</span>
      <span className={`value${big ? ' big' : ''} ${tone ?? ''}`}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
  suffix
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  suffix?: string
}): React.JSX.Element {
  return (
    <span className="sim-stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="decrease">
        −
      </button>
      <span className="val">
        {value}
        {suffix}
      </span>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="increase">
        +
      </button>
    </span>
  )
}

function LoadoutStepper({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <span className="ls">
      <span>{label}</span>
      <Stepper value={value} min={0} max={3} onChange={onChange} />
    </span>
  )
}

const pct = (n: number): string => `${Math.round(n * 100)}%`
