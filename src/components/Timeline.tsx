import { useRef } from 'react'
import { formatTime } from '../lib/transcript'
import type { MindMapData } from '../lib/types'

interface Props {
  data: MindMapData
  time: number
  playing: boolean
  speed: number
  onSeek: (t: number) => void
  onTogglePlay: () => void
  onSpeed: (speed: number) => void
}

const SPEEDS = [1, 4, 12, 30]

export function Timeline({ data, time, playing, speed, onSeek, onTogglePlay, onSpeed }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const duration = data.meta.durationSec
  const dragging = useRef(false)

  const seekFromEvent = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration)))
  }

  const themes = data.nodes.filter((n) => n.parent === null)

  return (
    <div className="timeline">
      <div className="transport">
        <button className="play" onClick={onTogglePlay}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="clock">
          {formatTime(time)} <span className="muted">/ {formatTime(duration)}</span>
        </span>
        <div className="speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'on' : ''} onClick={() => onSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => onSeek(0)}>
          ⟲ od początku
        </button>
      </div>

      <div
        className="track"
        ref={trackRef}
        onPointerDown={(e) => {
          dragging.current = true
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          seekFromEvent(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && seekFromEvent(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
      >
        <div className="track-fill" style={{ width: `${(time / duration) * 100}%` }} />
        {themes.map((theme, index) => (
          <div key={theme.id} className="theme-mark" style={{ left: `${(theme.t / duration) * 100}%` }}>
            <span className="theme-label" style={{ top: index % 2 ? -36 : -19 }}>
              {theme.label}
            </span>
          </div>
        ))}
        {data.nodes.map((node) => (
          <div
            key={node.id}
            className={`tick tick-${node.kind} ${node.t <= time ? 'past' : ''}`}
            style={{
              left: `${(node.t / duration) * 100}%`,
              background: data.kinds[node.kind].color,
              height: `${8 + node.impact * 6}px`,
            }}
            title={`${formatTime(node.t)} — ${node.label}`}
          />
        ))}
        <div className="playhead" style={{ left: `${(time / duration) * 100}%` }} />
      </div>
    </div>
  )
}
