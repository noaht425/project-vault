// Pure map-trip math — no React/DOM/IPC imports, so it's testable the same
// way graph.ts is (see tests/mapGeometry.test.ts). The one non-obvious part
// is splitLineByZones: rather than requiring the user to trace a route by
// hand for every distance query, it walks the straight line between two
// pins and automatically works out which painted terrain zones it passes
// through and how much of the line falls in each.
import type { LineType, MapLine, MapScale, MapZone, TerrainType } from './noteTypes/map'
import type { TravelMode } from './noteTypes/travelModes'

export interface Point {
  x: number
  y: number
}

export function segmentDistance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

export function pixelsToReal(pixels: number, scale: MapScale): number {
  return pixels * (scale.realDistance / scale.pixelDistance)
}

// Time to travel a fixed real-world distance at a given multiplier — the
// same per-segment math calculateTrip does, exposed standalone so the line
// -drawing form can preview "this width costs about N hours to cross"
// without needing two real pins and a full trip. Infinity at 0 speed,
// matching calculateTrip's impassable-terrain convention.
export function crossingTime(widthPixels: number, scale: MapScale, speedMultiplier: number, travelMode: TravelMode): number {
  const realDistance = pixelsToReal(widthPixels, scale)
  const effectiveSpeed = travelMode.speed * speedMultiplier
  return effectiveSpeed === 0 ? Infinity : realDistance / effectiveSpeed
}

// Standard ray-casting point-in-polygon test. Only correct for simple
// single-ring polygons (no holes, no self-intersection) — the only kind
// MapZone can express in v1.
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const straddles = a.y > point.y !== b.y > point.y
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

// Parametric intersection of segment p1->p2 with segment a->b, returned as
// t along p1->p2 (0..1), or null if they don't cross within both segments'
// bounds. Parallel/collinear edges return null — a zero-measure edge case
// not worth special-casing here.
function segmentIntersectionT(p1: Point, p2: Point, a: Point, b: Point): number | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = b.x - a.x
  const d2y = b.y - a.y
  const denom = d1x * d2y - d1y * d2x
  if (denom === 0) return null

  const dx = a.x - p1.x
  const dy = a.y - p1.y
  const t = (dx * d2y - dy * d2x) / denom
  const u = (dx * d1y - dy * d1x) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return t
}

// First zone (in array order) whose polygon contains the point, or null if
// the point falls outside every painted zone — no z-order/priority system
// for overlapping zones in v1, first-in-array-order wins.
function zoneAt(point: Point, zones: MapZone[]): string | null {
  for (const zone of zones) {
    if (pointInPolygon(point, zone.points)) return zone.terrainTypeId
  }
  return null
}

export interface ZoneSegment {
  terrainTypeId: string | null // null = outside every painted zone
  pixelLength: number
}

export function splitLineByZones(p1: Point, p2: Point, zones: MapZone[]): ZoneSegment[] {
  const totalLength = segmentDistance(p1, p2)
  if (totalLength === 0) {
    return [{ terrainTypeId: zoneAt(p1, zones), pixelLength: 0 }]
  }

  const ts = new Set<number>([0, 1])
  for (const zone of zones) {
    for (let i = 0; i < zone.points.length; i++) {
      const a = zone.points[i]
      const b = zone.points[(i + 1) % zone.points.length]
      const t = segmentIntersectionT(p1, p2, a, b)
      if (t !== null) ts.add(t)
    }
  }

  const sorted = [...ts].sort((x, y) => x - y)
  const segments: ZoneSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const tStart = sorted[i]
    const tEnd = sorted[i + 1]
    if (tEnd - tStart < 1e-9) continue // dedupe near-identical crossing points

    const tMid = (tStart + tEnd) / 2
    const midpoint = { x: p1.x + (p2.x - p1.x) * tMid, y: p1.y + (p2.y - p1.y) * tMid }
    segments.push({ terrainTypeId: zoneAt(midpoint, zones), pixelLength: totalLength * (tEnd - tStart) })
  }

  const merged: ZoneSegment[] = []
  for (const segment of segments) {
    const last = merged.at(-1)
    if (last && last.terrainTypeId === segment.terrainTypeId) {
      last.pixelLength += segment.pixelLength
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

// A road/path/river is drawn as a thin open line rather than a filled
// region (painting a thin, winding river as a polygon is impractical) —
// but the crossing math only understands polygons. So each straight
// segment of a line gets turned into a thin rectangle ("corridor") of the
// line's configured width, offset perpendicular to the segment's
// direction. Once that's done, a line is indistinguishable from a zone as
// far as splitLineByZones is concerned: a route that runs alongside a
// road's corridor for a stretch picks up the road's multiplier for that
// stretch, and a route that crosses a river's (typically much thinner)
// corridor picks up the slowdown right at the crossing — "follows a road"
// and "crosses a river" fall out of the exact same mechanism, just at
// different corridor widths and angles of approach.
function lineToCorridorZones(line: MapLine): MapZone[] {
  const halfWidth = line.widthPixels / 2
  const corridors: MapZone[] = []

  for (let i = 0; i < line.points.length - 1; i++) {
    const a = line.points[i]
    const b = line.points[i + 1]
    const length = segmentDistance(a, b)
    if (length === 0) continue

    // Unit vector perpendicular to a->b, scaled to half the corridor width.
    const nx = (-(b.y - a.y) / length) * halfWidth
    const ny = ((b.x - a.x) / length) * halfWidth

    corridors.push({
      id: `${line.id}-seg${i}`,
      // Corridors are MapZone-shaped for reuse with splitLineByZones — this
      // is the one place a line's lineTypeId gets mapped into a zone's
      // terrainTypeId field; calculateTrip below resolves it against the
      // combined terrainTypes+lineTypes pool, not terrainTypes alone.
      terrainTypeId: line.lineTypeId,
      points: [
        { x: a.x + nx, y: a.y + ny },
        { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny },
        { x: a.x - nx, y: a.y - ny }
      ]
    })
    // Adjacent segment corridors aren't joined/mitered at the seam — a v1
    // simplification. A route crossing exactly at a sharp joint could miss
    // a sliver of coverage; not worth the added geometry for how rarely a
    // straight pin-to-pin line lands precisely on a line's vertex.
  }

  return corridors
}

// Lines take priority over area zones where they overlap — a road cutting
// through a painted forest zone should read as fast travel, not slow, so
// corridor polygons go first in zoneAt's first-match-wins order.
export function zonesIncludingLines(zones: MapZone[], lines: MapLine[]): MapZone[] {
  return [...lines.flatMap(lineToCorridorZones), ...zones]
}

export interface TripSegmentResult {
  terrainTypeId: string | null
  realDistance: number
  time: number
}

export interface TripResult {
  totalPixelDistance: number
  totalRealDistance: number
  totalTime: number // Infinity if any crossed segment's terrain has a 0 speedMultiplier — UI must handle this ("no route — impassable")
  segments: TripSegmentResult[]
}

export function calculateTrip(
  p1: Point,
  p2: Point,
  zones: MapZone[],
  lines: MapLine[],
  terrainTypes: TerrainType[],
  lineTypes: LineType[],
  scale: MapScale,
  travelMode: TravelMode
): TripResult {
  // A crossed segment's terrainTypeId may resolve against either pool —
  // zones only ever reference terrainTypes, but a line-derived corridor
  // (see lineToCorridorZones) carries the line's lineTypeId in that same
  // field, so both pools need to be searchable here.
  const multiplierById = new Map([...terrainTypes, ...lineTypes].map((t) => [t.id, t.speedMultiplier]))
  const zoneSegments = splitLineByZones(p1, p2, zonesIncludingLines(zones, lines))

  let totalRealDistance = 0
  let totalTime = 0
  const segments: TripSegmentResult[] = zoneSegments.map((seg) => {
    const realDistance = pixelsToReal(seg.pixelLength, scale)
    const multiplier = seg.terrainTypeId === null ? 1 : (multiplierById.get(seg.terrainTypeId) ?? 1)
    const effectiveSpeed = travelMode.speed * multiplier
    const time = effectiveSpeed === 0 ? Infinity : realDistance / effectiveSpeed

    totalRealDistance += realDistance
    totalTime += time
    return { terrainTypeId: seg.terrainTypeId, realDistance, time }
  })

  return { totalPixelDistance: segmentDistance(p1, p2), totalRealDistance, totalTime, segments }
}
