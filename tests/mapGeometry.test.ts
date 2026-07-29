import { describe, it, expect } from 'vitest'
import {
  pointInPolygon,
  isLandAt,
  segmentDistance,
  pixelsToReal,
  crossingTime,
  splitLineByZones,
  zonesIncludingLines,
  calculateTrip
} from '../src/common/mapGeometry'
import type { LineType, MapLandmass, MapLine, MapZone, TerrainType } from '../src/common/noteTypes/map'
import type { TravelMode } from '../src/common/noteTypes/travelModes'

// Two adjacent 100x100 squares sharing the edge x=100: a "forest" on the
// left, a "meadow" on the right — used across the splitLineByZones and
// calculateTrip tests below. (Kept as two area zones, not a road — roads
// are a line-type concept, tested separately via ROAD_LINE below.)
const FOREST: MapZone = {
  id: 'zone-forest',
  terrainTypeId: 'forest',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ]
}
const MEADOW: MapZone = {
  id: 'zone-meadow',
  terrainTypeId: 'meadow',
  points: [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 }
  ]
}
const ZONES = [FOREST, MEADOW]

describe('pointInPolygon', () => {
  const square = FOREST.points

  it('is true for a point inside the polygon', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true)
  })

  it('is false for a point outside the polygon', () => {
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false)
  })
})

describe('segmentDistance / pixelsToReal', () => {
  it('computes Euclidean distance', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('scales pixels to real units via a calibration', () => {
    expect(pixelsToReal(50, { pixelDistance: 100, realDistance: 5, unit: 'miles' })).toBe(2.5)
  })
})

describe('crossingTime', () => {
  const scale = { pixelDistance: 100, realDistance: 10, unit: 'miles' } // 1px = 0.1mi
  const walking: TravelMode = { id: 'walk', name: 'Walking', speed: 2, timeUnitLabel: 'hours' }

  it('is independent of anything but the corridor width, multiplier, and speed', () => {
    // 10px corridor = 1mi, at (2mph * 0.2) = 0.4mph effective -> 2.5h
    expect(crossingTime(10, scale, 0.2, walking)).toBeCloseTo(2.5, 10)
  })

  it('is Infinity for an impassable (0x) crossing', () => {
    expect(crossingTime(10, scale, 0, walking)).toBe(Infinity)
  })

  it('a wider corridor costs proportionally more time', () => {
    expect(crossingTime(20, scale, 0.2, walking)).toBeCloseTo(2 * crossingTime(10, scale, 0.2, walking), 10)
  })
})

describe('splitLineByZones', () => {
  it('returns one segment when the whole line is inside a single zone', () => {
    const segments = splitLineByZones({ x: 10, y: 50 }, { x: 90, y: 50 }, ZONES)
    expect(segments).toEqual([{ terrainTypeId: 'forest', isLand: true, pixelLength: 80 }])
  })

  it('splits at the boundary when a line crosses from one zone into an adjacent one', () => {
    const segments = splitLineByZones({ x: 50, y: 50 }, { x: 150, y: 50 }, ZONES)
    expect(segments).toEqual([
      { terrainTypeId: 'forest', isLand: true, pixelLength: 50 },
      { terrainTypeId: 'meadow', isLand: true, pixelLength: 50 }
    ])
  })

  it('falls back to a null (unpainted) segment when the line misses every zone', () => {
    const segments = splitLineByZones({ x: 300, y: 300 }, { x: 400, y: 300 }, ZONES)
    expect(segments).toEqual([{ terrainTypeId: null, isLand: true, pixelLength: 100 }])
  })
})

// A single landmass covering the FOREST zone's footprint (x=[0,100],
// y=[0,100]) but not MEADOW's (x=[100,200]) — used to test the land/water
// split independently of the existing terrain-zone tests above.
const CONTINENT: MapLandmass = {
  id: 'landmass-continent',
  name: 'The Continent',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ]
}

describe('isLandAt', () => {
  it('treats everywhere as land when no landmasses are drawn', () => {
    expect(isLandAt({ x: 9999, y: 9999 }, [])).toBe(true)
  })

  it('is true inside a landmass and false outside every landmass', () => {
    expect(isLandAt({ x: 50, y: 50 }, [CONTINENT])).toBe(true)
    expect(isLandAt({ x: 150, y: 50 }, [CONTINENT])).toBe(false)
  })
})

describe('splitLineByZones with landmasses', () => {
  it('splits an unpainted line at a landmass boundary even with no zones present', () => {
    // Straight line crossing from inside CONTINENT (land) to outside it (water).
    const segments = splitLineByZones({ x: 50, y: 50 }, { x: 150, y: 50 }, [], [CONTINENT])
    expect(segments).toEqual([
      { terrainTypeId: null, isLand: true, pixelLength: 50 },
      { terrainTypeId: null, isLand: false, pixelLength: 50 }
    ])
  })

  it('does not split an explicit zone/line segment on isLand — only null segments care', () => {
    // MEADOW zone spans x=[100,200], entirely outside CONTINENT (water) —
    // it should still come back as one merged 'meadow' segment despite
    // being entirely on the water side, since an explicit zone always wins.
    const segments = splitLineByZones({ x: 110, y: 50 }, { x: 190, y: 50 }, ZONES, [CONTINENT])
    expect(segments).toEqual([{ terrainTypeId: 'meadow', isLand: false, pixelLength: 80 }])
  })
})

// A single horizontal segment 200px long, 20px wide — corridor spans
// y=[40,60] across x=[0,200] (see zonesIncludingLines's describe block for
// the geometry check that confirms this).
const ROAD_LINE: MapLine = { id: 'line-road', lineTypeId: 'road', points: [{ x: 0, y: 50 }, { x: 200, y: 50 }], widthPixels: 20 }
// A single vertical segment 200px long, 10px wide — corridor spans
// x=[95,105] across y=[0,200].
const RIVER_LINE: MapLine = { id: 'line-river', lineTypeId: 'river', points: [{ x: 100, y: 0 }, { x: 100, y: 200 }], widthPixels: 10 }

describe('zonesIncludingLines', () => {
  it('turns a line into a thin corridor polygon that a crossing route registers as passing through', () => {
    // Vertical route straight through the horizontal road's corridor.
    const segments = splitLineByZones({ x: 100, y: 0 }, { x: 100, y: 100 }, zonesIncludingLines([], [ROAD_LINE]))
    expect(segments.map((s) => s.terrainTypeId)).toEqual([null, 'road', null])
    segments.forEach((s, i) => expect(s.pixelLength).toBeCloseTo([40, 20, 40][i], 9))
  })

  it('registers a route that runs along a line for its whole length as a single segment', () => {
    const segments = splitLineByZones({ x: 10, y: 50 }, { x: 190, y: 50 }, zonesIncludingLines([], [ROAD_LINE]))
    expect(segments).toEqual([{ terrainTypeId: 'road', isLand: true, pixelLength: 180 }])
  })

  it('lets a line take priority over an underlying area zone where they overlap', () => {
    // The road corridor cuts straight across the forest zone's middle
    // (forest spans y=[0,100], road corridor spans y=[40,60]).
    const segments = splitLineByZones({ x: 50, y: 0 }, { x: 50, y: 100 }, zonesIncludingLines([FOREST], [ROAD_LINE]))
    expect(segments.map((s) => s.terrainTypeId)).toEqual(['forest', 'road', 'forest'])
    segments.forEach((s, i) => expect(s.pixelLength).toBeCloseTo([40, 20, 40][i], 9))
  })
})

describe('calculateTrip', () => {
  const terrainTypes: TerrainType[] = [
    { id: 'forest', name: 'Forest', color: '#4caf6e', speedMultiplier: 0.5 },
    { id: 'meadow', name: 'Meadow', color: '#d9534f', speedMultiplier: 1.5 }
  ]
  const lineTypes: LineType[] = [
    { id: 'road', name: 'Road', color: '#c9a24d', speedMultiplier: 1.5 },
    { id: 'river', name: 'River', color: '#3c8fe0', speedMultiplier: 0.2 }
  ]
  const scale = { pixelDistance: 100, realDistance: 10, unit: 'miles' }
  const walking: TravelMode = { id: 'walk', name: 'Walking', speed: 2, timeUnitLabel: 'hours' }
  const sailing: TravelMode = { id: 'sail', name: 'Sailing', speed: 4, timeUnitLabel: 'hours' }

  it('sums per-segment distance and time across crossed terrain, weighted by speed multiplier', () => {
    const trip = calculateTrip([{ x: 50, y: 50 }, { x: 150, y: 50 }], ZONES, [], terrainTypes, lineTypes, [], null, scale, walking, walking)

    expect(trip.totalPixelDistance).toBe(100)
    expect(trip.totalRealDistance).toBe(10) // 100px * (10mi / 100px)
    // forest: 5mi at (2 * 0.5)=1mph -> 5h; meadow: 5mi at (2 * 1.5)=3mph -> 5/3h
    expect(trip.totalTime).toBeCloseTo(5 + 5 / 3, 10)
    expect(trip.segments).toEqual([
      { terrainTypeId: 'forest', isLand: true, realDistance: 5, time: 5 },
      { terrainTypeId: 'meadow', isLand: true, realDistance: 5, time: 5 / 3 }
    ])
  })

  it('produces Infinity total time when a crossed terrain is impassable (0 speed multiplier)', () => {
    const impassableForest = [{ ...terrainTypes[0], speedMultiplier: 0 }, terrainTypes[1]]
    const trip = calculateTrip(
      [{ x: 50, y: 50 }, { x: 150, y: 50 }],
      ZONES,
      [],
      impassableForest,
      lineTypes,
      [],
      null,
      scale,
      walking,
      walking
    )

    expect(trip.segments[0].time).toBe(Infinity)
    expect(trip.totalTime).toBe(Infinity)
  })

  it('treats unpainted ground as a normal (1x) multiplier', () => {
    const trip = calculateTrip([{ x: 300, y: 300 }, { x: 400, y: 300 }], ZONES, [], terrainTypes, lineTypes, [], null, scale, walking, walking)

    expect(trip.segments).toEqual([{ terrainTypeId: null, isLand: true, realDistance: 10, time: 5 }]) // 10mi at 2mph
  })

  it('speeds up a route that runs along a road line for its whole length', () => {
    const noRoad = calculateTrip([{ x: 10, y: 50 }, { x: 190, y: 50 }], [], [], terrainTypes, lineTypes, [], null, scale, walking, walking)
    const withRoad = calculateTrip(
      [{ x: 10, y: 50 }, { x: 190, y: 50 }],
      [],
      [ROAD_LINE],
      terrainTypes,
      lineTypes,
      [],
      null,
      scale,
      walking,
      walking
    )

    expect(withRoad.totalRealDistance).toBe(noRoad.totalRealDistance) // same ground covered...
    expect(withRoad.totalTime).toBeLessThan(noRoad.totalTime) // ...but faster, thanks to the road
  })

  it('slows down a route that crosses a river line', () => {
    const noRiver = calculateTrip([{ x: 0, y: 100 }, { x: 200, y: 100 }], [], [], terrainTypes, lineTypes, [], null, scale, walking, walking)
    const withRiver = calculateTrip(
      [{ x: 0, y: 100 }, { x: 200, y: 100 }],
      [],
      [RIVER_LINE],
      terrainTypes,
      lineTypes,
      [],
      null,
      scale,
      walking,
      walking
    )

    expect(withRiver.totalRealDistance).toBe(noRiver.totalRealDistance)
    expect(withRiver.totalTime).toBeGreaterThan(noRiver.totalTime)
  })

  it('treats unpainted ground outside a landmass as normal (1x) speed until a water terrain is set', () => {
    // 150,50 sits outside CONTINENT (x=[0,100]) and outside every zone/line.
    const trip = calculateTrip(
      [{ x: 120, y: 50 }, { x: 180, y: 50 }],
      [],
      [],
      terrainTypes,
      lineTypes,
      [CONTINENT],
      null,
      scale,
      walking,
      walking
    )

    expect(trip.segments).toEqual([{ terrainTypeId: null, isLand: false, realDistance: 6, time: 3 }]) // 6mi at 2mph (same mode both sides here)
  })

  it('applies the chosen water terrain multiplier outside a landmass, and normal speed inside it', () => {
    const oceanTerrainTypes: TerrainType[] = [...terrainTypes, { id: 'ocean', name: 'Ocean', color: '#3c8fe0', speedMultiplier: 0.25 }]
    // Route crosses straight out of CONTINENT (land, x<100) into open water (x>100).
    const trip = calculateTrip(
      [{ x: 50, y: 50 }, { x: 150, y: 50 }],
      [],
      [],
      oceanTerrainTypes,
      lineTypes,
      [CONTINENT],
      'ocean',
      scale,
      walking,
      walking
    )

    // land half: 5mi at (2*1)=2mph -> 2.5h; water half: 5mi at (2*0.25)=0.5mph -> 10h
    expect(trip.segments).toEqual([
      { terrainTypeId: null, isLand: true, realDistance: 5, time: 2.5 },
      { terrainTypeId: null, isLand: false, realDistance: 5, time: 10 }
    ])
    expect(trip.totalTime).toBeCloseTo(12.5, 10)
  })

  it("lets an explicit zone/line override water's default even outside a landmass (e.g. a sea lane)", () => {
    // MEADOW (x=[100,200]) is entirely outside CONTINENT (water side) but is
    // an explicitly painted zone — its own 1.5x multiplier should win, not
    // the impassable ocean default.
    const oceanTerrainTypes: TerrainType[] = [...terrainTypes, { id: 'ocean', name: 'Ocean', color: '#3c8fe0', speedMultiplier: 0 }]
    const trip = calculateTrip(
      [{ x: 110, y: 50 }, { x: 190, y: 50 }],
      ZONES,
      [],
      oceanTerrainTypes,
      lineTypes,
      [CONTINENT],
      'ocean',
      scale,
      walking,
      walking
    )

    expect(trip.totalTime).not.toBe(Infinity)
    expect(trip.segments).toEqual([{ terrainTypeId: 'meadow', isLand: false, realDistance: 8, time: 8 / 3 }])
  })

  it('switches from the land mode to the water mode when an unpainted route crosses a landmass boundary', () => {
    // Same crossing as the "applies the chosen water terrain multiplier"
    // case above, but using distinct land/water travel modes (walking vs.
    // sailing) instead of a water terrain multiplier — the mode swap alone
    // should account for the speed change.
    const trip = calculateTrip(
      [{ x: 50, y: 50 }, { x: 150, y: 50 }],
      [],
      [],
      terrainTypes,
      lineTypes,
      [CONTINENT],
      null,
      scale,
      walking,
      sailing
    )

    // land half: 5mi at 2mph (walking) -> 2.5h; water half: 5mi at 4mph (sailing) -> 1.25h
    expect(trip.segments).toEqual([
      { terrainTypeId: null, isLand: true, realDistance: 5, time: 2.5 },
      { terrainTypeId: null, isLand: false, realDistance: 5, time: 1.25 }
    ])
    expect(trip.totalTime).toBeCloseTo(3.75, 10)
  })

  it('walks a multi-leg hand-drawn path (walk -> boat -> walk) and concatenates every leg', () => {
    // A second landmass on the far side of the water gap so the drawn path
    // re-enters land at the end, mirroring a real "walk to the dock, sail
    // across, walk inland again" route.
    const farShore: MapLandmass = {
      id: 'landmass-far-shore',
      name: 'Far Shore',
      points: [
        { x: 180, y: 0 },
        { x: 260, y: 0 },
        { x: 260, y: 100 },
        { x: 180, y: 100 }
      ]
    }
    const path = [
      { x: 50, y: 50 }, // inside CONTINENT
      { x: 150, y: 50 }, // open water, between the two landmasses
      { x: 220, y: 50 } // inside farShore
    ]
    const trip = calculateTrip(path, [], [], terrainTypes, lineTypes, [CONTINENT, farShore], null, scale, walking, sailing)

    // Leg 1 (land, 50->150px = 10mi at 2mph): splits at x=100 (CONTINENT's edge) into
    // 5mi land (2.5h) + 5mi water (1.25h). Leg 2 (150->220px = 7mi) splits at x=180
    // (farShore's edge) into 3mi water (0.75h) + 4mi land (2h).
    expect(trip.totalPixelDistance).toBe(170)
    expect(trip.segments.map((s) => s.isLand)).toEqual([true, false, false, true])
    expect(trip.segments.map((s) => s.realDistance)).toEqual([5, 5, 3, 4])
    expect(trip.totalTime).toBeCloseTo(2.5 + 1.25 + 0.75 + 2, 10)
  })
})
