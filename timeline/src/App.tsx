import { useEffect, useMemo, useRef, useState } from 'react'
import rawTranscript from '../data/transcript.txt?raw'
import board from './data/board.json'
import { Canvas } from './components/Canvas'
import { IdeaRail } from './components/IdeaRail'
import { MockModal } from './components/MockModal'
import { Scrubber } from './components/Scrubber'
import { TourOverlay } from './components/TourOverlay'
import type { BoardData } from './lib/board'
import { parseTranscript } from './lib/transcript'
import { RUSH_SEC, TOUR, TOUR_SECONDS } from './lib/tour'

const data = board as BoardData

interface TourState {
  index: number
  phase: 'rush' | 'hold'
  /** Czas na osi, od którego zaczęło się przewijanie do bieżącego przystanku. */
  from: number
  elapsed: number
}

function readUrl() {
  const params = new URLSearchParams(window.location.search)
  const t = Number(params.get('t'))
  const node = params.get('node')
  return {
    time: Number.isFinite(t) ? Math.min(Math.max(t, 0), data.meta.durationSec) : 0,
    node: node && data.nodes.some((n) => n.id === node) ? node : null,
    tour: params.get('tour') === '1',
  }
}

const initial = readUrl()

export default function App() {
  const [time, setTime] = useState(initial.time)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(20)
  const [selectedId, setSelectedId] = useState<string | null>(initial.node)
  const [openId, setOpenId] = useState<string | null>(null)
  const [tour, setTour] = useState<TourState | null>(null)

  const lines = useMemo(() => parseTranscript(rawTranscript), [])
  const openNode = data.nodes.find((node) => node.id === openId) ?? null
  const tourStep = tour ? TOUR[tour.index] : null

  const startTour = () => {
    setPlaying(false)
    setOpenId(null)
    setTime(0)
    setTour({ index: 0, phase: 'rush', from: 0, elapsed: 0 })
  }

  const stopTour = () => setTour(null)

  // Zwykłe odtwarzanie.
  const lastFrame = useRef(0)
  useEffect(() => {
    if (!playing || tour) return
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
  }, [playing, speed, tour])

  // Prezentacja: przewiń oś do przystanku, przystań, jedź dalej.
  useEffect(() => {
    if (!tour) return
    const step = TOUR[tour.index]
    const node = data.nodes.find((n) => n.id === step.nodeId)!
    const target = Math.min(node.t + 2, data.meta.durationSec)
    setSelectedId(node.id)

    let previous = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const delta = (now - previous) / 1000
      previous = now
      setTour((current) => {
        if (!current) return current
        const elapsed = current.elapsed + delta
        if (current.phase === 'rush') {
          const progress = Math.min(elapsed / RUSH_SEC, 1)
          setTime(current.from + (target - current.from) * progress)
          if (progress < 1) return { ...current, elapsed }
          return { ...current, phase: 'hold', elapsed: 0 }
        }
        if (elapsed < step.hold) return { ...current, elapsed }
        if (current.index + 1 >= TOUR.length) return null
        return { index: current.index + 1, phase: 'rush', from: target, elapsed: 0 }
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [tour?.index])

  // Pozycja w adresie, żeby dało się wysłać link w konkretny moment.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const params = new URLSearchParams()
      params.set('t', String(Math.round(time)))
      if (selectedId) params.set('node', selectedId)
      window.history.replaceState(null, '', `?${params.toString()}`)
    }, 400)
    return () => window.clearTimeout(id)
  }, [time, selectedId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return stopTour()
      if (event.key === 'p' || event.key === 'P') return startTour()
      if (tour) return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying((value) => !value)
      }
      if (event.code === 'ArrowRight') setTime((t) => Math.min(data.meta.durationSec, t + 20))
      if (event.code === 'ArrowLeft') setTime((t) => Math.max(0, t - 20))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour])

  useEffect(() => {
    if (initial.tour) startTour()
  }, [])

  const mockCount = data.nodes.filter((node) => node.type === 'mock' && node.t <= time).length

  return (
    <div className={`app ${tour ? 'is-tour' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand">
          <span className="mark" />
          <div>
            <strong>Timeline</strong>
            <span>{data.meta.title}</span>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="pill">{data.meta.source}</span>
          <span className="pill is-strong">
            {mockCount} {mockCount === 1 ? 'makieta' : mockCount > 1 && mockCount < 5 ? 'makiety' : 'makiet'} na
            kanwie
          </span>
          <button className="present" onClick={tour ? stopTour : startTour}>
            {tour ? 'Zakończ pokaz' : `▶ Prezentacja · ${TOUR_SECONDS} s`}
          </button>
        </div>
      </header>

      <main>
        <IdeaRail data={data} time={time} selectedId={selectedId} onSelect={setSelectedId} />
        <Canvas
          data={data}
          time={time}
          selectedId={selectedId}
          focusId={tourStep?.nodeId ?? null}
          onSelect={setSelectedId}
          onOpen={setOpenId}
        />
        {tour && tourStep && (
          <TourOverlay index={tour.index} caption={tourStep.caption} onExit={stopTour} />
        )}
      </main>

      <Scrubber
        data={data}
        lines={lines}
        time={time}
        playing={playing}
        speed={speed}
        onSeek={(value) => {
          stopTour()
          setTime(value)
        }}
        onTogglePlay={() => {
          stopTour()
          setPlaying((value) => !value)
        }}
        onSpeed={setSpeed}
        onSelect={setSelectedId}
      />

      {openNode && <MockModal data={data} node={openNode} onClose={() => setOpenId(null)} />}
    </div>
  )
}
