import type { MindMapData, PlacedNode, RawNode } from './types'

export const ROOT_ID = '__root__'

const CHAR_WIDTH = 6.3
const MAX_LINE_CHARS = 24
const LINE_HEIGHT = 15
/** Arc length every leaf gets on the outermost ring; drives the whole canvas size. */
const ARC_PER_LEAF = 185
const MIN_RING = 330

function wrap(label: string, maxChars: number): string[] {
  const words = label.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

function depthOf(id: string, children: Map<string, RawNode[]>): number {
  const kids = children.get(id) ?? []
  return kids.length === 0 ? 0 : 1 + Math.max(...kids.map((kid) => depthOf(kid.id, children)))
}

/**
 * Radial tree where every branch keeps an angular slice proportional to the
 * number of leaves below it, and siblings are ordered by the moment they were
 * said. The map therefore unrolls clockwise as the meeting progresses.
 */
export function layout(data: MindMapData): Map<string, PlacedNode> {
  const root: RawNode = {
    id: ROOT_ID,
    parent: null,
    kind: 'theme',
    t: -1,
    label: data.meta.root,
    speaker: '—',
    quote: data.meta.source,
    impact: 3,
  }

  const all = [root, ...data.nodes]
  const children = new Map<string, RawNode[]>()
  for (const node of all) children.set(node.id, [])
  for (const node of data.nodes) {
    const parentId = node.parent ?? ROOT_ID
    children.get(parentId)?.push(node)
  }
  for (const list of children.values()) list.sort((a, b) => a.t - b.t)

  const leafCount = new Map<string, number>()
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? []
    const count = kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + countLeaves(kid.id), 0)
    leafCount.set(id, count)
    return count
  }
  countLeaves(ROOT_ID)

  // Size the rings so the outermost leaves never collide, then space the inner
  // rings evenly inside that radius.
  const totalLeaves = leafCount.get(ROOT_ID) ?? 1
  const maxDepth = Math.max(1, depthOf(ROOT_ID, children))
  const outerRadius = Math.max(MIN_RING * maxDepth, (ARC_PER_LEAF * totalLeaves) / (2 * Math.PI))
  const radiusFor = (depth: number) => (outerRadius * depth) / maxDepth

  const placed = new Map<string, PlacedNode>()

  const place = (node: RawNode, depth: number, a0: number, a1: number, stagger = 0) => {
    const angle = (a0 + a1) / 2
    const radius = radiusFor(depth) + stagger
    const lines = wrap(node.label, depth === 0 ? 18 : MAX_LINE_CHARS)
    const longest = Math.max(...lines.map((l) => l.length))
    placed.set(node.id, {
      ...node,
      depth,
      angle,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      lines,
      width: Math.max(96, longest * CHAR_WIDTH + 26),
      height: lines.length * LINE_HEIGHT + 16,
      childIds: (children.get(node.id) ?? []).map((c) => c.id),
    })

    const kids = children.get(node.id) ?? []
    if (kids.length === 0) return
    const total = kids.reduce((sum, kid) => sum + (leafCount.get(kid.id) ?? 1), 0)
    // Shrink deep slices slightly so sub-branches fan out instead of overlapping.
    const padding = depth === 0 ? 0 : (a1 - a0) * 0.06
    let cursor = a0 + padding / 2
    const usable = a1 - a0 - padding
    // Siblings zig-zag between two rings so their boxes can overlap in angle
    // without overlapping on screen.
    const ringGap = radiusFor(depth + 1) - radiusFor(depth)
    const offset = kids.length > 2 ? Math.min(70, ringGap * 0.18) : 0
    kids.forEach((kid, index) => {
      const share = ((leafCount.get(kid.id) ?? 1) / total) * usable
      place(kid, depth + 1, cursor, cursor + share, index % 2 ? offset : -offset)
      cursor += share
    })
  }

  // Start at -90° so the first theme sits at the top of the canvas.
  place(root, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2)
  return placed
}

export function edgePath(from: PlacedNode, to: PlacedNode): string {
  const midRadius = (Math.hypot(from.x, from.y) + Math.hypot(to.x, to.y)) / 2
  const c1x = Math.cos(from.angle) * midRadius
  const c1y = Math.sin(from.angle) * midRadius
  const c2x = Math.cos(to.angle) * midRadius
  const c2y = Math.sin(to.angle) * midRadius
  return `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`
}

export function chordPath(from: PlacedNode, to: PlacedNode): string {
  const pull = 0.35
  return `M ${from.x} ${from.y} Q ${(from.x + to.x) * pull} ${(from.y + to.y) * pull}, ${to.x} ${to.y}`
}
