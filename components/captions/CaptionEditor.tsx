'use client'

// The one caption editor. Used by BOTH the standalone Captions app and the video module's transcript
// panel, so editing/behaviour never drifts between them. Feature flags turn on what each surface needs:
// the app shows confidence flags + confirm/correct + delete + fine-timing; the video module shows search.
import { useEffect, useRef, useState } from 'react'
import { Search, AlertTriangle, Check, Trash2, AlignLeft, SplitSquareHorizontal, ArrowDownToLine, Clock } from 'lucide-react'
import { fmtTime, fmtTimeMs, parseTime, splitCaption, mergeCaptions, activeWord, LOW_CONF, type EditCaption } from '@/lib/caption-format'

export interface CaptionEditorProps {
  captions: EditCaption[]
  onChange: (captions: EditCaption[]) => void
  currentTime?: number
  onSeek?: (t: number) => void
  search?: boolean          // show the search bar (long transcripts)
  confidence?: boolean      // amber-flag low-confidence lines (hybrid verifier)
  feedback?: boolean        // per-row ✓ "mark correct" (edit-feedback loop)
  deletable?: boolean       // per-row delete
  timing?: boolean          // selection + a fine-timing panel (edit start/end, split, merge)
  emptyHint?: string
}

export default function CaptionEditor({
  captions, onChange, currentTime = 0, onSeek, search: showSearch, confidence, feedback, deletable, timing,
  emptyHint = 'No captions yet.',
}: CaptionEditorProps) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const activeIdx = captions.findIndex(c => currentTime >= c.start && currentTime <= c.end)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [activeIdx])
  useEffect(() => { if (selected != null && selected >= captions.length) setSelected(captions.length ? captions.length - 1 : null) }, [captions.length, selected])

  const setText = (i: number, text: string) => onChange(captions.map((c, j) => j === i ? { ...c, text } : c))
  const toggleConfirm = (i: number) => onChange(captions.map((c, j) => j === i ? { ...c, confirmed: !c.confirmed } : c))
  const remove = (i: number) => onChange(captions.filter((_, j) => j !== i))
  const patchTime = (i: number, field: 'start' | 'end', v: number) => onChange(captions.map((c, j) => {
    if (j !== i) return c
    const s = field === 'start' ? Math.max(0, Math.min(v, c.end - 0.05)) : c.start
    const e = field === 'end' ? Math.max(c.start + 0.05, v) : c.end
    return { ...c, start: s, end: e }
  }))
  const doSplit = (i: number) => { const r = splitCaption(captions[i], currentTime); if (r) onChange([...captions.slice(0, i), ...r, ...captions.slice(i + 1)]) }
  const doMerge = (i: number) => onChange(mergeCaptions(captions, i))

  const rows = captions.map((c, i) => ({ c, i })).filter(({ c }) =>
    !q || c.text.toLowerCase().includes(q.toLowerCase()) || c.speaker?.toLowerCase().includes(q.toLowerCase()))
  const sel = timing && selected != null ? captions[selected] : null

  // Colour each speaker (diarization) consistently so the transcript is easy to follow.
  const speakers = [...new Set(captions.map(c => c.speaker).filter(Boolean))] as string[]
  const SPK = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#fb7185']
  const spkColor = (s?: string) => s ? SPK[Math.max(0, speakers.indexOf(s)) % SPK.length] : 'var(--accent-light)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {showSearch && captions.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search captions…"
              style={{ width: '100%', paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)', outline: 'none' }} />
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {captions.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <AlignLeft size={34} strokeWidth={1} color="var(--text-muted)" style={{ marginBottom: 10 }} />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{emptyHint}</p>
          </div>
        ) : rows.map(({ c, i }) => {
          const low = !!confidence && (c.confidence ?? 1) < LOW_CONF
          const edited = c.original != null && c.text.trim() !== c.original.trim()
          const isActive = i === activeIdx
          const isSel = i === selected
          const left = isSel ? 'var(--accent)' : edited ? '#38bdf8' : low ? '#f59e0b' : isActive ? 'var(--accent-light)' : 'transparent'
          return (
            <div key={c.id ?? `${c.start}-${i}`} ref={isActive ? activeRef : undefined} onClick={() => timing && setSelected(i)}
              title={edited ? `Corrected (was: "${c.original}")` : low ? `Low confidence (${Math.round((c.confidence ?? 1) * 100)}%) — the two local models disagreed; check this line.` : undefined}
              style={{ display: 'flex', gap: 8, padding: '8px 12px', borderLeft: `3px solid ${left}`, borderBottom: '1px solid var(--border)', cursor: timing ? 'pointer' : 'default',
                background: isSel ? 'rgba(124,92,255,0.12)' : isActive ? 'rgba(124,92,255,0.06)' : c.confirmed ? 'rgba(52,211,153,0.06)' : low && !edited ? 'rgba(245,158,11,0.06)' : 'transparent' }}>
              <button onClick={e => { e.stopPropagation(); onSeek?.(c.start) }} title={onSeek ? 'Jump here' : undefined}
                style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--accent-light)', background: 'none', border: 'none', cursor: onSeek ? 'pointer' : 'default', width: 58, textAlign: 'left', paddingTop: 3 }}>
                {fmtTime(c.start)}
              </button>
              {c.speaker && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: spkColor(c.speaker), paddingTop: 4, minWidth: 54 }}>{c.speaker}</span>}
              <textarea value={c.text} onChange={e => setText(i, e.target.value)} onFocus={() => timing && setSelected(i)} rows={1}
                style={{ flex: 1, resize: 'vertical', background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit' }} />
              {low && !edited && <AlertTriangle size={13} style={{ flexShrink: 0, color: '#f59e0b', marginTop: 6 }} />}
              {feedback && (
                <button onClick={e => { e.stopPropagation(); toggleConfirm(i) }} title={c.confirmed ? 'Marked correct — click to undo' : 'Mark this caption correct'}
                  style={{ flexShrink: 0, background: c.confirmed ? '#34d399' : 'none', border: c.confirmed ? 'none' : '1px solid var(--border)', borderRadius: 6, color: c.confirmed ? '#04120b' : 'var(--text-muted)', cursor: 'pointer', marginTop: 3, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={14} />
                </button>
              )}
              {deletable && (
                <button onClick={e => { e.stopPropagation(); remove(i) }} title="Delete" style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginTop: 3 }}><Trash2 size={14} /></button>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Fine-timing panel for the selected caption ──────────────────────── */}
      {sel && selected != null && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
            <Clock size={12} /> Timing · caption {selected + 1}
            <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{(sel.end - sel.start).toFixed(2)}s</span>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <TimeField label="In" value={sel.start} onCommit={v => patchTime(selected, 'start', v)} onNudge={d => patchTime(selected, 'start', sel.start + d)} onPlayhead={() => patchTime(selected, 'start', currentTime)} />
            <TimeField label="Out" value={sel.end} onCommit={v => patchTime(selected, 'end', v)} onNudge={d => patchTime(selected, 'end', sel.end + d)} onPlayhead={() => patchTime(selected, 'end', currentTime)} />
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button onClick={() => doSplit(selected)} disabled={!(currentTime > sel.start + 0.02 && currentTime < sel.end - 0.02)} title="Split at the playhead"
                style={{ ...pill, opacity: currentTime > sel.start + 0.02 && currentTime < sel.end - 0.02 ? 1 : 0.4 }}><SplitSquareHorizontal size={13} /> Split</button>
              <button onClick={() => doMerge(selected)} disabled={selected >= captions.length - 1} title="Merge with the next caption"
                style={{ ...pill, opacity: selected < captions.length - 1 ? 1 : 0.4 }}><ArrowDownToLine size={13} /> Merge next</button>
            </div>
          </div>
          {sel.words && sel.words.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {sel.words.map((w, wi) => {
                const on = currentTime >= w.s && currentTime < w.e
                return <button key={wi} onClick={() => onSeek?.(w.s)} title={`${fmtTimeMs(w.s)}–${fmtTimeMs(w.e)}`}
                  style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--bg-card)', color: on ? '#fff' : 'var(--text-secondary)' }}>{w.w}</button>
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TimeField({ label, value, onCommit, onNudge, onPlayhead }: { label: string; value: number; onCommit: (v: number) => void; onNudge: (d: number) => void; onPlayhead: () => void }) {
  const [txt, setTxt] = useState(fmtTimeMs(value))
  useEffect(() => { setTxt(fmtTimeMs(value)) }, [value])
  const commit = () => { const v = parseTime(txt); if (v != null) onCommit(v); else setTxt(fmtTimeMs(value)) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', width: 22 }}>{label}</span>
      <button onClick={() => onNudge(-0.05)} title="−50 ms" style={nudge}>‹</button>
      <input value={txt} onChange={e => setTxt(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{ width: 74, fontVariantNumeric: 'tabular-nums', fontSize: 12, textAlign: 'center', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 4px', color: 'var(--text-primary)' }} />
      <button onClick={() => onNudge(0.05)} title="+50 ms" style={nudge}>›</button>
      <button onClick={onPlayhead} title="Set to playhead" style={{ ...nudge, width: 'auto', padding: '0 6px', fontSize: 10 }}>⏱</button>
    </div>
  )
}

const pill: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }
const nudge: React.CSSProperties = { width: 22, height: 24, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }
