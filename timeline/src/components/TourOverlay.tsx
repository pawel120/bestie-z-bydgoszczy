import { TOUR } from '../lib/tour'

interface Props {
  index: number
  caption: string
  onExit: () => void
}

export function TourOverlay({ index, caption, onExit }: Props) {
  return (
    <div className="tour">
      <div className="tour-steps">
        {TOUR.map((step, position) => (
          <span key={step.nodeId} className={position <= index ? 'is-past' : ''} />
        ))}
      </div>
      <div className="tour-card">
        <span className="tour-count">
          {index + 1} / {TOUR.length}
        </span>
        <p>{caption}</p>
        <button onClick={onExit}>Zakończ · Esc</button>
      </div>
    </div>
  )
}
