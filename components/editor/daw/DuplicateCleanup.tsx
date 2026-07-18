'use client'

// Duplicate-clip detector: earlier paste bugs could leave a near-invisible
// copy of a clip a fraction of a beat from its source — audible as a loud
// echo of "always the same" samples. This scans the loaded project once and
// offers one-click removal (later copy goes, earliest stays).

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip, type DawClip } from '@/lib/daw-types'

function clipSig(c: DawClip): string {
  if (isAudioClip(c)) return `a|${c.r2Key ?? c.libraryId ?? c.audioUrl ?? c.name}`
  return `m|${c.name}|${c.notes.length}|${c.presetId ?? ''}`
}

/** Same track, same source, overlapping ≥60% of the shorter clip → suspect. */
function findDuplicates(clips: DawClip[]): string[] {
  const byTrack = new Map<string, DawClip[]>()
  for (const c of clips) {
    const arr = byTrack.get(c.trackId) ?? []
    arr.push(c)
    byTrack.set(c.trackId, arr)
  }
  const doomed = new Set<string>()
  for (const arr of byTrack.values()) {
    const sorted = [...arr].sort((a, b) => a.startBeat - b.startBeat || a.id.localeCompare(b.id))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j]
        if (doomed.has(a.id)) continue
        if (clipSig(a) !== clipSig(b)) continue
        const overlap = Math.min(a.startBeat + a.durationBeats, b.startBeat + b.durationBeats) - Math.max(a.startBeat, b.startBeat)
        const shorter = Math.min(a.durationBeats, b.durationBeats)
        if (shorter > 0 && overlap / shorter >= 0.6) doomed.add(b.id)
      }
    }
  }
  return [...doomed]
}

export function DuplicateCleanup() {
  const { project, dispatch } = useDaw()
  const [dupes, setDupes] = useState<string[]>([])
  const [dismissed, setDismissed] = useState(false)
  const [scanned, setScanned] = useState(false)

  // One scan after the project settles (loads arrive async)
  useEffect(() => {
    if (scanned || project.arrangementClips.length === 0) return
    const t = setTimeout(() => {
      setScanned(true)
      setDupes(findDuplicates(project.arrangementClips))
    }, 2500)
    return () => clearTimeout(t)
  }, [project.arrangementClips, scanned])

  if (dismissed || dupes.length === 0) return null

  return (
    <div role="alert" style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 900,
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
      background: 'var(--bg-surface)', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 10,
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)', maxWidth: 'calc(100vw - 40px)',
    }}>
      <AlertTriangle size={15} color="#f59e0b" style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
        Found {dupes.length} overlapping duplicate clip{dupes.length !== 1 ? 's' : ''} — likely invisible leftover copies that play as an echo.
      </span>
      <button
        onClick={() => {
          for (const id of dupes) dispatch({ type: 'REMOVE_CLIP', clipId: id })
          setDupes([])
        }}
        style={{
          flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: '6px 14px', borderRadius: 999,
          border: 'none', cursor: 'pointer', background: '#f59e0b', color: 'var(--text-muted)',
        }}
      >Remove them</button>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
        <X size={14} />
      </button>
    </div>
  )
}
