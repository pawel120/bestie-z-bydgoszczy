import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type BoardData,
  type BoardNode,
  edgeGeometry,
  placeOf,
  worldOf,
} from '../lib/board'
import { formatTime } from '../lib/transcript'
import { MOCKS } from './mocks'

interface Props {
  data: BoardData
  time: number
  selectedId: string | null
  /** Karta, na którą ma najechać kamera — używane przez tryb prezentacji. */
  focusId?: string | null
  onSelect: (id: string | null) => void
  onOpen: (id: string) => void
}

const BEAT_LABEL: Record<string, string> = {
  kontra: 'kontra',
  decyzja: 'decyzja',
  insight: 'insight',
  odrzucone: 'odrzucone',
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function Canvas({ data, time, selectedId, focusId, onSelect, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [view, setView] = useState({ x: 0, y: 0, z: 0.62 })
  const [follow, setFollow] = useState(true)
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const world = worldOf(data.nodes)
  const visible = data.nodes.filter((n) => n.t <= time)
  const newest = visible.reduce<BoardNode | null>((best, n) => (!best || n.t > best.t ? n : best), null)

  useLayoutEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const focused = focusId ? data.nodes.find((n) => n.id === focusId) : null

  // Prezentacja przejmuje kamerę: każdy przystanek znów ją podpina,
  // nawet jeśli w międzyczasie ktoś przeciągnął kanwę.
  useEffect(() => {
    if (focusId) setFollow(true)
  }, [focusId])

  // Kamera dojeżdża do wskazanej karty, a poza prezentacją — do tej,
  // która właśnie powstała.
  useEffect(() => {
    const anchor = focused ?? newest
    if (!follow || !anchor) return
    const spot = placeOf(anchor, world)
    const zoom = focused ? (focused.type === 'mock' ? 0.78 : 1) : null
    let frame = 0
    const step = () => {
      setView((v) => {
        const z = zoom === null ? v.z : v.z + (zoom - v.z) * 0.1
        return {
          z,
          x: v.x + (size.w / 2 - (spot.left + spot.w / 2) * z - v.x) * 0.1,
          y: v.y + (size.h / 2 - (spot.top + spot.h / 2) * z - v.y) * 0.1,
        }
      })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [follow, focused?.id, newest?.id, size.w, size.h])

  const zoomBy = (factor: number) => {
    setView((v) => {
      const z = clamp(v.z * factor, 0.18, 1.3)
      return {
        z,
        x: size.w / 2 - ((size.w / 2 - v.x) / v.z) * z,
        y: size.h / 2 - ((size.h / 2 - v.y) / v.z) * z,
      }
    })
  }

  const fit = () => {
    const z = clamp(Math.min(size.w / world.width, size.h / world.height), 0.1, 1)
    setFollow(false)
    setView({ z, x: (size.w - world.width * z) / 2, y: (size.h - world.height * z) / 2 })
  }

  return (
    <div className="canvas" ref={wrapRef}>
      <div
        className="canvas-surface"
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
          ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current
          if (!drag) return
          const dx = e.clientX - drag.x
          const dy = e.clientY - drag.y
          if (!drag.moved && Math.hypot(dx, dy) < 4) return
          drag.moved = true
          setFollow(false)
          setView((v) => ({ ...v, x: drag.vx + dx, y: drag.vy + dy }))
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current
          dragRef.current = null
          if (drag && !drag.moved && e.target === e.currentTarget) onSelect(null)
        }}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setFollow(false)
          zoomBy(Math.exp(-e.deltaY * 0.002))
        }}
      >
        <div
          className="canvas-world"
          style={{
            width: world.width,
            height: world.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          }}
        >
          <svg className="canvas-edges" width={world.width} height={world.height}>
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 1 L 7 4 L 0 7 z" fill="#b6bdc9" />
              </marker>
            </defs>
            {data.edges.map((edge) => {
              const from = data.nodes.find((n) => n.id === edge.from)!
              const to = data.nodes.find((n) => n.id === edge.to)!
              if (from.t > time || to.t > time) return null
              const geometry = edgeGeometry(from, to, world)
              const active = selectedId === from.id || selectedId === to.id
              return (
                <g key={`${edge.from}-${edge.to}`} className={`edge ${active ? 'is-active' : ''}`}>
                  <path d={geometry.d} markerEnd="url(#arrow)" />
                  <foreignObject x={geometry.mid.x - 90} y={geometry.mid.y - 16} width={180} height={32}>
                    <div className="edge-label">{edge.label}</div>
                  </foreignObject>
                </g>
              )
            })}
          </svg>

          {visible.map((node) => {
            const spot = placeOf(node, world)
            const Mock = node.component ? MOCKS[node.component] : null
            const ideas = data.ideas.filter((idea) => node.ideas.includes(idea.id))
            return (
              <div
                key={node.id}
                className={`node ${node.type === 'mock' ? 'node-mock' : `node-beat is-${node.kind}`} ${
                  selectedId === node.id ? 'is-selected' : ''
                }`}
                style={{ left: spot.left, top: spot.top, width: spot.w }}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(node.id)
                }}
                onDoubleClick={() => node.type === 'mock' && onOpen(node.id)}
              >
                {node.type === 'mock' ? (
                  <>
                    <header>
                      <div>
                        <span className="node-version">{node.version}</span>
                        <h3>{node.title}</h3>
                      </div>
                      <button
                        className="node-open"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(node.id)
                        }}
                      >
                        Otwórz
                      </button>
                    </header>
                    <div className="node-frame">{Mock && <Mock />}</div>
                    <footer>
                      <span className="node-count">scala {ideas.length} myśli z rozmowy</span>
                      <span className="node-time">{formatTime(node.t)}</span>
                    </footer>
                  </>
                ) : (
                  <>
                    <span className="beat-kind">{BEAT_LABEL[node.kind ?? 'insight']}</span>
                    <h3>{node.title}</h3>
                    <p>„{node.quote}”</p>
                    <span className="node-time">{formatTime(node.t)}</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="canvas-controls">
        <button onClick={() => zoomBy(1 / 1.25)} title="Oddal">
          −
        </button>
        <button onClick={() => zoomBy(1.25)} title="Przybliż">
          +
        </button>
        <button onClick={fit}>Cała kanwa</button>
        <button className={follow ? 'is-on' : ''} onClick={() => setFollow(true)}>
          Śledź rozmowę
        </button>
      </div>
    </div>
  )
}
