import { useEffect } from 'react'
import type { BoardData, BoardNode } from '../lib/board'
import { formatTime } from '../lib/transcript'
import { MOCKS } from './mocks'

interface Props {
  data: BoardData
  node: BoardNode
  onClose: () => void
}

export function MockModal({ data, node, onClose }: Props) {
  const Mock = node.component ? MOCKS[node.component] : null
  const ideas = data.ideas.filter((idea) => node.ideas.includes(idea.id))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <span className="node-version">{node.version}</span>
            <h2>{node.title}</h2>
            <p>{node.subtitle}</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            Zamknij
          </button>
        </header>
        <div className="modal-body">
          <div className="modal-frame">{Mock && <Mock />}</div>
          <div className="modal-side">
            <h3>Z czego powstała ta makieta</h3>
            <ul>
              {ideas.map((idea) => (
                <li key={idea.id}>
                  <span className="rail-time">{formatTime(idea.t)}</span>
                  <div>
                    <strong>{idea.label}</strong>
                    <q>{idea.quote}</q>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
