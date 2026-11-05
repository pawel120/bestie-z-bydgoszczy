export type Kind =
  | 'theme'
  | 'idea'
  | 'insight'
  | 'critique'
  | 'decision'
  | 'constraint'
  | 'joke'

export interface RawNode {
  id: string
  parent: string | null
  kind: Kind
  t: number
  label: string
  speaker: string
  quote: string
  impact: number
}

export interface RawLink {
  source: string
  target: string
  kind: 'echo' | 'resolves'
  note: string
}

export interface MindMapData {
  meta: {
    title: string
    source: string
    durationSec: number
    model: string
    root: string
  }
  kinds: Record<Kind, { label: string; color: string }>
  nodes: RawNode[]
  links: RawLink[]
}

export interface PlacedNode extends RawNode {
  x: number
  y: number
  depth: number
  angle: number
  lines: string[]
  width: number
  height: number
  childIds: string[]
}

export interface TranscriptLine {
  t: number
  speaker: string
  text: string
}
