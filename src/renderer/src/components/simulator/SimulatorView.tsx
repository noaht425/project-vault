import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseNote } from '@common/frontmatter'
import {
  ABILITIES,
  BUILDER_CONDITIONS,
  DAMAGE_TYPES,
  defaultSetup,
  draftToCombatant,
  emptyDraft,
  exportCustomMonsters,
  FEAT_OPTIONS,
  ITEM_OPTIONS,
  loadCustomMonsters,
  loadoutSummary,
  monsterOptions,
  npcNoteToMonster,
  parseStatblock,
  pcNoteToCombatant,
  RACE_OPTIONS,
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
import { runSimAsync, runSweepAsync, runBattleAsync, runDayAsync } from './runner'
import { aoePreview, autoPlace, rosterForSetup, starterBattleMap } from '@common/sim/ui'
import type {
  AwaitAction,
  AwaitingInput,
  BattleDecision,
  BattleMapDef,
  BattleRun,
  DayRun,
  RestKind,
  RosterEntry,
  RosterInit,
  UnitSnap
} from '@common/sim/ui'

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

type Mode = 'single' | 'sweep' | 'battle' | 'day'

export function SimulatorView(): React.JSX.Element {
  const [setup, setSetup] = useState<SimSetup>(() => loadSetup())
  const [mode, setMode] = useState<Mode>('single')
  const [result, setResult] = useState<SimResult | null>(null)
  const [sweep, setSweep] = useState<SweepOut | null>(null)
  const [day, setDay] = useState<DayRun | null>(null)
  const [battleStarted, setBattleStarted] = useState(false)
  const [battleNonce, setBattleNonce] = useState(0)
  const [editingMap, setEditingMap] = useState(false)
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
        setDay(null)
      } else if (mode === 'sweep') {
        setSweep(await runSweepAsync(setup, sweepDim))
        setResult(null)
        setDay(null)
      } else if (mode === 'day') {
        setDay(await runDayAsync(setup))
        setResult(null)
        setSweep(null)
      } else {
        // Battle mode is interactive — <BattleMap> owns the run loop; a run just remounts it.
        setBattleStarted(true)
        setBattleNonce((n) => n + 1)
        setResult(null)
        setSweep(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
      setSweep(null)
      setDay(null)
    } finally {
      setRunning(false)
    }
  }, [setup, running, mode, sweepDim])

  const busy =
    running ||
    setup.party.length === 0 ||
    (mode === 'day' ? (setup.day?.encounters.length ?? 0) === 0 : setup.enemies.length === 0)
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

        {mode === 'day' ? (
          <DayEditor options={options} day={setup.day} onChange={(d) => persist({ ...setup, day: d })} />
        ) : (
          <EnemyEditor
            options={options}
            enemies={setup.enemies}
            onChange={(enemies) => persist({ ...setup, enemies })}
            customMonsters={setup.customMonsters}
            onCustomChange={(customMonsters) => persist({ ...setup, customMonsters })}
          />
        )}

        <PartyEditor party={setup.party} onChange={(party) => persist({ ...setup, party })} />

        <section className="sim-section">
          <div className="sim-seg">
            {(['single', 'sweep', 'battle', 'day'] as Mode[]).map((m) => (
              <button
                key={m}
                className={mode === m ? 'active' : ''}
                onClick={() => setMode(m)}
              >
                {m === 'single'
                  ? 'Single fight'
                  : m === 'sweep'
                    ? 'What-if sweep'
                    : m === 'battle'
                      ? 'Battle map'
                      : 'Adventuring day'}
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
            {mode !== 'battle' && (
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
            )}
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
              {running
                ? 'Running…'
                : mode === 'single'
                  ? 'Run simulation'
                  : mode === 'sweep'
                    ? 'Run sweep'
                    : mode === 'battle'
                      ? 'Run battle'
                      : 'Run the day'}
            </button>
          </div>
          {mode === 'sweep' && (
            <p className="sim-sub" style={{ fontSize: 12 }}>
              {dimInfo.values.map((v) => dimInfo.fmt(v)).join(' · ')}
            </p>
          )}
          {mode === 'battle' && (
            <>
              <ControlPicker setup={setup} onChange={(battleControl) => persist({ ...setup, battleControl })} />
              <MapSetup
                setup={setup}
                open={editingMap}
                onToggle={() => setEditingMap((v) => !v)}
                onChange={(battleMap) => persist({ ...setup, battleMap })}
                onReset={() => {
                  persist({ ...setup, battleMap: undefined })
                  setEditingMap(false)
                }}
              />
            </>
          )}
        </section>

        {error && <p className="sim-error">{error}</p>}

        {result && !running && mode === 'single' && (
          <Results result={result} showLog={showLog} onToggleLog={() => setShowLog((v) => !v)} />
        )}
        {sweep && !running && mode === 'sweep' && <SweepResults out={sweep} />}
        {day && !running && mode === 'day' && <DayResults day={day} />}
        {mode === 'day' && !day && !running && (
          <p className="sim-sub" style={{ fontSize: 12 }}>
            Runs your encounter list in sequence with HP, spell slots and 1/day powers carried forward and a short or long
            rest between each. Single-fight win rates over-value going nova — this shows where the party runs dry.
          </p>
        )}
        {mode === 'battle' && battleStarted && (
          <BattleMap key={`${battleNonce}:${(setup.battleControl ?? []).join(',')}`} setup={setup} />
        )}
        {mode === 'battle' && !battleStarted && (
          <p className="sim-sub" style={{ fontSize: 12 }}>
            A single fight on a 5-ft grid — watch the AI, or check a party member above to run their turns yourself.
            Diagonals use the PHB 5-10-5 rule.
          </p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- battle map

const TERRAIN_CLASS: Record<string, string> = {
  '#': 'sim-t-wall',
  '~': 'sim-t-diff',
  '!': 'sim-t-haz',
  o: 'sim-t-cover'
}

const TERRAIN_LEGEND: { g: string; cls: string; label: string }[] = [
  { g: '·', cls: 'sim-t-floor', label: 'floor' },
  { g: '#', cls: 'sim-t-wall', label: 'wall — blocks movement & sight' },
  { g: '~', cls: 'sim-t-diff', label: 'difficult — costs double to enter' },
  { g: 'o', cls: 'sim-t-cover', label: 'cover — blocks movement, grants +AC' },
  { g: '!', cls: 'sim-t-haz', label: 'hazard — damages anything standing in it' }
]

function TerrainLegend(): React.JSX.Element {
  return (
    <div className="sim-legend">
      {TERRAIN_LEGEND.map((t) => (
        <span key={t.g}>
          <span className={`g ${t.cls}`}>{t.g}</span>
          {t.label}
        </span>
      ))}
    </div>
  )
}

function hpBlocks(hp: number, max: number): { fill: string; empty: string } {
  const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0
  let n = Math.round(frac * 10)
  if (hp > 0 && n === 0) n = 1
  return { fill: '█'.repeat(n), empty: '░'.repeat(10 - n) }
}
const SPARK = '▁▂▃▄▅▆▇█'
function sparkline(values: number[], max: number): string {
  if (!values.length) return ''
  return values.map((v) => SPARK[Math.max(0, Math.min(7, Math.round((v / max) * 7)))]).join('')
}

function RosterRow({ u, actor }: { u: UnitSnap; actor: boolean }): React.JSX.Element {
  const b = hpBlocks(u.hp, u.maxHp)
  return (
    <div className={`sim-rrow${!u.alive ? ' dead' : u.downed ? ' down' : ''}${actor ? ' actor' : ''}`}>
      <span className="mk">{actor ? '▸' : ''}</span>
      <span className={`glyph ${u.side}`}>{u.glyph}</span>
      <span className="nm">{u.name}</span>
      <span className="bar">
        <span className={u.side}>{b.fill}</span>
        <span className="e">{b.empty}</span>
      </span>
      <span className="hp">{u.downed ? 'DOWN' : `${u.hp}/${u.maxHp}`}</span>
      {u.conditions.length > 0 && <span className="cond">[{u.conditions.join(',')}]</span>}
    </div>
  )
}

function ControlPicker({
  setup,
  onChange
}: {
  setup: SimSetup
  onChange: (ids: string[]) => void
}): React.JSX.Element {
  const party = useMemo(() => {
    try {
      return rosterForSetup(setup).filter((r) => r.side === 'party')
    } catch {
      return [] as RosterEntry[]
    }
  }, [setup])
  const control = new Set(setup.battleControl ?? [])
  const toggle = (id: string): void => {
    const next = new Set(control)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }
  return (
    <div className="sim-row" style={{ fontSize: 12, gap: 12, flexWrap: 'wrap' }}>
      <span className="sim-muted">Control</span>
      {party.map((r) => (
        <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={control.has(r.id)} onChange={() => toggle(r.id)} />
          <span style={{ color: control.has(r.id) ? 'var(--accent)' : undefined }}>{r.name}</span>
        </label>
      ))}
      {party.length > 0 && (
        <>
          <button className="sim-linkbtn" onClick={() => onChange(party.map((r) => r.id))}>all</button>
          <button className="sim-linkbtn" onClick={() => onChange([])}>none</button>
        </>
      )}
      {control.size > 0 && (
        <span className="sim-muted" style={{ opacity: 0.7 }}>
          — you&apos;ll run these turns; the rest play themselves
        </span>
      )}
    </div>
  )
}

interface Wizard {
  move: { x: number; y: number } | null
  action: string | null
  target: string | null
  origin: { x: number; y: number } | null
  bonusAction: string | null
  bonusTarget: string | null
}
const EMPTY_WIZ: Wizard = { move: null, action: null, target: null, origin: null, bonusAction: null, bonusTarget: null }

function BattleMap({ setup }: { setup: SimSetup }): React.JSX.Element {
  const [decisions, setDecisions] = useState<BattleDecision[]>([])
  const [run, setRun] = useState<BattleRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoAi, setAutoAi] = useState(false)
  const [wiz, setWiz] = useState<Wizard>(EMPTY_WIZ)
  const started = useRef(false)

  const fetchRun = useCallback(
    (ds: BattleDecision[], ai: boolean) => {
      setLoading(true)
      setWiz(EMPTY_WIZ)
      const s = ai ? { ...setup, battleControl: [] as string[] } : setup
      void runBattleAsync(s, setup.seed, ds).then((r) => {
        setRun(r)
        setLoading(false)
      })
    },
    [setup]
  )

  useEffect(() => {
    if (started.current) return
    started.current = true
    fetchRun([], false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const push = (ds: BattleDecision[]): void => {
    setDecisions(ds)
    fetchRun(ds, autoAi)
  }
  const commit = (d: BattleDecision): void => push([...decisions, d])
  const undoTurn = (): void => push(decisions.slice(0, -1))
  const finishWithAi = (): void => {
    setAutoAi(true)
    setDecisions(decisions)
    fetchRun(decisions, true)
  }

  if (!run) return <p className="sim-sub" style={{ fontSize: 12 }}>Setting up the battle…</p>

  const aw = run.awaiting
  return (
    <Replay
      key={run.frames.length + (aw ? ':await' : ':done')}
      run={run}
      awaiting={aw}
      loading={loading}
      wiz={wiz}
      setWiz={setWiz}
      canUndo={decisions.length > 0}
      onCommit={commit}
      onAi={() => aw && commit({ round: aw.round, unitId: aw.unitId, auto: true })}
      onUndo={undoTurn}
      onFinishAi={finishWithAi}
      onReplay={() => push([])}
    />
  )
}

function Replay({
  run,
  awaiting,
  loading,
  wiz,
  setWiz,
  canUndo,
  onCommit,
  onAi,
  onUndo,
  onFinishAi,
  onReplay
}: {
  run: BattleRun
  awaiting?: AwaitingInput
  loading: boolean
  wiz: Wizard
  setWiz: (w: Wizard) => void
  canUndo: boolean
  onCommit: (d: BattleDecision) => void
  onAi: () => void
  onUndo: () => void
  onFinishAi: () => void
  onReplay: () => void
}): React.JSX.Element {
  const frames = run.frames
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(450)
  const [hoverOrigin, setHoverOrigin] = useState<{ x: number; y: number } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const last = frames.length - 1
  const atEnd = idx >= last
  const shownIdx = awaiting ? last : Math.min(idx, last)

  useEffect(() => {
    if (!playing || atEnd) return
    const t = setTimeout(() => setIdx((i) => i + 1), speed)
    return () => clearTimeout(t)
  }, [playing, idx, speed, atEnd])

  const frame = frames[shownIdx]
  const dims = frames[0].terrain!
  const terrain = dims.tiles

  const unitAt = useMemo(() => {
    const m = new Map<string, UnitSnap>()
    for (const u of frame.units) {
      if (!u.alive) continue
      for (let dy = 0; dy < u.fp; dy++) for (let dx = 0; dx < u.fp; dx++) m.set(`${u.x + dx},${u.y + dy}`, u)
    }
    return m
  }, [frame])
  const templateSet = useMemo(() => new Set(frame.templateCells ?? []), [frame])
  const pathSet = useMemo(
    () => new Set((frame.path ?? []).slice(0, -1).map(([x, y]) => `${x},${y}`)),
    [frame]
  )
  const logLines = useMemo(
    () =>
      frames
        .slice(0, shownIdx + 1)
        .filter((f) => f.text)
        .map((f) => ({ seq: f.seq, round: f.round, text: f.text! })),
    [frames, shownIdx]
  )
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logLines.length])

  const roster = frame.units // flat list for the turn panel's name lookups
  const byId = useMemo(() => new Map(frame.units.map((u) => [u.id, u])), [frame])
  const initOrder: RosterInit[] = run.initiative.length
    ? run.initiative
    : frame.units.map((u) => ({ id: u.id, name: u.name, glyph: u.glyph, side: u.side }))
  const rosterParty = initOrder
    .filter((i) => i.side === 'party')
    .map((i) => byId.get(i.id))
    .filter((u): u is UnitSnap => !!u)
  const rosterMon = initOrder
    .filter((i) => i.side === 'monster')
    .map((i) => byId.get(i.id))
    .filter((u): u is UnitSnap => !!u)

  const hpCurve = useMemo(() => {
    const rounds = new Map<number, { p: number; m: number }>()
    for (const f of frames) {
      let p = 0
      let m = 0
      for (const u of f.units) {
        if (u.side === 'party') p += Math.max(0, u.hp)
        else m += Math.max(0, u.hp)
      }
      rounds.set(f.round, { p, m })
    }
    const rows = [...rounds.entries()].sort((a, b) => a[0] - b[0])
    return { rows, pMax: Math.max(1, ...rows.map((r) => r[1].p)), mMax: Math.max(1, ...rows.map((r) => r[1].m)) }
  }, [frames])

  useEffect(() => {
    if (awaiting) return
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => {
          if (atEnd) {
            setIdx(0)
            return true
          }
          return !p
        })
      } else if (e.key === 'ArrowRight') {
        setPlaying(false)
        setIdx((i) => Math.min(last, i + 1))
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false)
        setIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Home') {
        setPlaying(false)
        setIdx(0)
      } else if (e.key === 'End') {
        setPlaying(false)
        setIdx(last)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [awaiting, atEnd, last])

  const reachSet = useMemo(() => new Set(awaiting?.reachable ?? []), [awaiting])
  const selAction: AwaitAction | undefined = awaiting?.actions.find((a) => a.id === wiz.action)
  const aimOrigin = wiz.origin ?? hoverOrigin
  const aoePrev = useMemo(() => {
    if (!awaiting || !selAction?.aoe || !aimOrigin) return new Set<string>()
    const from = wiz.move ?? awaiting.pos
    return new Set(aoePreview(selAction.aoe.shape, from, aimOrigin, selAction.aoe.sizeFt, dims))
  }, [awaiting, selAction, aimOrigin, wiz.move, dims])

  const targetsEnemy = !!selAction && !selAction.friendly && !selAction.aoe
  const needsOrigin = !!selAction?.aoe
  const roughFt = (mx: number, my: number, b: { x0: number; y0: number; x1: number; y1: number }): number => {
    const gx = Math.max(0, mx - b.x1, b.x0 - mx)
    const gy = Math.max(0, my - b.y1, b.y0 - my)
    const diag = Math.min(gx, gy)
    return (Math.max(gx, gy) + diag) * 5 + Math.floor(diag / 2) * 5
  }
  const meleeGap =
    awaiting && selAction?.needsMelee && wiz.target
      ? (() => {
          const from = wiz.move ?? awaiting.pos
          const tb = awaiting.units.find((u) => u.id === wiz.target)?.box
          return tb ? roughFt(from.x, from.y, tb) : 0
        })()
      : 0
  const outOfReach = !!awaiting && !!wiz.target && !!selAction?.needsMelee && meleeGap > awaiting.reachFt + 0.001
  const bonusSel: AwaitAction | undefined = awaiting?.bonusActions.find((a) => a.id === wiz.bonusAction)
  const bonusNeedsTarget = !!bonusSel && !bonusSel.friendly && !bonusSel.aoe
  const step: 'move' | 'target' | 'origin' | 'bonusTarget' = !awaiting
    ? 'move'
    : targetsEnemy && !wiz.target
      ? 'target'
      : needsOrigin && !wiz.origin
        ? 'origin'
        : bonusNeedsTarget && !wiz.bonusTarget
          ? 'bonusTarget'
          : 'move'

  const clickCell = (x: number, y: number, u?: UnitSnap): void => {
    if (!awaiting) return
    if (step === 'target') {
      if (u && u.side === 'monster' && u.alive) setWiz({ ...wiz, target: u.id })
      return
    }
    if (step === 'bonusTarget') {
      if (u && u.side === 'monster' && u.alive) setWiz({ ...wiz, bonusTarget: u.id })
      return
    }
    if (step === 'origin') {
      setWiz({ ...wiz, origin: { x, y } })
      return
    }
    if (reachSet.has(`${x},${y}`)) setWiz({ ...wiz, move: { x, y } })
  }
  const confirm = (): void => {
    if (!awaiting) return
    onCommit({
      round: awaiting.round,
      unitId: awaiting.unitId,
      move: wiz.move ?? undefined,
      actionId: wiz.action ?? undefined,
      targetId: wiz.target ?? undefined,
      aoeOrigin: wiz.origin ?? undefined,
      bonusActionId: wiz.bonusAction ?? undefined,
      bonusTargetId: wiz.bonusTarget ?? undefined
    })
  }

  return (
    <section className="sim-section sim-replay">
      {awaiting ? (
        <div className="sim-turnpanel">
          <div className="sim-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Your turn — {awaiting.unitName}</span>
            <span className="sim-muted" style={{ fontSize: 12 }}>
              round {awaiting.round} · speed {awaiting.speedFt} ft
            </span>
            {loading && <span className="sim-muted" style={{ fontSize: 12 }}>resolving…</span>}
          </div>
          <p className="sim-muted" style={{ fontSize: 12 }}>
            {step === 'move' && 'Click a highlighted square to move (or leave it to stay), then pick an action.'}
            {step === 'target' && 'Click an enemy to target.'}
            {step === 'bonusTarget' && 'Click an enemy for the bonus action.'}
            {step === 'origin' && 'Click a square to aim the area effect.'}
          </p>
          <div className="sim-row" style={{ gap: 6, fontSize: 12, flexWrap: 'wrap' }}>
            <span className="sim-muted">Move:</span>
            <span>{wiz.move ? `(${wiz.move.x}, ${wiz.move.y})` : 'stay'}</span>
            {wiz.move && (
              <button className="sim-linkbtn" onClick={() => setWiz({ ...wiz, move: null })}>reset</button>
            )}
          </div>
          <div
            className="sim-row"
            style={{ gap: 6, fontSize: 12, flexWrap: 'wrap', maxHeight: 112, overflowY: 'auto', alignItems: 'flex-start' }}
          >
            <span className="sim-muted">Action:</span>
            {awaiting.actions.length === 0 && <span className="sim-muted">— none —</span>}
            {awaiting.actions.map((a) => (
              <button
                key={a.id}
                className={`sim-actbtn${wiz.action === a.id ? ' on' : ''}`}
                title={a.needsMelee ? 'melee' : a.friendly ? 'self / ally' : a.aoe ? `${a.aoe.shape} ${a.aoe.sizeFt} ft` : 'ranged'}
                onClick={() =>
                  setWiz({ ...wiz, action: wiz.action === a.id ? null : a.id, target: null, origin: null })
                }
              >
                {a.name}
              </button>
            ))}
            {wiz.action && (
              <button
                className="sim-linkbtn"
                onClick={() => setWiz({ ...wiz, action: null, target: null, origin: null })}
              >
                skip action
              </button>
            )}
          </div>
          {targetsEnemy && (
            <div className="sim-muted" style={{ fontSize: 12 }}>
              Target: {wiz.target ? roster.find((u) => u.id === wiz.target)?.name ?? wiz.target : '—'}
              {outOfReach && (
                <span style={{ color: 'var(--warning)', marginLeft: 8 }}>
                  ⚠ ~{meleeGap} ft away — move closer or the strike whiffs
                </span>
              )}
            </div>
          )}
          {needsOrigin && (
            <div className="sim-muted" style={{ fontSize: 12 }}>
              Aim point: {wiz.origin ? `(${wiz.origin.x}, ${wiz.origin.y})` : 'hover the map'}
            </div>
          )}
          {awaiting.bonusActions.length > 0 && (
            <div
              className="sim-row"
              style={{ gap: 6, fontSize: 12, flexWrap: 'wrap', maxHeight: 80, overflowY: 'auto', alignItems: 'flex-start' }}
            >
              <span className="sim-muted">Bonus:</span>
              {awaiting.bonusActions.map((a) => (
                <button
                  key={a.id}
                  className={`sim-actbtn${wiz.bonusAction === a.id ? ' on' : ''}`}
                  title={a.needsMelee ? 'melee' : a.friendly ? 'self / ally' : 'ranged'}
                  onClick={() =>
                    setWiz({ ...wiz, bonusAction: wiz.bonusAction === a.id ? null : a.id, bonusTarget: null })
                  }
                >
                  {a.name}
                </button>
              ))}
              {wiz.bonusAction && (
                <button className="sim-linkbtn" onClick={() => setWiz({ ...wiz, bonusAction: null, bonusTarget: null })}>
                  none
                </button>
              )}
              {bonusNeedsTarget && (
                <span style={{ fontSize: 12 }}>
                  → {wiz.bonusTarget ? roster.find((u) => u.id === wiz.bonusTarget)?.name ?? '' : 'pick an enemy'}
                </span>
              )}
            </div>
          )}
          <div className="sim-row" style={{ gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
            <button
              className="sim-primary"
              onClick={confirm}
              disabled={
                loading ||
                (targetsEnemy && !wiz.target) ||
                (needsOrigin && !wiz.origin) ||
                (bonusNeedsTarget && !wiz.bonusTarget)
              }
            >
              Confirm turn
            </button>
            <button className="sim-linkbtn" onClick={onAi} disabled={loading}>let the AI take this turn</button>
            {canUndo && (
              <button className="sim-linkbtn" onClick={onUndo} disabled={loading}>undo last turn</button>
            )}
            <button className="sim-linkbtn" onClick={onFinishAi} disabled={loading}>finish with AI</button>
          </div>
        </div>
      ) : (
        <>
          <div className="sim-replay-transport">
            <div className="sim-seg">
              <button onClick={() => { setPlaying(false); setIdx(0) }}>⏮</button>
              <button onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)) }}>◀</button>
              <button
                onClick={() => {
                  if (atEnd) { setIdx(0); setPlaying(true) } else setPlaying((p) => !p)
                }}
              >
                {playing && !atEnd ? '⏸' : '▶'}
              </button>
              <button onClick={() => { setPlaying(false); setIdx((i) => Math.min(last, i + 1)) }}>▶▶</button>
              <button onClick={() => { setPlaying(false); setIdx(last) }}>⏭</button>
            </div>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={900}>0.5×</option>
              <option value={450}>1×</option>
              <option value={220}>2×</option>
              <option value={110}>4×</option>
            </select>
            <input
              type="range"
              min={0}
              max={last}
              value={shownIdx}
              onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }}
              style={{ flex: 1, minWidth: 160 }}
            />
            <span className="sim-sub" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              R{frame.round} · {shownIdx + 1}/{frames.length}
            </span>
            <button className="sim-linkbtn" onClick={onReplay}>replay</button>
            <span className="sim-sub" style={{ fontSize: 11, opacity: 0.6 }}>space · ← → · home/end</span>
          </div>
        </>
      )}

      <div className="sim-replay-head">
        <span className="rnd">ROUND {frame.round}</span>
        <span className="init">init: {initOrder.map((i) => i.name).join(' › ')}</span>
      </div>
      <p className="sim-replay-event">
        <span className="r">R{frame.round}:</span>{' '}
        {frame.text ?? (frame.kind === 'start' ? 'the battle begins' : frame.kind === 'end' ? '' : '…')}
      </p>

      <div className="sim-replay-body">
        <div className="sim-replay-board-wrap">
          <div
            className="sim-replay-board sim-framed"
            style={{
              gridTemplateColumns: `2.5ch 1ch repeat(${dims.width}, 1ch) 1ch`,
              cursor: awaiting ? 'pointer' : undefined
            }}
          >
            {Array.from({ length: dims.height + 2 }, (_, ry) => {
              const y = ry - 1
              if (y < 0 || y >= dims.height) {
                return (
                  <div key={ry} style={{ display: 'contents' }}>
                    <span />
                    <span className="brd">{y < 0 ? '┌' : '└'}</span>
                    <span className="brd" style={{ gridColumn: `span ${dims.width}` }}>{'─'.repeat(dims.width)}</span>
                    <span className="brd">{y < 0 ? '┐' : '┘'}</span>
                  </div>
                )
              }
              return (
                <div key={ry} style={{ display: 'contents' }}>
                  <span className="gut">{y + 1}</span>
                  <span className="brd">│</span>
                  {Array.from({ length: dims.width }, (_, x) => {
                    const key = `${x},${y}`
                    const u = unitAt.get(key)
                    const t = terrain[y * dims.width + x] ?? '.'
                    let ch = t === '.' ? '·' : t
                    let cls = TERRAIN_CLASS[t] ?? 'sim-t-floor'
                    if (u) {
                      ch = u.glyph
                      cls = u.side === 'party' ? 'sim-u-party' : 'sim-u-monster'
                      if (u.downed) cls = 'sim-u-down'
                    } else if (pathSet.has(key)) {
                      ch = '•'
                      cls = 'sim-u-path'
                    }
                    let extra = ''
                    if (awaiting) {
                      if (wiz.move && wiz.move.x === x && wiz.move.y === y) extra = ' sim-c-move'
                      else if (aimOrigin && aimOrigin.x === x && aimOrigin.y === y) extra = ' sim-c-origin'
                      else if (aoePrev.has(key)) extra = ' sim-c-aoe'
                      else if (step === 'move' && reachSet.has(key) && !u) extra = ' sim-c-reach'
                      else if ((step === 'target' || step === 'bonusTarget') && u?.side === 'monster') extra = ' sim-c-tgt'
                      else if ((wiz.target === u?.id || wiz.bonusTarget === u?.id) && u) extra = ' sim-c-tgt'
                    }
                    if (!extra && u?.isActor) extra = ' sim-c-actor'
                    else if (!extra && templateSet.has(key)) extra = ' sim-c-aoe'
                    const distTip =
                      awaiting && step === 'move' && !u
                        ? `${roughFt(awaiting.pos.x, awaiting.pos.y, { x0: x, y0: y, x1: x, y1: y })} ft`
                        : undefined
                    return (
                      <span
                        key={x}
                        className={cls + extra}
                        onClick={awaiting ? () => clickCell(x, y, u) : undefined}
                        onMouseEnter={awaiting && step === 'origin' ? () => setHoverOrigin({ x, y }) : undefined}
                        onMouseLeave={awaiting && step === 'origin' ? () => setHoverOrigin(null) : undefined}
                        title={
                          u
                            ? `${u.name} — ${u.hp}/${u.maxHp}${u.conditions.length ? ' [' + u.conditions.join(',') + ']' : ''}`
                            : distTip
                        }
                      >
                        {ch}
                      </span>
                    )
                  })}
                  <span className="brd">│</span>
                </div>
              )
            })}
          </div>
          <TerrainLegend />
        </div>

        <div className="sim-replay-side">
          <div className="sim-replay-roster2">
            {rosterParty.map((u) => (
              <RosterRow key={u.id} u={u} actor={u.isActor || u.id === awaiting?.unitId} />
            ))}
            {rosterMon.length > 0 && <div className="sim-rdiv">──────────────</div>}
            {rosterMon.map((u) => (
              <RosterRow key={u.id} u={u} actor={u.isActor || u.id === awaiting?.unitId} />
            ))}
          </div>

          {hpCurve.rows.length > 1 && (
            <div className="sim-spark">
              <div>
                <span style={{ color: 'var(--accent)' }}>party </span>
                {sparkline(hpCurve.rows.map((r) => r[1].p), hpCurve.pMax)}
              </div>
              <div>
                <span style={{ color: 'var(--danger)' }}>foes&nbsp;&nbsp;</span>
                {sparkline(hpCurve.rows.map((r) => r[1].m), hpCurve.mMax)}
              </div>
              <div style={{ opacity: 0.5 }}>rounds 1–{hpCurve.rows[hpCurve.rows.length - 1][0]}</div>
            </div>
          )}

          <div ref={logRef} className="sim-replay-log">
            {logLines.map((l) => (
              <div key={l.seq}>
                <span className="r">R{l.round}</span> {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
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
      let usedExtras = 0
      for (const n of notes) {
        const classRefBody = refBodies.get(String(n.fm.classRef ?? '').trim())
        const r = pcNoteToCombatant({ title: n.title, frontmatter: n.fm, body: n.body, classRefBody })
        if (!r.spec) continue
        specs.push({
          template: r.spec.combatant.templateId ?? 'gwm-fighter',
          name: r.spec.name,
          level: r.spec.level,
          combatant: r.spec.combatant
        })
        if (classRefBody && r.warnings.some((w) => w.startsWith('class reference:'))) usedRef++
        if (r.warnings.some((w) => /unrecognised class/.test(w))) fellBack++
        if (r.warnings.some((w) => /^(race|feat|item):/.test(w))) usedExtras++
      }
      if (!specs.length) {
        setImportMsg('PC notes found but none could be built.')
        return
      }
      onChange(specs)
      setImportMsg(
        `Imported ${specs.length} PC${specs.length === 1 ? '' : 's'} from their notes` +
          (usedRef ? `, ${usedRef} read features from a class reference` : '') +
          (usedExtras ? `, ${usedExtras} picked up a race / feat / item` : '') +
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
  const togglePick = (i: number, key: 'feats' | 'items', val: string): void => {
    const cur = party[i][key] ?? []
    const next = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val]
    patch(i, { [key]: next.length ? next : undefined })
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
                title="race, feats & magic items"
              >
                ⚙
                {(() => {
                  const picks = (p.feats?.length ?? 0) + (p.items?.length ?? 0)
                  const bits = [
                    loadoutSummary(p.loadout),
                    p.race,
                    picks > 0 ? `${picks} pick${picks === 1 ? '' : 's'}` : ''
                  ].filter(Boolean)
                  return bits.length ? <span className="chip">{bits.join(' · ')}</span> : null
                })()}
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
                <div className="sim-picks">
                  <label>
                    <span className="sim-muted">Race</span>
                    <select value={p.race ?? ''} onChange={(e) => patch(i, { race: e.target.value || undefined })}>
                      <option value="">—</option>
                      {RACE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <PickList
                    label="Feats"
                    options={FEAT_OPTIONS}
                    chosen={p.feats ?? []}
                    onToggle={(v) => togglePick(i, 'feats', v)}
                  />
                  <PickList
                    label="Items"
                    options={ITEM_OPTIONS}
                    chosen={p.items ?? []}
                    onToggle={(v) => togglePick(i, 'items', v)}
                  />
                </div>
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

// -------------------------------------------------------------- adventuring day

const REST_LABEL: Record<RestKind, string> = { none: 'no rest', short: 'short rest', long: 'long rest' }

function DayEditor({
  options,
  day,
  onChange
}: {
  options: MonsterOption[]
  day: SimSetup['day']
  onChange: (d: SimSetup['day']) => void
}): React.JSX.Element {
  const encounters = day?.encounters ?? []
  const rests = day?.rests ?? []
  const addEncounter = (): void =>
    onChange({ encounters: [...encounters, []], rests: [...rests, encounters.length ? 'short' : 'none'] })
  const removeEncounter = (i: number): void =>
    onChange({ encounters: encounters.filter((_, x) => x !== i), rests: rests.filter((_, x) => x !== i) })
  const addMonster = (i: number, id: string): void => {
    if (!id) return
    const next = encounters.map((enc, x) => {
      if (x !== i) return enc
      const ex = enc.find((e) => e.id === id)
      return ex ? enc.map((e) => (e.id === id ? { ...e, count: e.count + 1 } : e)) : [...enc, { id, count: 1 }]
    })
    onChange({ encounters: next, rests })
  }
  const bump = (i: number, id: string, d: number): void => {
    const next = encounters.map((enc, x) =>
      x !== i ? enc : enc.flatMap((e) => (e.id !== id ? [e] : e.count + d <= 0 ? [] : [{ ...e, count: e.count + d }]))
    )
    onChange({ encounters: next, rests })
  }
  const setRest = (i: number, r: RestKind): void =>
    onChange({ encounters, rests: rests.map((x, k) => (k === i ? r : x)) })

  return (
    <section className="sim-section">
      <div className="sim-row">
        <h2 className="sim-section-title">The day</h2>
        <button className="sim-linkbtn" onClick={addEncounter}>+ encounter</button>
      </div>
      {encounters.length === 0 && (
        <p className="sim-sub" style={{ fontSize: 12 }}>Add a few encounters to run in sequence.</p>
      )}
      <ol className="sim-day-list">
        {encounters.map((enc, i) => (
          <li key={i} className="sim-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="sim-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="sim-sub" style={{ fontSize: 12, width: 52 }}>Fight {i + 1}</span>
              <select
                value=""
                style={{ minWidth: 160, fontSize: 12 }}
                onChange={(e) => addMonster(i, e.target.value)}
              >
                <option value="">add a monster…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — CR {o.cr}
                  </option>
                ))}
              </select>
              <button className="sim-linkbtn danger" style={{ marginLeft: 'auto' }} onClick={() => removeEncounter(i)}>
                remove
              </button>
            </div>
            <div className="sim-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {enc.length === 0 && <span className="sim-sub" style={{ fontSize: 12 }}>empty</span>}
              {enc.map((e) => (
                <span key={e.id} className="sim-chip on" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  {options.find((o) => o.id === e.id)?.name ?? e.id}
                  <button onClick={() => bump(i, e.id, -1)}>−</button>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{e.count}</span>
                  <button onClick={() => bump(i, e.id, 1)}>+</button>
                </span>
              ))}
            </div>
            {i < encounters.length - 1 && (
              <div className="sim-row" style={{ gap: 6, fontSize: 12 }} title="rest before the next fight">
                <span className="sim-sub">then</span>
                <select value={rests[i] ?? 'short'} onChange={(e) => setRest(i, e.target.value as RestKind)}>
                  {(['none', 'short', 'long'] as RestKind[]).map((r) => (
                    <option key={r} value={r}>
                      {REST_LABEL[r]}
                    </option>
                  ))}
                </select>
                <span className="sim-sub">before the next fight</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function DayResults({ day }: { day: DayRun }): React.JSX.Element {
  const { mc } = day
  const win = mc.dayWinRate
  const tone = win >= 0.75 ? 'sim-tone-positive' : win >= 0.4 ? 'sim-tone-warning' : 'sim-tone-danger'
  return (
    <>
      <section className="sim-panel">
        <div className="sim-verdict-line">
          <span className={`sim-verdict ${tone}`}>Party survives the full day {pct(win)} of the time</span>
          <span className="sim-sub" style={{ fontSize: 12 }}>{mc.trials} days</span>
        </div>
        <div className="sim-stats">
          <Stat label="Encounters cleared" value={mc.encountersClearedAvg.toFixed(1)} sub={`of ${mc.perEncounter.length}`} big />
          <Stat label="Resources left" value={pct(mc.resourcesLeftPctAvg)} sub="slots & 1/day" big />
          <Stat
            label="The wall"
            value={mc.wallEncounter ? `Fight ${mc.wallEncounter}` : '—'}
            sub={mc.wallEncounter ? 'first to slip' : 'clears the day'}
            big
            tone={mc.wallEncounter ? 'sim-tone-warning' : undefined}
          />
          <Stat label="Day win" value={pct(win)} big tone={win < 0.4 ? 'sim-tone-danger' : undefined} />
        </div>
      </section>
      <section className="sim-panel">
        <table className="sim-sweep-table">
          <thead>
            <tr>
              <th>Fight</th>
              <th className="num">Win</th>
              <th className="num">HP after</th>
              <th className="num">Rounds</th>
              <th className="num">Reached</th>
            </tr>
          </thead>
          <tbody>
            {mc.perEncounter.map((e, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="num">{pct(e.winRate)}</td>
                <td className="num">{pct(e.hpPctAfterAvg)}</td>
                <td className="num">{e.roundsAvg.toFixed(1)}</td>
                <td className="num" style={{ color: 'var(--text-muted)' }}>{pct(e.foughtRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

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

// -------------------------------------------------------------- map editor

const FP: Record<string, number> = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }
const MAP_TOOLS = [
  { kind: 'floor', glyph: '·', label: 'Floor / erase' },
  { kind: 'wall', glyph: '#', label: 'Wall' },
  { kind: 'difficult', glyph: '~', label: 'Difficult' },
  { kind: 'cover', glyph: 'o', label: 'Cover' },
  { kind: 'hazard', glyph: '!', label: 'Hazard' }
]
const GLYPH: Record<string, string> = { floor: '.', wall: '#', difficult: '~', cover: 'o', hazard: '!' }

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MAP_PRESETS: Record<string, (w: number, h: number) => string> = {
  'Open field': (w, h) => '.'.repeat(w * h),
  Pillars: (w, h) => {
    const t = Array<string>(w * h).fill('.')
    const rng = mulberry(w * 131 + h * 17 + 7)
    const n = Math.round(4 + rng() * 4)
    for (let k = 0; k < n; k++) {
      const px = 2 + Math.floor(rng() * (w - 5))
      const py = 3 + Math.floor(rng() * (h - 7))
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (px + dx < w && py + dy < h) t[(py + dy) * w + px + dx] = '#'
    }
    return t.join('')
  },
  Chokepoint: (w, h) => {
    const t = Array<string>(w * h).fill('.')
    const mid = h >> 1
    for (let x = 0; x < w; x++) t[mid * w + x] = '#'
    const gap = (w >> 1) - 1
    for (let g = 0; g < 3; g++) t[mid * w + gap + g] = '.'
    return t.join('')
  },
  Corridor: (w, h) => {
    const t = Array<string>(w * h).fill('.')
    for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) t[y * w + x] = '#'
    return t.join('')
  },
  'Scattered cover': (w, h) => {
    const t = Array<string>(w * h).fill('.')
    const rng = mulberry(w * 51 + h * 91 + 3)
    for (let k = 0; k < Math.round(w * 0.9); k++) {
      const x = Math.floor(rng() * w)
      const y = 2 + Math.floor(rng() * (h - 4))
      t[y * w + x] = rng() < 0.7 ? 'o' : '~'
    }
    return t.join('')
  },
  'Lava vein': (w, h) => {
    const t = Array<string>(w * h).fill('.')
    const rng = mulberry(w * 7 + h * 43 + 11)
    let y = h >> 1
    for (let x = 0; x < w; x++) {
      t[y * w + x] = '!'
      if (rng() < 0.45) y += rng() < 0.5 ? 1 : -1
      y = Math.max(1, Math.min(h - 2, y))
    }
    return t.join('')
  }
}

function tileAt(def: BattleMapDef, x: number, y: number): string {
  return def.tiles[y * def.width + x] ?? '.'
}

function tokenFits(def: BattleMapDef, roster: RosterEntry[], id: string, x: number, y: number): boolean {
  const fp = FP[roster.find((r) => r.id === id)?.size ?? 'medium'] ?? 1
  const otherCells = new Set<string>()
  for (const [oid, p] of Object.entries(def.placements)) {
    if (oid === id) continue
    const ofp = FP[roster.find((r) => r.id === oid)?.size ?? 'medium'] ?? 1
    for (let dy = 0; dy < ofp; dy++) for (let dx = 0; dx < ofp; dx++) otherCells.add(`${p.x + dx},${p.y + dy}`)
  }
  for (let dy = 0; dy < fp; dy++) {
    for (let dx = 0; dx < fp; dx++) {
      const cx = x + dx
      const cy = y + dy
      if (cx < 0 || cy < 0 || cx >= def.width || cy >= def.height) return false
      const t = tileAt(def, cx, cy)
      if (t === '#' || t === 'o') return false
      if (otherCells.has(`${cx},${cy}`)) return false
    }
  }
  return true
}

const MAPS_KEY = 'fightSimMaps'
function readMaps(): Record<string, BattleMapDef> {
  try {
    return JSON.parse(localStorage.getItem(MAPS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function MapSetup({
  setup,
  open,
  onToggle,
  onChange,
  onReset
}: {
  setup: SimSetup
  open: boolean
  onToggle: () => void
  onChange: (def: BattleMapDef | undefined) => void
  onReset: () => void
}): React.JSX.Element {
  const roster = useMemo(() => {
    try {
      return rosterForSetup(setup)
    } catch {
      return [] as RosterEntry[]
    }
  }, [setup])
  const def = setup.battleMap ?? null
  const placed = def ? Object.keys(def.placements).filter((id) => roster.some((r) => r.id === id)).length : 0
  const custom = def ? [...def.tiles].some((c) => c !== '.' && c !== ' ') : false

  return (
    <div className="sim-mapsetup">
      <div className="sim-row" style={{ fontSize: 12, gap: 12 }}>
        <button
          className="sim-linkbtn"
          onClick={() => {
            if (!open && !setup.battleMap) onChange(starterBattleMap(setup))
            onToggle()
          }}
        >
          {open ? '▾ hide map setup' : '▸ set up the map'}
        </button>
        <span className="sim-muted">
          {def
            ? `${def.width}×${def.height}${custom ? ' · custom terrain' : ' · open field'} · ${placed}/${roster.length} placed`
            : 'auto: open room, sides apart'}
        </span>
        {def && (
          <button className="sim-linkbtn danger" onClick={onReset}>
            reset to auto
          </button>
        )}
      </div>
      {open && <MapEditor setup={setup} roster={roster} onChange={(d) => onChange(d)} />}
    </div>
  )
}

function MapEditor({
  setup,
  roster,
  onChange
}: {
  setup: SimSetup
  roster: RosterEntry[]
  onChange: (def: BattleMapDef) => void
}): React.JSX.Element {
  const [def, setDef] = useState<BattleMapDef>(() => setup.battleMap ?? starterBattleMap(setup))
  const defRef = useRef(def)
  const [tool, setToolState] = useState('wall')
  const toolRef = useRef('wall')
  const [brush, setBrushState] = useState(1)
  const brushRef = useRef(1)
  const painting = useRef(false)
  const [drag, setDrag] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [savedMaps, setSavedMaps] = useState<Record<string, BattleMapDef>>(() => readMaps())
  const fileRef = useRef<HTMLInputElement>(null)

  const setTool = (t: string): void => {
    toolRef.current = t
    setToolState(t)
  }
  const setBrush = (n: number): void => {
    brushRef.current = n
    setBrushState(n)
  }
  const commit = useCallback((next: BattleMapDef) => {
    defRef.current = next
    setDef(next)
  }, [])
  const emit = useCallback(
    (next: BattleMapDef) => {
      commit(next)
      onChange(next)
    },
    [commit, onChange]
  )

  const paint = (x: number, y: number): void => {
    const cur = defRef.current
    const r = brushRef.current - 1
    const tiles = cur.tiles.split('')
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = x + dx
        const cy = y + dy
        if (cx < 0 || cy < 0 || cx >= cur.width || cy >= cur.height) continue
        tiles[cy * cur.width + cx] = GLYPH[toolRef.current]
      }
    }
    const placements = { ...cur.placements }
    const next = { ...cur, tiles: tiles.join(''), placements }
    for (const [id, p] of Object.entries(placements)) if (!tokenFits(next, roster, id, p.x, p.y)) delete placements[id]
    commit(next)
  }

  const resize = (w: number, h: number): void => {
    const width = Math.max(8, Math.min(40, w))
    const height = Math.max(8, Math.min(30, h))
    const tiles = Array<string>(width * height).fill('.')
    for (let y = 0; y < Math.min(height, def.height); y++)
      for (let x = 0; x < Math.min(width, def.width); x++) tiles[y * width + x] = tileAt(def, x, y)
    const placements: BattleMapDef['placements'] = {}
    for (const [id, p] of Object.entries(def.placements)) if (p.x < width && p.y < height) placements[id] = p
    emit({ width, height, tiles: tiles.join(''), placements })
  }
  const applyPreset = (name: string): void => {
    const tiles = MAP_PRESETS[name](def.width, def.height)
    const next = { ...def, tiles }
    for (const [id, p] of Object.entries(next.placements)) if (!tokenFits(next, roster, id, p.x, p.y)) delete next.placements[id]
    emit(next)
  }
  const placeToken = (id: string, x: number, y: number): void => {
    if (!roster.some((r) => r.id === id) || !tokenFits(def, roster, id, x, y)) return
    emit({ ...def, placements: { ...def.placements, [id]: { x, y } } })
  }
  const unplace = (id: string): void => {
    const placements = { ...def.placements }
    delete placements[id]
    emit({ ...def, placements })
  }

  const cellToken = useMemo(() => {
    const m = new Map<string, RosterEntry>()
    for (const [id, p] of Object.entries(def.placements)) {
      const e = roster.find((r) => r.id === id)
      if (!e) continue
      const fp = FP[e.size] ?? 1
      for (let dy = 0; dy < fp; dy++) for (let dx = 0; dx < fp; dx++) m.set(`${p.x + dx},${p.y + dy}`, e)
    }
    return m
  }, [def.placements, roster])
  const unplaced = roster.filter((r) => !def.placements[r.id])

  const saveMap = (): void => {
    const name = saveName.trim()
    if (!name) return
    const store = { ...readMaps(), [name]: def }
    localStorage.setItem(MAPS_KEY, JSON.stringify(store))
    setSavedMaps(store)
    setSaveName('')
  }
  const loadMap = (name: string): void => {
    const m = readMaps()[name]
    if (m) emit(m)
  }
  const deleteMap = (name: string): void => {
    const store = readMaps()
    delete store[name]
    localStorage.setItem(MAPS_KEY, JSON.stringify(store))
    setSavedMaps(store)
  }
  const exportMap = (): void => {
    const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'battle-map.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importMap = (file: File): void => {
    void file.text().then((txt) => {
      try {
        const m = JSON.parse(txt) as BattleMapDef
        if (typeof m.width === 'number' && typeof m.height === 'number' && typeof m.tiles === 'string' && m.placements)
          emit({ width: m.width, height: m.height, tiles: m.tiles, placements: m.placements })
      } catch {
        /* ignore */
      }
    })
  }

  return (
    <div
      className="sim-mapeditor"
      onPointerUp={() => {
        if (painting.current) {
          painting.current = false
          onChange(defRef.current)
        }
      }}
      onPointerLeave={() => {
        if (painting.current) {
          painting.current = false
          onChange(defRef.current)
        }
      }}
    >
      <div className="sim-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span className="sim-field-inline">
          size
          <Stepper value={def.width} min={8} max={40} onChange={(w) => resize(w, def.height)} />×
          <Stepper value={def.height} min={8} max={30} onChange={(h) => resize(def.width, h)} />
        </span>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) applyPreset(e.target.value)
          }}
        >
          <option value="">preset…</option>
          {Object.keys(MAP_PRESETS).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="sim-seg">
          {MAP_TOOLS.map((t) => (
            <button
              key={t.kind}
              title={t.label}
              className={tool === t.kind ? 'active mono' : 'mono'}
              onClick={() => setTool(t.kind)}
            >
              {t.glyph}
            </button>
          ))}
        </span>
        <span className="sim-field-inline">
          brush
          <Stepper value={brush} min={1} max={4} onChange={setBrush} />
        </span>
        <button className="sim-linkbtn" onClick={() => emit({ ...def, placements: autoPlace(def, roster) })}>
          auto-place tokens
        </button>
        <button className="sim-linkbtn" onClick={() => emit({ ...def, tiles: '.'.repeat(def.width * def.height) })}>
          clear terrain
        </button>
      </div>

      <TerrainLegend />

      <div className="sim-mapeditor-body">
        <div className="sim-replay-board-wrap">
          <div
            className="sim-replay-board sim-mapeditor-grid"
            style={{ gridTemplateColumns: `repeat(${def.width}, 1ch)` }}
          >
            {Array.from({ length: def.width * def.height }, (_, i) => {
              const x = i % def.width
              const y = Math.floor(i / def.width)
              const key = `${x},${y}`
              const tok = cellToken.get(key)
              const t = def.tiles[i] ?? '.'
              const glyph = tok ? tok.glyph : t === '.' ? '·' : t
              const cls = tok
                ? tok.side === 'party'
                  ? 'sim-u-party'
                  : 'sim-u-monster'
                : t === '#'
                  ? 'sim-t-wall'
                  : t === '.'
                    ? 'sim-t-floor'
                    : 'sim-t-diff'
              return (
                <span
                  key={i}
                  className={cls}
                  draggable={!!tok}
                  onDragStart={(e) => {
                    if (!tok) return
                    e.dataTransfer.setData('text/plain', tok.id)
                    setDrag(tok.id)
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain') || drag
                    if (id) placeToken(id, x, y)
                    setDrag(null)
                  }}
                  onPointerDown={() => {
                    if (tok) return
                    painting.current = true
                    paint(x, y)
                  }}
                  onPointerEnter={() => painting.current && paint(x, y)}
                >
                  {glyph}
                </span>
              )
            })}
          </div>
        </div>

        <div className="sim-mapeditor-side">
          <div
            className="sim-mapeditor-tray"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData('text/plain') || drag
              if (id) unplace(id)
              setDrag(null)
            }}
          >
            {unplaced.length === 0 && <span className="sim-muted">all placed — drag one here to pull it back</span>}
            {unplaced.map((r) => (
              <button
                key={r.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', r.id)
                  setDrag(r.id)
                }}
                className={`sim-tray-tok ${r.side}`}
                title={r.name}
              >
                <span className="mono">{r.glyph}</span> {r.name}
              </button>
            ))}
          </div>

          <div className="sim-mapeditor-io">
            <div className="sim-row" style={{ gap: 6 }}>
              <input placeholder="map name" value={saveName} onChange={(e) => setSaveName(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <button className="sim-linkbtn" onClick={saveMap}>
                save
              </button>
            </div>
            {Object.keys(savedMaps).length > 0 && (
              <div className="sim-row" style={{ gap: 6 }}>
                <select
                  value=""
                  style={{ flex: 1 }}
                  onChange={(e) => {
                    if (e.target.value) loadMap(e.target.value)
                  }}
                >
                  <option value="">load…</option>
                  {Object.keys(savedMaps).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) deleteMap(e.target.value)
                  }}
                >
                  <option value="">delete…</option>
                  {Object.keys(savedMaps).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="sim-row" style={{ gap: 12 }}>
              <button className="sim-linkbtn" onClick={exportMap}>
                export JSON
              </button>
              <button className="sim-linkbtn" onClick={() => fileRef.current?.click()}>
                import JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && importMap(e.target.files[0])}
              />
            </div>
          </div>
        </div>
      </div>
      <p className="sim-muted">
        Click-drag to paint terrain. Drag a token onto a square to place it; drag it to the tray to remove it. Unplaced
        tokens get auto-positioned when you run.
      </p>
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

function PickList({
  label,
  options,
  chosen,
  onToggle
}: {
  label: string
  options: string[]
  chosen: string[]
  onToggle: (v: string) => void
}): React.JSX.Element {
  const available = options.filter((o) => !chosen.includes(o))
  return (
    <div className="sim-picklist">
      <span className="sim-muted">{label}</span>
      {chosen.map((c) => (
        <button key={c} className="sim-chip on" onClick={() => onToggle(c)} title="remove">
          {c} <span style={{ opacity: 0.6 }}>✕</span>
        </button>
      ))}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onToggle(e.target.value)
          }}
        >
          <option value="">+ add</option>
          {available.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

const pct = (n: number): string => `${Math.round(n * 100)}%`
