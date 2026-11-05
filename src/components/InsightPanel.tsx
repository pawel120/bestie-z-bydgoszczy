import { formatTime } from '../lib/transcript'
import type { Kind, MindMapData, PlacedNode } from '../lib/types'

interface Props {
  data: MindMapData
  placed: Map<string, PlacedNode>
  time: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSeek: (t: number) => void
}

const COUNTED: Kind[] = ['idea', 'critique', 'decision', 'insight']

export function InsightPanel({ data, placed, time, selectedId, onSelect, onSeek }: Props) {
  const seen = data.nodes.filter((n) => n.t <= time)
  const selected = selectedId ? placed.get(selectedId) : null
  const feed = [...seen].sort((a, b) => b.t - a.t).slice(0, 5)

  const relatedLinks = selected
    ? data.links.filter((l) => l.source === selected.id || l.target === selected.id)
    : []

  return (
    <div className="insights">
      <div className="stats">
        {COUNTED.map((kind) => (
          <div key={kind} className="stat" style={{ borderColor: data.kinds[kind].color }}>
            <strong>{seen.filter((n) => n.kind === kind).length}</strong>
            <span>{data.kinds[kind].label}</span>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="card detail">
          <div className="panel-head">
            <span className="chip" style={{ background: data.kinds[selected.kind].color }}>
              {data.kinds[selected.kind].label}
            </span>
            <button className="ghost small" onClick={() => onSelect(null)}>
              zamknij
            </button>
          </div>
          <h3>{selected.label}</h3>
          <button className="stamp-btn" onClick={() => onSeek(Math.max(0, selected.t - 3))}>
            ▶ {formatTime(selected.t)} · {selected.speaker}
          </button>
          <blockquote>„{selected.quote}”</blockquote>

          {selected.childIds.length > 0 && (
            <>
              <div className="sub-head">Rozwinięcia ({selected.childIds.length})</div>
              <ul className="links">
                {selected.childIds.map((id) => {
                  const child = placed.get(id)!
                  return (
                    <li key={id}>
                      <button onClick={() => onSelect(id)}>
                        <span className="pip" style={{ background: data.kinds[child.kind].color }} />
                        {child.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {relatedLinks.length > 0 && (
            <>
              <div className="sub-head">Powtórki wątku</div>
              <ul className="links">
                {relatedLinks.map((link) => {
                  const otherId = link.source === selected.id ? link.target : link.source
                  const other = placed.get(otherId)!
                  return (
                    <li key={otherId}>
                      <button onClick={() => onSelect(otherId)}>
                        <span className="pip echo" />
                        {other.label}
                        <em>{link.note}</em>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="panel-head">
            <span className="dot live" /> Agent wyłapał
          </div>
          <ul className="feed">
            {feed.map((node) => (
              <li key={node.id}>
                <button onClick={() => onSelect(node.id)}>
                  <span className="pip" style={{ background: data.kinds[node.kind].color }} />
                  <span className="feed-label">{node.label}</span>
                  <span className="stamp">{formatTime(node.t)}</span>
                </button>
              </li>
            ))}
            {feed.length === 0 && <li className="empty">Naciśnij ▶ i patrz, jak mapa się buduje.</li>}
          </ul>
        </div>
      )}

      <div className="legend">
        {Object.entries(data.kinds).map(([kind, meta]) => (
          <span key={kind}>
            <i style={{ background: meta.color }} />
            {meta.label}
          </span>
        ))}
      </div>
    </div>
  )
}
