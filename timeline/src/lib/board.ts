export interface Idea {
  id: string
  t: number
  label: string
  quote: string
}

export type BeatKind = 'kontra' | 'decyzja' | 'insight' | 'odrzucone'

export interface BoardNode {
  id: string
  type: 'mock' | 'beat'
  t: number
  x: number
  y: number
  title: string
  ideas: string[]
  component?: string
  version?: string
  subtitle?: string
  kind?: BeatKind
  quote?: string
}

export interface BoardEdge {
  from: string
  to: string
  label: string
}

export interface BoardData {
  meta: { title: string; source: string; durationSec: number; generatedBy: string }
  nodes: BoardNode[]
  edges: BoardEdge[]
  ideas: Idea[]
}

export const MOCK_W = 566
export const MOCK_H = 452
export const BEAT_W = 300
export const BEAT_H = 112
export const PAD = 140

export function sizeOf(node: BoardNode): { w: number; h: number } {
  return node.type === 'mock' ? { w: MOCK_W, h: MOCK_H } : { w: BEAT_W, h: BEAT_H }
}

export interface World {
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export function worldOf(nodes: BoardNode[]): World {
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + sizeOf(n).w))
  const maxY = Math.max(...nodes.map((n) => n.y + sizeOf(n).h))
  return {
    offsetX: PAD - minX,
    offsetY: PAD - minY,
    width: maxX - minX + PAD * 2,
    height: maxY - minY + PAD * 2,
  }
}

export function placeOf(node: BoardNode, world: World) {
  const { w, h } = sizeOf(node)
  return { left: node.x + world.offsetX, top: node.y + world.offsetY, w, h }
}

/** Łuk między kartami: poziomy, chyba że karty stoją jedna nad drugą. */
export function edgeGeometry(from: BoardNode, to: BoardNode, world: World) {
  const a = placeOf(from, world)
  const b = placeOf(to, world)
  const vertical = Math.abs(a.left - b.left) < 160

  if (vertical) {
    const downward = b.top > a.top
    const start = { x: a.left + a.w / 2, y: downward ? a.top + a.h : a.top }
    const end = { x: b.left + b.w / 2, y: downward ? b.top : b.top + b.h }
    const bend = Math.max(40, Math.abs(end.y - start.y) * 0.45)
    return {
      d: `M ${start.x} ${start.y} C ${start.x} ${start.y + (downward ? bend : -bend)}, ${end.x} ${
        end.y - (downward ? bend : -bend)
      }, ${end.x} ${end.y}`,
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    }
  }

  const start = { x: a.left + a.w, y: a.top + a.h / 2 }
  const end = { x: b.left, y: b.top + b.h / 2 }
  const bend = Math.max(70, (end.x - start.x) * 0.45)
  return {
    d: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`,
    mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  }
}
