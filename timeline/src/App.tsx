import { useEffect, useMemo, useRef, useState } from 'react'
import rawTranscript from '../data/transcript.txt?raw'
import board from './data/board.json'
import { Canvas } from './components/Canvas'
import { IdeaRail } from './components/IdeaRail'
import { MockModal } from './components/MockModal'
import { Scrubber } from './components/Scrubber'
import type { BoardData } from './lib/board'
import { parseTranscript } from './lib/transcript'

const data = board as BoardData

export default function App() {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(20)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const lines = useMemo(() => parseTranscript(rawTranscript), [])
  const openNode = data.nodes.find((node) => node.id === openId) ?? null

  const lastFrame = useRef(0)
  useEffect(() => {
    if (!playing) return
    lastFrame.current = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const delta = (now - lastFrame.current) / 1000
      lastFrame.current = now
      setTime((current) => {
        const next = current + delta * speed
        if (next >= data.meta.durationSec) {
          setPlaying(false)
          return data.meta.durationSec
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying((value) => !value)
      }
      if (event.code === 'ArrowRight') setTime((t) => Math.min(data.meta.durationSec, t + 20))
      if (event.code === 'ArrowLeft') setTime((t) => Math.max(0, t - 20))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const mockCount = data.nodes.filter((node) => node.type === 'mock' && node.t <= time).length

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="mark" />
          <div>
            <strong>Thoughtline</strong>
            <span>{data.meta.title}</span>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="pill">{data.meta.source}</span>
          <span className="pill is-strong">
            {mockCount} {mockCount === 1 ? 'makieta' : mockCount > 1 && mockCount < 5 ? 'makiety' : 'makiet'} na
            kanwie
          </span>
        </div>
      </header>

      <main>
        <IdeaRail data={data} time={time} selectedId={selectedId} onSelect={setSelectedId} />
        <Canvas
          data={data}
          time={time}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={setOpenId}
        />
      </main>

      <Scrubber
        data={data}
        lines={lines}
        time={time}
        playing={playing}
        speed={speed}
        onSeek={setTime}
        onTogglePlay={() => setPlaying((value) => !value)}
        onSpeed={setSpeed}
        onSelect={setSelectedId}
      />

      {openNode && <MockModal data={data} node={openNode} onClose={() => setOpenId(null)} />}
    </div>
  )
}
