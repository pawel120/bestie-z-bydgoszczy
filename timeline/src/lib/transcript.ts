import type { TranscriptLine } from './types'

const LINE_RE = /^\[(\d{2}):(\d{2})\]\s*([^:]+):\s*(.*)$/

export function parseTranscript(raw: string): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  let seenSplit = false
  for (const row of raw.split('\n')) {
    const trimmed = row.replace(/^\s*\d+\|/, '').trim()
    if (!trimmed) continue
    if (trimmed.startsWith('---')) {
      seenSplit = true
      continue
    }
    const match = LINE_RE.exec(trimmed)
    if (!match) continue
    const [, mm, ss, speaker, text] = match
    // Everything before the split marker is the short prologue recording.
    const t = Number(mm) * 60 + Number(ss)
    lines.push({ t, speaker: seenSplit ? speaker.trim() : `${speaker.trim()} (prolog)`, text })
  }
  return lines.sort((a, b) => a.t - b.t)
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
