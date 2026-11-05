import { useRef } from 'react'
import type { BoardData } from '../lib/board'
import { formatTime } from '../lib/transcript'
import type { TranscriptLine } from '../lib/types'

interface Props {
  data: BoardData
  lines: TranscriptLine[]
  time: number
  playing: boolean
  speed: number
  onSeek: (t: number) => void
  onTogglePlay: () => void
  onSpeed: (speed: number) => void
  onSelect: (id: string) => void
}

const SPEEDS = [1, 8, 20, 45]

export function Scrubber({
  data,
  lines,
  time,
  playing,
  speed,
  onSeek,
  onTogglePlay,
  onSpeed,
  onSelect,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const duration = data.meta.durationSec

  const seek = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(clamp(((clientX - rect.left) / rect.width) * duration, 0, duration))
  }

  const current = [...lines].reverse().find((line) => line.t <= time)

  return (
    <footer className="scrubber">
      <div className="scrubber-now">
        <span className={`rec ${playing ? 'is-live' : ''}`} />
        <p>{current ? current.text : 'Przewiń oś czasu albo naciśnij odtwarzanie.'}</p>
      </div>

      <div className="scrubber-row">
        <button className="play" onClick={onTogglePlay}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="clock">
          {formatTime(time)}
          <span> / {formatTime(duration)}</span>
        </span>

        <div
          className="track"
          ref={trackRef}
          onPointerDown={(e) => {
            dragging.current = true
            ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
            seek(e.clientX)
          }}
          onPointerMove={(e) => dragging.current && seek(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
        >
          <div className="track-fill" style={{ width: `${(time / duration) * 100}%` }} />
          {data.ideas.map((idea) => (
            <span
              key={idea.id}
              className={`tick ${idea.t <= time ? 'is-past' : ''}`}
              style={{ left: `${(idea.t / duration) * 100}%` }}
              title={`${formatTime(idea.t)} — ${idea.label}`}
            />
          ))}
          {data.nodes.map((node) => (
            <button
              key={node.id}
              className={`marker ${node.type === 'mock' ? 'is-mock' : `is-${node.kind}`} ${
                node.t <= time ? 'is-past' : ''
              }`}
              style={{ left: `${(node.t / duration) * 100}%` }}
              title={`${formatTime(node.t)} — ${node.title}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                onSeek(Math.max(0, node.t + 1))
                onSelect(node.id)
              }}
            >
              {node.version ?? ''}
            </button>
          ))}
          <div className="playhead" style={{ left: `${(time / duration) * 100}%` }} />
        </div>

        <div className="speeds">
          {SPEEDS.map((value) => (
            <button key={value} className={value === speed ? 'is-on' : ''} onClick={() => onSpeed(value)}>
              {value}×
            </button>
          ))}
        </div>
      </div>
    </footer>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
