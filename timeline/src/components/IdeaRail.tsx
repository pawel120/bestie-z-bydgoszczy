import { formatTime } from '../lib/transcript'
import type { BoardData } from '../lib/board'

interface Props {
  data: BoardData
  time: number
  selectedId: string | null
  onSelect: (id: string) => void
}

/** 1 makieta, 2–4 makiety, 5+ makiet — bez tego licznik czyta się jak automat. */
function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (count === 1) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function IdeaRail({ data, time, selectedId, onSelect }: Props) {
  const groups = data.nodes
    .map((node) => ({
      node,
      ideas: data.ideas.filter((idea) => node.ideas.includes(idea.id) && idea.t <= time),
    }))
    .filter((group) => group.ideas.length > 0)
    .reverse()

  const total = groups.reduce((sum, group) => sum + group.ideas.length, 0)
  const mocks = groups.filter((group) => group.node.type === 'mock').length

  return (
    <aside className="rail">
      <div className="rail-head">
        <h2>Wyodrębnione idee</h2>
        <span>
          {total} {plural(total, 'myśl', 'myśli', 'myśli')} → {mocks}{' '}
          {plural(mocks, 'makieta', 'makiety', 'makiet')}
        </span>
      </div>

      <div className="rail-list">
        {groups.length === 0 && (
          <p className="rail-empty">
            Naciśnij odtwarzanie. Idee wychwycone z rozmowy będą się tu zbierać i grupować w makiety.
          </p>
        )}
        {groups.map(({ node, ideas }) => (
          <section
            key={node.id}
            className={`rail-group ${selectedId === node.id ? 'is-selected' : ''} ${
              node.type === 'beat' ? `is-beat is-${node.kind}` : ''
            }`}
          >
            <button className="rail-group-head" onClick={() => onSelect(node.id)}>
              {node.version && <span className="rail-version">{node.version}</span>}
              <span className="rail-title">{node.title}</span>
              <span className="rail-count">{ideas.length}</span>
            </button>
            <ul>
              {ideas.map((idea) => (
                <li key={idea.id}>
                  <span className="rail-time">{formatTime(idea.t)}</span>
                  <span>{idea.label}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}
