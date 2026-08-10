'use client'

// The one caption editor. Used by BOTH the standalone Captions app and the video module's transcript
// panel, so editing/behaviour never drifts between them. Feature flags turn on what each surface needs:
// the app shows confidence flags + confirm/correct + delete; the video module shows search + seek.
import { useEffect, useRef, useState } from 'react'
import { Search, AlertTriangle, Check, Trash2, AlignLeft } from 'lucide-react'
import { fmtTime, LOW_CONF, type EditCaption } from '@/lib/caption-format'

export interface CaptionEditorProps {
  captions: EditCaption[]
  onChange: (captions: EditCaption[]) => void
  currentTime?: number
  onSeek?: (t: number) => void
  search?: boolean          // show the search bar (long transcripts)
  confidence?: boolean      // amber-flag low-confidence lines (hybrid verifier)
  feedback?: boolean        // per-row ✓ "mark correct" (edit-feedback loop)
  deletable?: boolean       // per-row delete
  emptyHint?: string
}

export default function CaptionEditor({
  captions, onChange, currentTime = 0, onSeek, search: showSearch, confidence, feedback, deletable,
  emptyHint = 'No captions yet.',
}: CaptionEditorProps) {
  const [q, setQ] = useState('')
  const activeRef = useRef<HTMLDivElement>(null)
  const activeIdx = captions.findIndex(c => currentTime >= c.start && currentTime <= c.end)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [activeIdx])

  const setText = (i: number, text: string) => onChange(captions.map((c, j) => j === i ? { ...c, text } : c))
  const toggleConfirm = (i: number) => onChange(captions.map((c, j) => j === i ? { ...c, confirmed: !c.confirmed } : c))
  const remove = (i: number) => onChange(captions.filter((_, j) => j !== i))

  const rows = captions.map((c, i) => ({ c, i })).filter(({ c }) =>
    !q || c.text.toLowerCase().includes(q.toLowerCase()) || c.speaker?.toLowerCase().includes(q.toLowerCase()))

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
          const left = edited ? '#38bdf8' : low ? '#f59e0b' : isActive ? 'var(--accent)' : 'transparent'
          return (
            <div key={c.id ?? `${c.start}-${i}`} ref={isActive ? activeRef : undefined}
              title={edited ? `Corrected (was: "${c.original}")` : low ? `Low confidence (${Math.round((c.confidence ?? 1) * 100)}%) — the two local models disagreed; check this line.` : undefined}
              style={{ display: 'flex', gap: 8, padding: '8px 12px', borderLeft: `3px solid ${left}`, borderBottom: '1px solid var(--border)',
                background: isActive ? 'rgba(124,92,255,0.08)' : c.confirmed ? 'rgba(52,211,153,0.06)' : low && !edited ? 'rgba(245,158,11,0.06)' : 'transparent' }}>
              <button onClick={() => onSeek?.(c.start)} title={onSeek ? 'Jump here' : undefined}
                style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 11, color: isActive ? 'var(--accent-light)' : 'var(--accent-light)', background: 'none', border: 'none', cursor: onSeek ? 'pointer' : 'default', width: 58, textAlign: 'left', paddingTop: 3 }}>
                {fmtTime(c.start)}
              </button>
              {c.speaker && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: 'var(--accent-light)', paddingTop: 4, minWidth: 54 }}>{c.speaker}</span>}
              <textarea value={c.text} onChange={e => setText(i, e.target.value)} rows={1}
                style={{ flex: 1, resize: 'vertical', background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit' }} />
              {low && !edited && <AlertTriangle size={13} style={{ flexShrink: 0, color: '#f59e0b', marginTop: 6 }} />}
              {feedback && (
                <button onClick={() => toggleConfirm(i)} title={c.confirmed ? 'Marked correct — click to undo' : 'Mark this caption correct'}
                  style={{ flexShrink: 0, background: c.confirmed ? '#34d399' : 'none', border: c.confirmed ? 'none' : '1px solid var(--border)', borderRadius: 6, color: c.confirmed ? '#04120b' : 'var(--text-muted)', cursor: 'pointer', marginTop: 3, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={14} />
                </button>
              )}
              {deletable && (
                <button onClick={() => remove(i)} title="Delete" style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginTop: 3 }}><Trash2 size={14} /></button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
