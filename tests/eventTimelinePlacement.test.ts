import { describe, it, expect } from 'vitest'
import { computeFullWindow, windowForZoom, panWindow, placeEvents, MAX_ZOOM_LEVEL } from '../src/common/eventTimelinePlacement'

describe('computeFullWindow', () => {
  it('pads 5% on each side of the min/max', () => {
    const window = computeFullWindow([0, 1000])
    expect(window.start).toBe(-50)
    expect(window.end).toBe(1050)
  })

  it('gives a single point a small non-zero window', () => {
    const window = computeFullWindow([500])
    expect(window.end).toBeGreaterThan(window.start)
    expect(window.start).toBeLessThanOrEqual(500)
    expect(window.end).toBeGreaterThanOrEqual(500)
  })

  it('gives an empty list a default non-zero window instead of NaN', () => {
    const window = computeFullWindow([])
    expect(Number.isFinite(window.start)).toBe(true)
    expect(Number.isFinite(window.end)).toBe(true)
    expect(window.end).toBeGreaterThan(window.start)
  })
})

describe('windowForZoom', () => {
  it('zoom level 0 returns roughly the full window, centered wherever asked', () => {
    const full = { start: 0, end: 1000 }
    const zoomed = windowForZoom(full, 0, 500)
    expect(zoomed.end - zoomed.start).toBe(1000)
    expect(zoomed.start).toBe(0)
    expect(zoomed.end).toBe(1000)
  })

  it('each zoom level in is narrower than the last', () => {
    const full = { start: 0, end: 1_000_000 }
    const spans = [0, 1, 2, 3].map((z) => {
      const w = windowForZoom(full, z, 500_000)
      return w.end - w.start
    })
    expect(spans[1]).toBeLessThan(spans[0])
    expect(spans[2]).toBeLessThan(spans[1])
    expect(spans[3]).toBeLessThan(spans[2])
  })

  it('centers the window on the requested point', () => {
    const full = { start: 0, end: 1_000_000 }
    const zoomed = windowForZoom(full, 2, 500_000)
    const center = (zoomed.start + zoomed.end) / 2
    expect(center).toBeCloseTo(500_000, 5)
  })

  it('clamps a negative zoom level to level 0 rather than zooming out past the full window', () => {
    const full = { start: 0, end: 1000 }
    expect(windowForZoom(full, -5, 500)).toEqual(windowForZoom(full, 0, 500))
  })
})

describe('panWindow', () => {
  it('shifts start and end by the same amount, keeping the span', () => {
    const window = { start: 100, end: 200 }
    const panned = panWindow(window, 0.5)
    expect(panned).toEqual({ start: 150, end: 250 })
  })

  it('supports panning backward with a negative fraction', () => {
    const window = { start: 100, end: 200 }
    expect(panWindow(window, -0.5)).toEqual({ start: 50, end: 150 })
  })
})

describe('placeEvents', () => {
  const window = { start: 0, end: 1000 }

  it('places a single event at its proportional position', () => {
    const placements = placeEvents([{ minutes: 500, data: 'a' }], window, 1000)
    expect(placements).toEqual([{ kind: 'event', event: 'a', minutes: 500, positionFraction: 0.5 }])
  })

  it('excludes events outside the window', () => {
    const placements = placeEvents(
      [
        { minutes: -100, data: 'before' },
        { minutes: 500, data: 'inside' },
        { minutes: 1500, data: 'after' }
      ],
      window,
      1000
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]).toMatchObject({ kind: 'event', event: 'inside' })
  })

  it('keeps far-apart events as separate pills', () => {
    const placements = placeEvents(
      [
        { minutes: 100, data: 'a' },
        { minutes: 900, data: 'b' }
      ],
      window,
      1000,
      24
    )
    expect(placements).toHaveLength(2)
    expect(placements.every((p) => p.kind === 'event')).toBe(true)
  })

  it('merges events closer than minPillSpacingPx into one cluster', () => {
    // At pixelWidth 1000 over a 1000-minute window, 1 minute = 1px. Two
    // events 5 minutes apart are well inside a 24px spacing threshold.
    const placements = placeEvents(
      [
        { minutes: 500, data: 'a' },
        { minutes: 505, data: 'b' }
      ],
      window,
      1000,
      24
    )
    expect(placements).toHaveLength(1)
    expect(placements[0].kind).toBe('cluster')
    if (placements[0].kind === 'cluster') {
      expect(placements[0].events).toEqual(['a', 'b'])
      expect(placements[0].minutes).toBeCloseTo(502.5)
    }
  })

  it('chains a dense run of events into one cluster even though the whole run spans more than the spacing threshold', () => {
    const items = [0, 20, 40, 60, 80].map((minutes, i) => ({ minutes, data: `e${i}` }))
    const placements = placeEvents(items, window, 1000, 24)
    expect(placements).toHaveLength(1)
    expect(placements[0].kind).toBe('cluster')
    if (placements[0].kind === 'cluster') expect(placements[0].events).toHaveLength(5)
  })

  it('returns an empty array for a zero-width window or zero pixel width', () => {
    expect(placeEvents([{ minutes: 5, data: 'a' }], { start: 10, end: 10 }, 1000)).toEqual([])
    expect(placeEvents([{ minutes: 5, data: 'a' }], window, 0)).toEqual([])
  })

  it('MAX_ZOOM_LEVEL is a sane positive bound', () => {
    expect(MAX_ZOOM_LEVEL).toBeGreaterThan(0)
  })
})
