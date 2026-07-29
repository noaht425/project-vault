import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { mapFrontmatterSchema } from '../../../../common/noteTypes/map'
import type { LineType, MapLandmass, MapLine, MapZone, TerrainType } from '../../../../common/noteTypes/map'
import { crossingTime, type Point } from '../../../../common/mapGeometry'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { useTravelModesStore, EMPTY_TRAVEL_MODES } from '../../state/travelModesStore'
import { MapCanvas, type MapCanvasMode } from './MapCanvas'
import { MapTripCalculator } from './MapTripCalculator'
import { MapTimeline } from './MapTimeline'
import { TravelModesEditor } from './TravelModesEditor'

function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Failed to load the uploaded image'))
    img.src = url
  })
}

export function MapSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = mapFrontmatterSchema.parse(frontmatter)

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const [mode, setMode] = useState<MapCanvasMode>('view')
  const [uploading, setUploading] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [pendingPixelDistance, setPendingPixelDistance] = useState<number | null>(null)
  const [realDistanceInput, setRealDistanceInput] = useState('')
  const [unitInput, setUnitInput] = useState(data.scale?.unit ?? 'miles')

  // Shared by both the zone- and line-confirmation forms below — only one
  // of pendingZonePoints/pendingLinePoints is ever non-null at a time
  // (gated by `mode`), so there's no risk of them colliding.
  const [terrainChoice, setTerrainChoice] = useState('')
  const [newTerrainName, setNewTerrainName] = useState('')
  const [newTerrainColor, setNewTerrainColor] = useState('#4caf6e')
  const [newTerrainMultiplier, setNewTerrainMultiplier] = useState(1)

  const [pendingZonePoints, setPendingZonePoints] = useState<Point[] | null>(null)

  const [pendingLinePoints, setPendingLinePoints] = useState<Point[] | null>(null)
  const [lineWidthInput, setLineWidthInput] = useState(20)

  const [pendingLandmassPoints, setPendingLandmassPoints] = useState<Point[] | null>(null)
  const [newLandmassName, setNewLandmassName] = useState('')

  const [pendingPinPoint, setPendingPinPoint] = useState<Point | null>(null)
  const [pinQuery, setPinQuery] = useState('')
  const [pinResults, setPinResults] = useState<{ title: string }[]>([])

  // Lifted up from the Timeline section (below) so MapCanvas, which renders
  // above it, can ring the pins for whatever events are currently revealed.
  const [highlightedPinIds, setHighlightedPinIds] = useState<Set<string>>(new Set())

  // Lifted up from the Trip Calculator section (below) for the same reason —
  // MapCanvas renders above it but owns the actual overlay drawing.
  // drawnTripPath is the raw hand-drawn route (see MapCanvas's 'draw-trip'
  // mode); tripOverlayPath is whichever path (drawn or straight pin-to-pin)
  // is currently shown on the map, which the calculator can toggle
  // independently of whether a route has been drawn.
  const [drawnTripPath, setDrawnTripPath] = useState<Point[] | null>(null)
  const [tripOverlayPath, setTripOverlayPath] = useState<Point[] | null>(null)

  // Only for the line form's crossing-time preview below — travel modes
  // are otherwise entirely TravelModesEditor's/MapTripCalculator's concern.
  const travelModesNoteId = useTravelModesStore((s) => s.noteId)
  const travelModesLoading = useTravelModesStore((s) => s.loading)
  const travelModes = useTravelModesStore((s) => s.frontmatter?.modes ?? EMPTY_TRAVEL_MODES)
  const loadTravelModes = useTravelModesStore((s) => s.load)
  useEffect(() => {
    if (!travelModesNoteId && !travelModesLoading) void loadTravelModes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!data.image) {
      setImageUrl(null)
      return
    }
    window.cloudApi
      .getMapImageUrl(data.image.path)
      .then((url) => !cancelled && setImageUrl(url))
      .catch(() => !cancelled && setImageUrl(null))
    return () => {
      cancelled = true
    }
  }, [data.image?.path])

  useEffect(() => {
    if (!pendingPinPoint || !pinQuery.trim()) {
      setPinResults([])
      return
    }
    let cancelled = false
    noteRefApi.searchTitles(pinQuery, 'location').then((results) => !cancelled && setPinResults(results))
    return () => {
      cancelled = true
    }
  }, [pinQuery, pendingPinPoint, noteRefApi])

  const handleUploadImage = async (): Promise<void> => {
    setUploading(true)
    setUploadError(null)
    try {
      const result = await window.cloudApi.pickAndUploadMapImage()
      if (!result) return // user cancelled the file picker
      const url = await window.cloudApi.getMapImageUrl(result.path)
      const dims = await loadImageDimensions(url)
      // Replacing an existing image leaves the old file in Storage —
      // acceptable for a personal single-user tool, not worth a cleanup
      // pass in v1.
      updateFrontmatter({ image: { path: result.path, width: dims.width, height: dims.height } })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const confirmCalibration = (): void => {
    const real = Number(realDistanceInput)
    if (pendingPixelDistance === null || !Number.isFinite(real) || real <= 0) return
    updateFrontmatter({ scale: { pixelDistance: pendingPixelDistance, realDistance: real, unit: unitInput.trim() || 'miles' } })
    setPendingPixelDistance(null)
    setRealDistanceInput('')
    setMode('view')
  }
  const cancelCalibration = (): void => {
    setPendingPixelDistance(null)
    setRealDistanceInput('')
    setMode('view')
  }

  // Builds a fresh TerrainType/LineType from the "+ New…" mini-form if
  // that's what's selected, or resolves the chosen existing one from
  // whichever pool the caller passes — shared by confirmZone (terrainTypes)
  // and confirmLine (lineTypes). Returns null if the form isn't ready to
  // submit (name required for a new type).
  const resolveType = (pool: TerrainType[]): TerrainType | null => {
    if (terrainChoice === '__new__') {
      if (!newTerrainName.trim()) return null
      return { id: crypto.randomUUID(), name: newTerrainName.trim(), color: newTerrainColor, speedMultiplier: newTerrainMultiplier }
    }
    return pool.find((t) => t.id === terrainChoice) ?? null
  }
  // Live preview only — unlike resolveType, doesn't require a name yet, so
  // the crossing-time preview updates as soon as a multiplier is entered.
  const previewMultiplier = terrainChoice === '__new__' ? newTerrainMultiplier : data.lineTypes.find((t) => t.id === terrainChoice)?.speedMultiplier
  const resetPendingTerrainForm = (): void => {
    setTerrainChoice('')
    setNewTerrainName('')
  }

  const confirmZone = (): void => {
    if (!pendingZonePoints) return
    const terrainType = resolveType(data.terrainTypes)
    if (!terrainType) return
    const zone: MapZone = { id: crypto.randomUUID(), terrainTypeId: terrainType.id, points: pendingZonePoints }
    // Terrain type + zone are written in one patch when it's a new terrain
    // type — data.terrainTypes read here is a snapshot from this render, so
    // a second separate updateFrontmatter call for the zone would silently
    // drop the new terrain type (stale closure), not merge with it.
    const isNewTerrainType = terrainChoice === '__new__'
    updateFrontmatter(
      isNewTerrainType
        ? { terrainTypes: [...data.terrainTypes, terrainType], zones: [...data.zones, zone] }
        : { zones: [...data.zones, zone] }
    )
    setPendingZonePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }
  const cancelZone = (): void => {
    setPendingZonePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }

  const confirmLine = (): void => {
    if (!pendingLinePoints) return
    const widthPixels = Number(lineWidthInput)
    if (!Number.isFinite(widthPixels) || widthPixels <= 0) return
    const lineType = resolveType(data.lineTypes)
    if (!lineType) return
    const line: MapLine = { id: crypto.randomUUID(), lineTypeId: lineType.id, points: pendingLinePoints, widthPixels }
    const isNewLineType = terrainChoice === '__new__'
    updateFrontmatter(
      isNewLineType ? { lineTypes: [...data.lineTypes, lineType], lines: [...data.lines, line] } : { lines: [...data.lines, line] }
    )
    setPendingLinePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }
  const cancelLine = (): void => {
    setPendingLinePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }

  const confirmLandmass = (): void => {
    if (!pendingLandmassPoints) return
    const landmass: MapLandmass = { id: crypto.randomUUID(), name: newLandmassName.trim(), points: pendingLandmassPoints }
    updateFrontmatter({ landmasses: [...data.landmasses, landmass] })
    setPendingLandmassPoints(null)
    setNewLandmassName('')
    setMode('view')
  }
  const cancelLandmass = (): void => {
    setPendingLandmassPoints(null)
    setNewLandmassName('')
    setMode('view')
  }

  const confirmPin = (title: string): void => {
    if (!pendingPinPoint) return
    updateFrontmatter({
      pins: [...data.pins, { id: crypto.randomUUID(), x: pendingPinPoint.x, y: pendingPinPoint.y, locationTitle: title, label: '' }]
    })
    setPendingPinPoint(null)
    setMode('view')
  }
  // Places a pin with just a typed label, no linked location note — for
  // marking a spot to measure distance to/from without first creating a
  // full note for it.
  const confirmFreehandPin = (): void => {
    if (!pendingPinPoint || !pinQuery.trim()) return
    updateFrontmatter({
      pins: [...data.pins, { id: crypto.randomUUID(), x: pendingPinPoint.x, y: pendingPinPoint.y, locationTitle: null, label: pinQuery.trim() }]
    })
    setPendingPinPoint(null)
    setMode('view')
  }
  const cancelPin = (): void => {
    setPendingPinPoint(null)
    setMode('view')
  }

  const updateTerrainType = (id: string, patch: Partial<TerrainType>): void =>
    updateFrontmatter({ terrainTypes: data.terrainTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const updateLineType = (id: string, patch: Partial<LineType>): void =>
    updateFrontmatter({ lineTypes: data.lineTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const removeZone = (id: string): void => updateFrontmatter({ zones: data.zones.filter((z) => z.id !== id) })
  const removeLine = (id: string): void => updateFrontmatter({ lines: data.lines.filter((l) => l.id !== id) })
  const removeLandmass = (id: string): void => updateFrontmatter({ landmasses: data.landmasses.filter((l) => l.id !== id) })
  const removeTerrainType = (id: string): void =>
    updateFrontmatter({
      terrainTypes: data.terrainTypes.filter((t) => t.id !== id),
      // Clear a dangling water-terrain reference so the picker below falls
      // back to "None" instead of pointing at a terrain type that no longer
      // exists.
      waterTerrainTypeId: data.waterTerrainTypeId === id ? null : data.waterTerrainTypeId
    })
  const removeLineType = (id: string): void => updateFrontmatter({ lineTypes: data.lineTypes.filter((t) => t.id !== id) })
  const removePin = (id: string): void => updateFrontmatter({ pins: data.pins.filter((p) => p.id !== id) })

  const terrainNameById = new Map(data.terrainTypes.map((t) => [t.id, t.name]))
  const lineTypeNameById = new Map(data.lineTypes.map((t) => [t.id, t.name]))

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={() => void handleUploadImage()} disabled={uploading}>
          {uploading ? 'Uploading…' : data.image ? 'Replace image' : 'Upload image'}
        </button>
        {uploadError && <span className="right-panel-note">{uploadError}</span>}
      </div>

      {data.image && imageUrl && (
        <>
          <div className="editor-toolbar">
            <button className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>
              View
            </button>
            <button className={mode === 'calibrate' ? 'active' : ''} onClick={() => setMode('calibrate')}>
              Calibrate Scale
            </button>
            <button className={mode === 'paint-zone' ? 'active' : ''} onClick={() => setMode('paint-zone')}>
              Paint Terrain
            </button>
            <button className={mode === 'draw-line' ? 'active' : ''} onClick={() => setMode('draw-line')}>
              Draw Line
            </button>
            <button className={mode === 'paint-landmass' ? 'active' : ''} onClick={() => setMode('paint-landmass')}>
              Draw Landmass
            </button>
            <button className={mode === 'place-pin' ? 'active' : ''} onClick={() => setMode('place-pin')}>
              Place Pin
            </button>
          </div>

          {mode === 'calibrate' && pendingPixelDistance === null && (
            <p className="right-panel-note">Click two points a known real-world distance apart.</p>
          )}
          {mode === 'paint-zone' && !pendingZonePoints && (
            <p className="right-panel-note">Click to add vertices, press Enter to finish (3+ points), Escape to cancel.</p>
          )}
          {mode === 'draw-line' && !pendingLinePoints && (
            <p className="right-panel-note">
              Click to add points along a road, path, or river, press Enter to finish (2+ points), Escape to cancel.
            </p>
          )}
          {mode === 'paint-landmass' && !pendingLandmassPoints && (
            <p className="right-panel-note">
              Click to trace a continent or island's outline, press Enter to finish (3+ points), Escape to cancel. Anything outside
              every landmass is treated as water.
            </p>
          )}
          {mode === 'draw-trip' && (
            <p className="right-panel-note">
              Click to trace the actual route you'd travel — it doesn't need to be straight, and doesn't need to start/end on a pin
              (e.g. walk to a dock, cross the water, walk again). Press Enter to finish (2+ points), Escape to cancel.
            </p>
          )}
          {mode === 'place-pin' && !pendingPinPoint && <p className="right-panel-note">Click a spot on the map to place a pin.</p>}

          <div style={{ position: 'relative', height: 480, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <MapCanvas
              imageUrl={imageUrl}
              imageWidth={data.image.width}
              imageHeight={data.image.height}
              zones={data.zones}
              lines={data.lines}
              landmasses={data.landmasses}
              pins={data.pins}
              terrainTypes={data.terrainTypes}
              lineTypes={data.lineTypes}
              mode={mode}
              onCalibrate={setPendingPixelDistance}
              onZoneDrawn={setPendingZonePoints}
              onLineDrawn={setPendingLinePoints}
              onLandmassDrawn={setPendingLandmassPoints}
              onTripDrawn={(points) => {
                setDrawnTripPath(points)
                setTripOverlayPath(points) // drawing a route implies showing it — no reason to hide what you just traced
                setMode('view')
              }}
              onPinPlaced={(point) => {
                setPendingPinPoint(point)
                setPinQuery('')
                setPinResults([])
              }}
              onPinClick={(pin) => pin.locationTitle && void noteRefApi.openByTitle(pin.locationTitle, 'location')}
              highlightedPinIds={highlightedPinIds}
              tripPath={tripOverlayPath}
            />
          </div>

          {pendingPixelDistance !== null && (
            <div className="sheet-row" style={{ marginTop: 8 }}>
              <label className="sheet-field sheet-field-narrow">
                Real distance
                <input type="number" value={realDistanceInput} onChange={(e) => setRealDistanceInput(e.target.value)} autoFocus />
              </label>
              <label className="sheet-field sheet-field-narrow">
                Unit
                <input value={unitInput} onChange={(e) => setUnitInput(e.target.value)} placeholder="miles" />
              </label>
              <button className="sheet-open-ref-button" onClick={confirmCalibration}>
                Set scale
              </button>
              <button className="sheet-open-ref-button" onClick={cancelCalibration}>
                Cancel
              </button>
            </div>
          )}

          {pendingZonePoints && (
            <div className="sheet-row" style={{ marginTop: 8 }}>
              <label className="sheet-field">
                Terrain type
                <select value={terrainChoice} onChange={(e) => setTerrainChoice(e.target.value)}>
                  <option value="">Choose…</option>
                  {data.terrainTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value="__new__">+ New terrain type…</option>
                </select>
              </label>
              {terrainChoice === '__new__' && (
                <>
                  <label className="sheet-field">
                    Name
                    <input value={newTerrainName} onChange={(e) => setNewTerrainName(e.target.value)} placeholder="Forest" />
                  </label>
                  <label className="sheet-field sheet-field-narrow">
                    Color
                    <input type="color" value={newTerrainColor} onChange={(e) => setNewTerrainColor(e.target.value)} />
                  </label>
                  <label className="sheet-field sheet-field-narrow">
                    Speed x
                    <input type="number" step="0.1" value={newTerrainMultiplier} onChange={(e) => setNewTerrainMultiplier(Number(e.target.value))} />
                  </label>
                </>
              )}
              <button className="sheet-open-ref-button" onClick={confirmZone}>
                Add zone
              </button>
              <button className="sheet-open-ref-button" onClick={cancelZone}>
                Cancel
              </button>
            </div>
          )}

          {pendingLinePoints && (
            <div style={{ marginTop: 8 }}>
              <div className="sheet-row">
                <label className="sheet-field">
                  Line type
                  <select value={terrainChoice} onChange={(e) => setTerrainChoice(e.target.value)}>
                    <option value="">Choose…</option>
                    {data.lineTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                    <option value="__new__">+ New line type…</option>
                  </select>
                </label>
                {terrainChoice === '__new__' && (
                  <>
                    <label className="sheet-field">
                      Name
                      <input value={newTerrainName} onChange={(e) => setNewTerrainName(e.target.value)} placeholder="Road" />
                    </label>
                    <label className="sheet-field sheet-field-narrow">
                      Color
                      <input type="color" value={newTerrainColor} onChange={(e) => setNewTerrainColor(e.target.value)} />
                    </label>
                    <label className="sheet-field sheet-field-narrow">
                      Speed x
                      <input type="number" step="0.1" value={newTerrainMultiplier} onChange={(e) => setNewTerrainMultiplier(Number(e.target.value))} />
                    </label>
                  </>
                )}
                <label className="sheet-field sheet-field-narrow">
                  Width (px)
                  <input type="number" value={lineWidthInput} onChange={(e) => setLineWidthInput(Number(e.target.value))} />
                </label>
                <button className="sheet-open-ref-button" onClick={confirmLine}>
                  Add line
                </button>
                <button className="sheet-open-ref-button" onClick={cancelLine}>
                  Cancel
                </button>
              </div>

              {data.scale && previewMultiplier !== undefined && travelModes.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <span className="right-panel-note">Approx. time to cross this width, per travel mode:</span>
                  <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
                    <tbody>
                      {travelModes.map((mode) => {
                        const time = crossingTime(lineWidthInput, data.scale!, previewMultiplier, mode)
                        const normal = crossingTime(lineWidthInput, data.scale!, 1, mode)
                        const delta = time - normal
                        return (
                          <tr key={mode.id}>
                            <td style={{ paddingRight: 12 }}>{mode.name}</td>
                            <td style={{ paddingRight: 12 }}>{time === Infinity ? 'impassable' : `${time.toFixed(1)} ${mode.timeUnitLabel}`}</td>
                            <td>
                              {time === Infinity
                                ? ''
                                : `(${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ${mode.timeUnitLabel} vs. normal ground)`}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!data.scale && <p className="right-panel-note">Calibrate this map's scale to preview crossing times.</p>}
            </div>
          )}

          {pendingLandmassPoints && (
            <div className="sheet-row" style={{ marginTop: 8 }}>
              <label className="sheet-field">
                Name (optional)
                <input value={newLandmassName} onChange={(e) => setNewLandmassName(e.target.value)} placeholder="The Old Continent" autoFocus />
              </label>
              <button className="sheet-open-ref-button" onClick={confirmLandmass}>
                Add landmass
              </button>
              <button className="sheet-open-ref-button" onClick={cancelLandmass}>
                Cancel
              </button>
            </div>
          )}

          {pendingPinPoint && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                value={pinQuery}
                onChange={(e) => setPinQuery(e.target.value)}
                placeholder="Search existing location notes, or type any label…"
                autoFocus
              />
              {pinResults.map((r) => (
                <button key={r.title} onClick={() => confirmPin(r.title)} style={{ textAlign: 'left' }}>
                  {r.title} (linked note)
                </button>
              ))}
              <button onClick={confirmFreehandPin} disabled={!pinQuery.trim()} style={{ textAlign: 'left' }}>
                Just place a pin here labeled "{pinQuery.trim() || '…'}" (no note)
              </button>
              <p className="right-panel-note">A freehand pin has no linked note — it still works in the trip calculator, just nothing to open.</p>
              <button onClick={cancelPin}>Cancel</button>
            </div>
          )}
        </>
      )}

      {data.terrainTypes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Terrain types</strong>
          <p className="right-panel-note">
            For painted regions (Paint Terrain) — edit anytime, including the seeded Mountains/Forest defaults.
          </p>
          {data.terrainTypes.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <input type="color" value={t.color} onChange={(e) => updateTerrainType(t.id, { color: e.target.value })} />
              <input style={{ flex: 2 }} value={t.name} onChange={(e) => updateTerrainType(t.id, { name: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                Speed x
                <input
                  style={{ width: 60 }}
                  type="number"
                  step="0.1"
                  value={t.speedMultiplier}
                  onChange={(e) => updateTerrainType(t.id, { speedMultiplier: Number(e.target.value) })}
                />
              </label>
              <button onClick={() => removeTerrainType(t.id)} title="Delete terrain type">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {data.lineTypes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Line types</strong>
          <p className="right-panel-note">
            For roads, paths, and rivers (Draw Line) — edit anytime, including the seeded Road/Path/River defaults.
          </p>
          {data.lineTypes.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <input type="color" value={t.color} onChange={(e) => updateLineType(t.id, { color: e.target.value })} />
              <input style={{ flex: 2 }} value={t.name} onChange={(e) => updateLineType(t.id, { name: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                Speed x
                <input
                  style={{ width: 60 }}
                  type="number"
                  step="0.1"
                  value={t.speedMultiplier}
                  onChange={(e) => updateLineType(t.id, { speedMultiplier: Number(e.target.value) })}
                />
              </label>
              <button onClick={() => removeLineType(t.id)} title="Delete line type">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {data.zones.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Terrain zones</strong>
          {data.zones.map((zone) => (
            <div key={zone.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: data.terrainTypes.find((t) => t.id === zone.terrainTypeId)?.color ?? '#888'
                }}
              />
              <span>{terrainNameById.get(zone.terrainTypeId) ?? 'Unknown terrain'}</span>
              <button onClick={() => removeZone(zone.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {data.lines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Lines (roads, paths, rivers)</strong>
          {data.lines.map((line) => (
            <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: data.lineTypes.find((t) => t.id === line.lineTypeId)?.color ?? '#888'
                }}
              />
              <span>
                {lineTypeNameById.get(line.lineTypeId) ?? 'Unknown line type'} ({line.widthPixels}px wide)
              </span>
              <button onClick={() => removeLine(line.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {data.landmasses.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Landmasses (continents/islands)</strong>
          <p className="right-panel-note">
            Anything outside every landmass boundary below is treated as water, using the "Water terrain" pick below (or normal
            1x speed if none is set) — unless it's covered by its own painted zone or line.
          </p>
          {data.landmasses.map((landmass) => (
            <div key={landmass.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span
                style={{ width: 10, height: 10, borderRadius: '50%', border: '2px dashed #2a6f97' }}
              />
              <span>{landmass.name || 'Unnamed landmass'}</span>
              <button onClick={() => removeLandmass(landmass.id)}>✕</button>
            </div>
          ))}
          <label className="sheet-field" style={{ marginTop: 6, maxWidth: 260 }}>
            Water terrain
            <select
              value={data.waterTerrainTypeId ?? ''}
              onChange={(e) => updateFrontmatter({ waterTerrainTypeId: e.target.value || null })}
            >
              <option value="">None (water = normal 1x speed)</option>
              {data.terrainTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {!data.waterTerrainTypeId && (
            <p className="right-panel-note">
              Don't see the terrain you want (e.g. "Ocean")? Use Paint Terrain to draw one small zone with a "+ New terrain
              type…" (anywhere, even somewhere you'll delete afterward) — the terrain type itself stays available here even
              after you remove that zone.
            </p>
          )}
        </div>
      )}

      {data.pins.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Pins</strong>
          {data.pins.map((pin) =>
            pin.locationTitle ? (
              <div key={pin.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <button onClick={() => void noteRefApi.openByTitle(pin.locationTitle!, 'location')} style={{ textAlign: 'left' }}>
                  {pin.locationTitle}
                </button>
                <button onClick={() => removePin(pin.id)}>✕</button>
              </div>
            ) : (
              <div key={pin.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ opacity: 0.7 }}>{pin.label} (no note)</span>
                <button onClick={() => removePin(pin.id)}>✕</button>
              </div>
            )
          )}
        </div>
      )}

      <details style={{ marginTop: 12 }}>
        <summary>Trip calculator</summary>
        <MapTripCalculator
          pins={data.pins}
          zones={data.zones}
          lines={data.lines}
          terrainTypes={data.terrainTypes}
          lineTypes={data.lineTypes}
          landmasses={data.landmasses}
          waterTerrainTypeId={data.waterTerrainTypeId}
          scale={data.scale}
          drawnPath={drawnTripPath}
          onClearDrawnPath={() => {
            setDrawnTripPath(null)
            setTripOverlayPath(null)
          }}
          onStartDrawing={() => setMode('draw-trip')}
          onShowPathChange={setTripOverlayPath}
        />
      </details>

      <details style={{ marginTop: 8 }} onToggle={(e) => !e.currentTarget.open && setHighlightedPinIds(new Set())}>
        <summary>Timeline</summary>
        <MapTimeline
          pins={data.pins}
          zones={data.zones}
          lines={data.lines}
          terrainTypes={data.terrainTypes}
          lineTypes={data.lineTypes}
          landmasses={data.landmasses}
          waterTerrainTypeId={data.waterTerrainTypeId}
          scale={data.scale}
          noteRefApi={noteRefApi}
          onHighlightChange={setHighlightedPinIds}
        />
      </details>

      <details style={{ marginTop: 8 }}>
        <summary>Travel modes (shared across all maps)</summary>
        <TravelModesEditor />
      </details>
    </div>
  )
}
