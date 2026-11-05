import { useEffect, useMemo, useRef, useState } from 'react'
import rawTranscript from '../data/transcript.txt?raw'
import mindmap from './data/mindmap.json'
import { InsightPanel } from './components/InsightPanel'
import { MindMap } from './components/MindMap'
import { Timeline } from './components/Timeline'
import { TranscriptTicker } from './components/TranscriptTicker'
import { layout } from './lib/layout'
import { parseTranscript } from './lib/transcript'
import type { MindMapData } from './lib/types'

const data = mindmap as MindMapData

export default function App() {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(12)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const placed = useMemo(() => layout(data), [])
  const lines = useMemo(() => parseTranscript(rawTranscript), [])

  const lastFrame = useRef<number>(0)
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
        setPlaying((p) => !p)
      }
      if (event.code === 'ArrowRight') setTime((t) => Math.min(data.meta.durationSec, t + 15))
      if (event.code === 'ArrowLeft') setTime((t) => Math.max(0, t - 15))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const seek = (t: number) => {
    setTime(t)
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo" />
          <div>
            <h1>Thoughtline</h1>
            <p>{data.meta.title}</p>
          </div>
        </div>
        <div className="source">
          <span>{data.meta.source}</span>
          <span className="muted">
            {data.nodes.length} węzłów · {data.links.length} powiązań wyciągniętych z transkryptu
          </span>
        </div>
      </header>

      <main>
        <MindMap
          data={data}
          placed={placed}
          time={time}
          playing={playing}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <aside>
          <InsightPanel
            data={data}
            placed={placed}
            time={time}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSeek={seek}
          />
          <TranscriptTicker lines={lines} time={time} />
        </aside>
      </main>

      <Timeline
        data={data}
        time={time}
        playing={playing}
        speed={speed}
        onSeek={seek}
        onTogglePlay={() => setPlaying((p) => !p)}
        onSpeed={setSpeed}
      />
    </div>
  )
}
