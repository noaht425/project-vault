import { useMemo } from 'react'
import { computeFamilyTreeLayout, parseRelationships } from '../../../../common/noteTypes/familyTree'

const COL_WIDTH = 170
const ROW_HEIGHT = 120
const NODE_WIDTH = 150
const NODE_HEIGHT = 46
const PADDING = 30

export function FamilyTreeDiagram({
  body,
  onOpenWikiLink
}: {
  body: string
  onOpenWikiLink: (title: string) => Promise<void>
}): React.JSX.Element {
  const layout = useMemo(() => computeFamilyTreeLayout(parseRelationships(body)), [body])

  if (layout.nodes.length === 0) {
    return (
      <div className="family-tree-empty">
        No relationships yet — add a "## Relationships" heading below and list people with
        [[wiki-links]], e.g. "- [[Parent]] parent of [[Child]]".
      </div>
    )
  }

  const positionOf = new Map(
    layout.nodes.map((n) => [
      n.name,
      {
        x: n.col * COL_WIDTH + COL_WIDTH / 2 + PADDING,
        y: n.generation * ROW_HEIGHT + NODE_HEIGHT / 2 + PADDING
      }
    ])
  )
  const maxCol = Math.max(...layout.nodes.map((n) => n.col))
  const maxGeneration = Math.max(...layout.nodes.map((n) => n.generation))
  const width = (maxCol + 1) * COL_WIDTH + PADDING * 2
  const height = (maxGeneration + 1) * ROW_HEIGHT + PADDING * 2

  const parentsByChild = new Map<string, string[]>()
  for (const line of layout.lines) {
    if (line.kind !== 'parent-child') continue
    const parents = parentsByChild.get(line.to) ?? []
    parents.push(line.from)
    parentsByChild.set(line.to, parents)
  }

  return (
    <div className="family-tree-diagram">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {[...parentsByChild.entries()].map(([child, parents]) => {
          const childPos = positionOf.get(child)
          const parentPositions = parents.map((p) => positionOf.get(p)).filter((p) => p !== undefined)
          if (!childPos || parentPositions.length === 0) return null

          // Drop from the midpoint of all recorded parents, jog sideways to
          // the child's column, then drop into it — the standard elbow-style
          // connector genealogy charts use, so multiple children sharing the
          // same parents all fan out from one shared point.
          const anchorX = parentPositions.reduce((sum, p) => sum + p.x, 0) / parentPositions.length
          const anchorY = Math.max(...parentPositions.map((p) => p.y)) + NODE_HEIGHT / 2
          const childTopY = childPos.y - NODE_HEIGHT / 2
          const midY = anchorY + (childTopY - anchorY) / 2
          const path = `M ${anchorX} ${anchorY} L ${anchorX} ${midY} L ${childPos.x} ${midY} L ${childPos.x} ${childTopY}`
          return <path key={`pc-${child}`} className="family-tree-line family-tree-line-parent" d={path} />
        })}
        {layout.lines
          .filter((l) => l.kind === 'spouse')
          .map((line) => {
            const a = positionOf.get(line.from)
            const b = positionOf.get(line.to)
            if (!a || !b) return null
            const left = a.x < b.x ? a : b
            const right = a.x < b.x ? b : a
            return (
              <line
                key={`sp-${line.from}-${line.to}`}
                className="family-tree-line family-tree-line-spouse"
                x1={left.x + NODE_WIDTH / 2}
                y1={left.y}
                x2={right.x - NODE_WIDTH / 2}
                y2={right.y}
              />
            )
          })}
        {layout.lines
          .filter((l) => l.kind === 'sibling')
          .map((line) => {
            const a = positionOf.get(line.from)
            const b = positionOf.get(line.to)
            if (!a || !b) return null
            return (
              <line
                key={`sib-${line.from}-${line.to}`}
                className="family-tree-line family-tree-line-sibling"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              />
            )
          })}
        {layout.nodes.map((node) => {
          const pos = positionOf.get(node.name)!
          return (
            <g
              key={node.name}
              className="family-tree-node"
              role="link"
              tabIndex={0}
              onClick={() => void onOpenWikiLink(node.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onOpenWikiLink(node.name)
              }}
            >
              <rect
                x={pos.x - NODE_WIDTH / 2}
                y={pos.y - NODE_HEIGHT / 2}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
              />
              <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle">
                {node.name}
                <title>{node.name}</title>
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
