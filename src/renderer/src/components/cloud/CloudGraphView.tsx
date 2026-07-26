import { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum
} from 'd3-force'
import type { CloudGraphData, CloudGraphNode } from '../../../../common/cloudTypes'

interface SimNode extends CloudGraphNode, SimulationNodeDatum {}

// Cloud counterpart of GraphView.tsx — identical force-layout approach.
// One structural difference: CloudGraphNode has no separate `path` field
// to distinguish a real note from a phantom (redlink) node, so
// `noteType === null` is the click-ability check instead — both
// buildGraph implementations set noteType to null only for synthesized
// phantom nodes (see project-vault-cloud's src/lib/graph.ts).
const WORLD_WIDTH = 2000
const WORLD_HEIGHT = 1400
const TICKS = 300

const TYPE_COLORS: Record<string, string> = {
  pc: '#5fb3f0',
  npc: '#e08a3c',
  location: '#4caf6e',
  faction: '#d9534f',
  item: '#c58af0',
  event: '#e0c93c',
  language: '#3cc2e0',
  'family-tree': '#f06fa0',
  session: '#8a8af0',
  'class-reference': '#b0b0b0',
  note: '#7c8cff'
}
const PHANTOM_COLOR = '#555'
const FALLBACK_COLOR = '#888'

function colorFor(noteType: string | null): string {
  if (noteType === null) return PHANTOM_COLOR
  return TYPE_COLORS[noteType] ?? FALLBACK_COLOR
}

function radiusFor(degree: number): number {
  return Math.min(5 + degree * 1.4, 34)
}

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}
const MIN_VIEW_W = 150
const MAX_VIEW_W = WORLD_WIDTH * 3

export function CloudGraphView({ onOpenNode }: { onOpenNode: (id: string) => void }): React.JSX.Element {
  const [graph, setGraph] = useState<CloudGraphData | null>(null)
  const [nodes, setNodes] = useState<SimNode[] | null>(null)
  const [viewBox, setViewBox] = useState<ViewBox>({ x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT })
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => setGraph(await window.cloudApi.getGraph())
    void load()
    const off = window.cloudApi.onTreeUpdated(() => void load())
    return () => off()
  }, [])

  const degreeById = useMemo(() => {
    const degrees = new Map<string, number>()
    if (!graph) return degrees
    for (const edge of graph.edges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
    }
    return degrees
  }, [graph])

  useEffect(() => {
    if (!graph) return
    const simNodes: SimNode[] = graph.nodes.map((n) => ({ ...n }))
    const simLinks = graph.edges.map((e) => ({ source: e.source, target: e.target }))

    const simulation = forceSimulation(simNodes)
      .force(
        'link',
        forceLink(simLinks)
          .id((d) => (d as SimNode).id)
          .distance(70)
          .strength(0.35)
      )
      .force('charge', forceManyBody().strength(-160).distanceMax(300))
      .force('center', forceCenter(WORLD_WIDTH / 2, WORLD_HEIGHT / 2))
      .force('x', forceX(WORLD_WIDTH / 2).strength(0.03))
      .force('y', forceY(WORLD_HEIGHT / 2).strength(0.03))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => radiusFor(degreeById.get(d.id) ?? 0) + 6)
      )
      .stop()

    for (let i = 0; i < TICKS; i++) simulation.tick()
    setNodes(simNodes)
    setViewBox({ x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT })
  }, [graph, degreeById])

  const nodesById = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes])

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    e.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    setViewBox((vb) => {
      const scaleFactor = e.deltaY < 0 ? 0.9 : 1.1
      const newW = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, vb.w * scaleFactor))
      const newH = vb.h * (newW / vb.w)
      const px = vb.x + (mx / rect.width) * vb.w
      const py = vb.y + (my / rect.height) * vb.h
      return { x: px - (mx / rect.width) * newW, y: py - (my / rect.height) * newH, w: newW, h: newH }
    })
  }

  const handleBackgroundMouseDown = (e: React.MouseEvent<SVGSVGElement>): void => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: viewBox.x, origY: viewBox.y }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      const rect = svgRef.current?.getBoundingClientRect()
      if (!drag || !rect) return
      const dxUser = ((e.clientX - drag.startX) / rect.width) * viewBox.w
      const dyUser = ((e.clientY - drag.startY) / rect.height) * viewBox.h
      setViewBox((vb) => ({ ...vb, x: drag.origX - dxUser, y: drag.origY - dyUser }))
    }
    const handleMouseUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [viewBox.w, viewBox.h])

  if (graph === null || nodes === null) {
    return <div className="timeline-view timeline-empty">Loading…</div>
  }

  if (nodes.length === 0) {
    return <div className="timeline-view timeline-empty">No notes yet — the graph fills in as you create them.</div>
  }

  const typesPresent = [...new Set(graph.nodes.map((n) => n.noteType))].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a.localeCompare(b)
  )

  return (
    <div className="graph-view">
      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onWheel={handleWheel}
        onMouseDown={handleBackgroundMouseDown}
      >
        <g>
          {graph.edges.map((edge, i) => {
            const source = nodesById.get(edge.source)
            const target = nodesById.get(edge.target)
            if (!source || !target || source.x == null || target.x == null) return null
            return (
              <line
                key={i}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="var(--text-muted)"
                strokeOpacity={0.5}
                strokeWidth={1}
              />
            )
          })}
        </g>
        <g>
          {nodes.map((node) => {
            if (node.x == null || node.y == null) return null
            const r = radiusFor(degreeById.get(node.id) ?? 0)
            const isReal = node.noteType !== null
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className={isReal ? 'graph-node' : 'graph-node graph-node-phantom'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => isReal && onOpenNode(node.id)}
              >
                <circle r={r} fill={colorFor(node.noteType)} stroke={isReal ? 'none' : '#888'} strokeDasharray={isReal ? undefined : '3,2'} />
                <text y={r + 12} textAnchor="middle">
                  {node.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="graph-legend">
        {typesPresent.map((type) => (
          <div key={type ?? 'phantom'} className="graph-legend-item">
            <span className="graph-legend-swatch" style={{ background: colorFor(type) }} />
            {type ?? 'not yet created'}
          </div>
        ))}
      </div>
    </div>
  )
}
