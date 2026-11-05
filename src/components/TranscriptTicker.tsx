import { useEffect, useRef } from 'react'
import { formatTime } from '../lib/transcript'
import type { TranscriptLine } from '../lib/types'

interface Props {
  lines: TranscriptLine[]
  time: number
}

export function TranscriptTicker({ lines, time }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndex = Math.max(
    0,
    lines.findIndex((line, index) => line.t <= time && (lines[index + 1]?.t ?? Infinity) > time),
  )

  useEffect(() => {
    const active = listRef.current?.querySelector('.line.active')
    active?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])

  return (
    <div className="ticker">
      <div className="panel-head">
        <span className="dot live" /> Transkrypt
      </div>
      <div className="lines" ref={listRef}>
        {lines.map((line, index) => (
          <div
            key={`${line.t}-${index}`}
            className={`line ${index === activeIndex ? 'active' : ''} ${line.t > time ? 'future' : ''}`}
          >
            <span className="stamp">{formatTime(line.t)}</span>
            <p>{line.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
