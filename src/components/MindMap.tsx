import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { chordPath, edgePath, ROOT_ID } from '../lib/layout'
import type { MindMapData, PlacedNode, RawLink } from '../lib/types'

const REVEAL_SEC = 0.9
const FRESH_SEC = 6

interface Props {
  data: MindMapData
  placed: Map<string, PlacedNode>
  time: number
  playing: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Nodes grow in while playing; when paused or scrubbing they are simply there. */
function revealOf(age: number, playing: boolean): number {
  return playing ? clamp((age + 0.3) / REVEAL_SEC, 0, 1) : 1
}

export function MindMap({ data, placed, time, playing, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 650 })
  const [camera, setCamera] = useState({ cx: 0, cy: 0, scale: 0.75 })
  const [mode, setMode] = useState<'follow' | 'overview' | 'manual'>('follow')
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  useLayoutEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const nodes = [...placed.values()]
  const visible = nodes.filter((n) => n.id === ROOT_ID || n.t <= time)
  const newest = visible.reduce<PlacedNode | null>(
    (best, n) => (n.id !== ROOT_ID && (!best || n.t > best.t) ? n : best),
    null,
  )

  const extent = nodes.reduce((max, n) => Math.max(max, Math.hypot(n.x, n.y) + n.width / 2), 400)
  const fitScale = Math.min(size.w / (extent * 2 + 80), size.h / (extent * 2 + 80))

  // In follow mode the camera eases toward whatever was just said; overview
  // pulls back to the whole map. Panning or zooming by hand drops both.
  useEffect(() => {
    if (mode === 'manual') return
    const target =
      mode === 'overview'
        ? { cx: 0, cy: 0, scale: fitScale }
        : { cx: newest?.x ?? 0, cy: newest?.y ?? 0, scale: 0.75 }
    let frame = 0
    const step = () => {
      setCamera((cam) => ({
        cx: cam.cx + (target.cx - cam.cx) * 0.07,
        cy: cam.cy + (target.cy - cam.cy) * 0.07,
        scale: cam.scale + (target.scale - cam.scale) * 0.07,
      }))
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [mode, fitScale, newest?.id])

  const vw = size.w / camera.scale
  const vh = size.h / camera.scale
  const viewBox = `${camera.cx - vw / 2} ${camera.cy - vh / 2} ${vw} ${vh}`

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    setMode('manual')
    setCamera((cam) => ({ ...cam, scale: clamp(cam.scale * Math.exp(-event.deltaY * 0.0014), 0.08, 2.4) }))
  }

  const onPointerDown = (event: React.PointerEvent) => {
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return
    setMode('manual')
    setCamera((cam) => ({
      ...cam,
      cx: drag.cx - (event.clientX - drag.x) / cam.scale,
      cy: drag.cy - (event.clientY - drag.y) / cam.scale,
    }))
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const related = new Set<string>()
  if (selectedId) {
    const node = placed.get(selectedId)
    if (node) {
      related.add(node.id)
      node.childIds.forEach((id) => related.add(id))
      if (node.parent) related.add(node.parent)
      for (const link of data.links) {
        if (link.source === selectedId) related.add(link.target)
        if (link.target === selectedId) related.add(link.source)
      }
    }
  }

  const linkVisible = (link: RawLink) => {
    const a = placed.get(link.source)
    const b = placed.get(link.target)
    return a && b && a.t <= time && b.t <= time ? { a, b } : null
  }

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg
        viewBox={viewBox}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null)
        }}
      >
        <defs>
          <radialGradient id="core-glow">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
          <filter id="soft-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={0} cy={0} r={420} fill="url(#core-glow)" pointerEvents="none" />

        <g className="edges">
          {visible.map((node) => {
            const parent = placed.get(node.parent ?? ROOT_ID)
            if (!parent || node.id === ROOT_ID) return null
            const progress = revealOf(time - node.t, playing)
            const dim = selectedId && !(related.has(node.id) && related.has(parent.id))
            return (
              <path
                key={`e-${node.id}`}
                d={edgePath(parent, node)}
                className="edge"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - progress}
                stroke={data.kinds[node.kind].color}
                opacity={dim ? 0.08 : 0.3 + node.impact * 0.08}
              />
            )
          })}
        </g>

        <g className="chords">
          {data.links.map((link) => {
            const pair = linkVisible(link)
            if (!pair) return null
            const active = selectedId === link.source || selectedId === link.target
            return (
              <path
                key={`${link.source}-${link.target}`}
                d={chordPath(pair.a, pair.b)}
                className={`chord ${active ? 'chord-active' : ''}`}
                opacity={selectedId ? (active ? 0.95 : 0.04) : 0.22}
              />
            )
          })}
        </g>

        <g className="nodes">
          <g className="node node-root">
            <circle r={54} className="root-circle" />
            <text className="root-label" textAnchor="middle" y={-4}>
              Hackathon
            </text>
            <text className="root-label" textAnchor="middle" y={12}>
              brainstorm
            </text>
          </g>

          {visible.map((node) => {
            if (node.id === ROOT_ID) return null
            const age = time - node.t
            const reveal = revealOf(age, playing)
            const fresh = age >= 0 && age < FRESH_SEC
            const dim = selectedId ? !related.has(node.id) : false
            const color = data.kinds[node.kind].color
            const scale = 0.65 + 0.35 * reveal
            return (
              <g
                key={node.id}
                className={`node node-${node.kind} ${fresh ? 'fresh' : ''} ${
                  selectedId === node.id ? 'selected' : ''
                } ${dim ? 'dim' : ''}`}
                transform={`translate(${node.x} ${node.y}) scale(${scale})`}
                opacity={reveal}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(node.id === selectedId ? null : node.id)
                }}
              >
                {fresh && (
                  <rect
                    x={-node.width / 2 - 6}
                    y={-node.height / 2 - 6}
                    width={node.width + 12}
                    height={node.height + 12}
                    rx={14}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.75 * (1 - age / FRESH_SEC)}
                    filter="url(#soft-glow)"
                  />
                )}
                <rect
                  x={-node.width / 2}
                  y={-node.height / 2}
                  width={node.width}
                  height={node.height}
                  rx={10}
                  className="node-box"
                  stroke={color}
                  strokeWidth={node.kind === 'theme' ? 2 : 1.2}
                />
                <rect
                  x={-node.width / 2}
                  y={-node.height / 2}
                  width={4}
                  height={node.height}
                  rx={2}
                  fill={color}
                />
                {node.lines.map((line, index) => (
                  <text
                    key={index}
                    className="node-label"
                    textAnchor="middle"
                    y={-node.height / 2 + 18 + index * 15}
                  >
                    {line}
                  </text>
                ))}
              </g>
            )
          })}
        </g>
      </svg>

      <div className="map-controls">
        <button
          onClick={() => {
            setMode('manual')
            setCamera((c) => ({ ...c, scale: clamp(c.scale * 1.25, 0.08, 2.4) }))
          }}
        >
          +
        </button>
        <button
          onClick={() => {
            setMode('manual')
            setCamera((c) => ({ ...c, scale: clamp(c.scale / 1.25, 0.08, 2.4) }))
          }}
        >
          −
        </button>
        <button
          className={mode === 'follow' ? 'on' : ''}
          onClick={() => setMode('follow')}
          title="Kamera podąża za rozmową"
        >
          ⌖ śledź
        </button>
        <button
          className={mode === 'overview' ? 'on' : ''}
          onClick={() => setMode('overview')}
          title="Pokaż całą mapę"
        >
          ▦ całość
        </button>
      </div>
    </div>
  )
}
