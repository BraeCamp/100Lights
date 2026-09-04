'use client'

// Per-audio-clip beat-grid editor. Sets the clip's own BPM (and optional extra
// tempo sections) which become the timeline's snapping points — independent of
// any linked DAW project. Extra sections can be anchored either to a timestamp
// in the audio file or to a bar count. Opened from an audio clip's right-click
// menu (VideoEditor → Timeline getClipMenu → onEditBeatMap).

import { useState } from 'react'
import { X, Plus, Trash2, Music2 } from 'lucide-react'
import type { TimelineItem, TempoSeg } from '@/lib/editor-types'
import { barToSrc } from '@/lib/video-beats'
import { clampBpm } from '@/lib/tempo-map'

interface Row { bpm: number; bpb: number; anchor: 'time' | 'bar'; anchorVal: number }

interface Props {
  clip: TimelineItem
  onSave: (beatMap: TempoSeg[] | undefined) => void
  onClose: () => void
  onDetect: () => Promise<{ bpm: number; offsetSrc: number } | null>
}

// Resolve each row to an absolute source-time, top-down (bar rows use the
// previous row's tempo). Row 0 is always time-anchored (the downbeat).
function resolveSrcs(rows: Row[]): TempoSeg[] {
  const segs: TempoSeg[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    let src: number
    if (i === 0 || r.anchor === 'time') src = Math.max(0, r.anchorVal)
    else src = barToSrc(segs[i - 1], r.anchorVal)
    segs.push({ src, bpm: r.bpm, beatsPerBar: r.bpb })
  }
  return segs
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()

export default function BeatMapEditor({ clip, onSave, onClose, onDetect }: Props) {
  const [rows, setRows] = useState<Row[]>(() => {
    const map = clip.beatMap
    if (map && map.length) {
      return [...map].sort((a, b) => a.src - b.src).map((s, i) => ({
        bpm: s.bpm, bpb: s.beatsPerBar ?? 4,
        anchor: 'time' as const, anchorVal: i === 0 ? s.src : s.src,
      }))
    }
    return [{ bpm: 120, bpb: 4, anchor: 'time', anchorVal: 0 }]
  })
  const [detecting, setDetecting] = useState(false)

  const patch = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...p } : r))
  const addRow = () => setRows(rs => [...rs, { bpm: rs[rs.length - 1]?.bpm ?? 120, bpb: rs[rs.length - 1]?.bpb ?? 4, anchor: 'bar', anchorVal: rs.length + 1 }])
  const removeRow = (i: number) => setRows(rs => rs.filter((_, j) => j !== i))

  async function detect() {
    setDetecting(true)
    try {
      const r = await onDetect()
      if (r) patch(0, { bpm: clampBpm(r.bpm), anchorVal: Math.round(r.offsetSrc * 100) / 100 })
    } finally { setDetecting(false) }
  }

  function save() {
    const segs = resolveSrcs(rows).filter(s => s.bpm > 0)
    onSave(segs.length ? segs : undefined)
    onClose()
  }

  const clipLen = Math.max(0, clip.outPoint - clip.inPoint)
  const numStyle: React.CSSProperties = { width: 60, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none', height: 24, borderRadius: 4, padding: '0 6px', fontSize: 12 }
  const btn: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)' }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="rounded-xl shadow-2xl" style={{ width: 480, maxHeight: '85vh', overflow: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-light)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="flex items-center gap-2 font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            <Music2 size={14} color="var(--accent-light)" /> Beat grid — {clip.label}
          </span>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}><X size={18} /></button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Set this clip&rsquo;s tempo to create snap points on the timeline. Add sections to change BPM partway through — anchored to a time in the audio or to a bar. This grid is the clip&rsquo;s own; it&rsquo;s never overridden by a linked project. (Clip length {fmt(clipLen)}s.)
          </p>

          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <span className="text-xs font-semibold shrink-0" style={{ color: i === 0 ? 'var(--accent-light)' : 'var(--text-muted)', width: 58 }}>
                {i === 0 ? 'Base' : `Section ${i + 1}`}
              </span>

              {/* Anchor (where the section starts) */}
              {i === 0 ? (
                <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Downbeat at
                  <input type="number" step="0.01" min="0" value={r.anchorVal}
                    onChange={e => patch(i, { anchorVal: parseFloat(e.target.value) || 0 })} style={numStyle} /> s
                </label>
              ) : (
                <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  at
                  <select value={r.anchor} onChange={e => patch(i, { anchor: e.target.value as 'time' | 'bar' })}
                    style={{ ...numStyle, width: 68 }}>
                    <option value="bar">bar</option>
                    <option value="time">time</option>
                  </select>
                  <input type="number" step={r.anchor === 'bar' ? '1' : '0.01'} min="0" value={r.anchorVal}
                    onChange={e => patch(i, { anchorVal: parseFloat(e.target.value) || 0 })} style={numStyle} />
                  {r.anchor === 'time' && <span>s</span>}
                </div>
              )}

              {/* BPM */}
              <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <input type="number" step="0.1" min="20" max="400" value={r.bpm}
                  onChange={e => patch(i, { bpm: parseFloat(e.target.value) || 0 })} style={numStyle} /> BPM
              </label>

              {/* Beats per bar */}
              <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <input type="number" step="1" min="1" max="16" value={r.bpb}
                  onChange={e => patch(i, { bpb: Math.max(1, Math.round(parseFloat(e.target.value) || 4)) })} style={{ ...numStyle, width: 46 }} />/bar
              </label>

              {i === 0 ? (
                <button onClick={detect} disabled={detecting} style={{ ...btn, marginLeft: 'auto' }}>
                  {detecting ? 'Detecting…' : 'Detect'}
                </button>
              ) : (
                <button onClick={() => removeRow(i)} title="Remove section" style={{ ...btn, marginLeft: 'auto', color: '#f87171', borderColor: 'transparent' }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}

          <button onClick={addRow} className="flex items-center gap-1.5 self-start" style={{ ...btn }}>
            <Plus size={13} /> Add tempo section
          </button>
        </div>

        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => { onSave(undefined); onClose() }} style={{ ...btn, color: '#f87171' }}>Remove grid</button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} style={btn}>Cancel</button>
            <button onClick={save} style={{ ...btn, background: 'var(--accent)', color: 'var(--accent-contrast)', border: 'none', padding: '5px 14px' }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
