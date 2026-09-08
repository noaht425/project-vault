import { useCallback, useMemo, useState } from 'react'
import { parseNote } from '@common/frontmatter'
import {
  classToTemplate,
  defaultSetup,
  loadoutSummary,
  monsterOptions,
  standardParty,
  SWEEP_DIMS,
  TEMPLATE_IDS,
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
    return parsed
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
  const options = useMemo(() => monsterOptions(), [])

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
  onChange
}: {
  options: MonsterOption[]
  enemies: SimSetup['enemies']
  onChange: (e: SimSetup['enemies']) => void
}): React.JSX.Element {
  const [pick, setPick] = useState('')
  const byId = useMemo(() => Object.fromEntries(options.map((o) => [o.id, o])), [options])

  const add = (): void => {
    if (!pick) return
    onChange([...enemies, { id: pick, count: 1 }])
    setPick('')
  }

  return (
    <section className="sim-section">
      <h2 className="sim-section-title">Enemies</h2>
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
      const notes = await Promise.all(
        matches.slice(0, 8).map((m) =>
          window.vaultApi
            .readNote(m.path)
            .then((n) => ({ title: m.title, fm: parseNote(n.content).frontmatter }))
            .catch(() => null)
        )
      )
      const specs = notes
        .filter((n): n is { title: string; fm: Record<string, unknown> } => !!n && (n.fm as { type?: string })?.type === 'pc')
        .slice(0, 6)
        .map((n) => {
          const fm = n.fm as { class?: string; level?: number | string }
          return {
            template: classToTemplate(fm.class ?? ''),
            name: n.title,
            level: Math.max(1, Math.min(20, Math.round(Number(fm.level) || 1)))
          }
        })
      if (!specs.length) {
        setImportMsg('PC notes found but none had a usable class/level.')
        return
      }
      onChange(specs)
      setImportMsg(
        `Imported ${specs.length} PC${specs.length === 1 ? '' : 's'} — mapped to the nearest template.`
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
              <span className="sim-muted" style={{ fontSize: 12 }}>
                lvl
              </span>
              <Stepper value={p.level} min={1} max={20} onChange={(level) => patch(i, { level })} />
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
