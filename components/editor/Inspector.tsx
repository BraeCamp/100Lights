'use client'

import { useState, useRef, useEffect } from 'react'
import { FileText, Newspaper, AlignLeft, RotateCcw, Mic, Scissors, Sparkles, CheckCircle, AlertCircle, Loader2, ChevronRight, Copy, Check, PlaySquare, MessageSquare, Mail, BookOpen, Quote, Flag, Trash2, Pencil, FlipHorizontal2, FlipVertical2 } from 'lucide-react'
import { formatDisplayTime } from '@/lib/captions'
import type { TimelineItem, VideoAdjustments, TransitionType, ClipFlag } from '@/lib/editor-types'
import { DEFAULT_ADJUSTMENTS } from '@/lib/editor-types'
import type { Caption, Output, ChapterMarker } from '@/lib/types'

type TranscribeStatus = 'idle' | 'transcribing' | 'done' | 'error'
type ActionStatus = 'idle' | 'working' | 'done' | 'error'

interface Props {
  selectedItem: TimelineItem | null
  adjustments: VideoAdjustments
  outputs: Output[]
  onAdjustmentsChange: (a: VideoAdjustments) => void
  onTransitionChange: (id: string, type: TransitionType | undefined, duration: number) => void
  onClipChange: (id: string, patch: Partial<TimelineItem>) => void
  importedFile: File | null
  transcribeStatus: TranscribeStatus
  transcribeProgress?: number
  transcribeError?: string
  onTranscribe: () => void
  captions: Caption[]
  currentTime?: number
  onSeek?: (t: number) => void
  silenceTrimStatus: ActionStatus
  silenceThreshold: number
  onSilenceThresholdChange: (v: number) => void
  onSilenceTrim: () => void
  chapters: ChapterMarker[]
  onAddChapter: () => void
  onRenameChapter: (id: string, title: string) => void
  onDeleteChapter: (id: string) => void
  onSpeedChange?: (id: string, speed: number) => void
  isAudioOnly?: boolean
  lutItems?: Array<{ id: string; name: string }>
  audioDuckingEnabled?: boolean
  onAudioDuckingToggle?: () => void
}

type Tab = 'clip' | 'color' | 'outputs' | 'tools' | 'transcript'

const TRANSITIONS: { value: TransitionType | 'none'; label: string }[] = [
  { value: 'none',       label: 'Cut (none)' },
  { value: 'dissolve',   label: 'Dissolve' },
  { value: 'dip_black',  label: 'Dip to Black' },
  { value: 'wipe_right', label: 'Wipe Right' },
  { value: 'push',       label: 'Push' },
]

const FLAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899']

const outputIcons: Partial<Record<string, React.ElementType>> = {
  article:          FileText,
  blog_post:        Newspaper,
  show_notes:       AlignLeft,
  transcript:       AlignLeft,
  youtube_desc:     PlaySquare,
  social_caption:   MessageSquare,
  email_newsletter: Mail,
  summary:          BookOpen,
  key_quotes:       Quote,
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSRT(t: number) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`
}

function fmtVTT(t: number) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`
}

function downloadText(content: string, filename: string, mime = 'text/plain') {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: mime })),
    download: filename,
  })
  a.click()
  URL.revokeObjectURL(a.href)
}

const SPEAKER_COLORS = ['var(--accent-light)', '#34d399', '#fb923c', '#f472b6', '#38bdf8', '#a78bfa']

function getSpeakerColor(speaker: string): string {
  let hash = 0
  for (let i = 0; i < speaker.length; i++) hash = speaker.charCodeAt(i) + (hash << 5) - hash
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length]
}

function Slider({ label, value, min, max, unit, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; unit?: string; step?: number; onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{value}{unit ?? ''}</span>
      </div>
      <input
        type="range" className="cf-slider w-full" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--border-light) ${pct}%)` }}
      />
    </div>
  )
}

function statusIcon(status: ActionStatus) {
  if (status === 'working') return <Loader2 size={13} color="var(--accent-light)" style={{ animation: 'spin 1s linear infinite' }} />
  if (status === 'done')    return <CheckCircle size={13} color="var(--success, #10b981)" />
  if (status === 'error')   return <AlertCircle size={13} color="#ef4444" />
  return <ChevronRight size={11} color="var(--text-muted)" />
}

function ActionRow({ icon: Icon, label, description, badge, status, onClick, disabled, children }: {
  icon: React.ElementType; label: string; description: string; badge?: string
  status?: ActionStatus; onClick?: () => void; disabled?: boolean; children?: React.ReactNode
}) {
  const isWorking = status === 'working'
  const isDisabled = disabled || isWorking
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <button
        onClick={onClick} disabled={isDisabled}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        style={{ opacity: isDisabled ? 0.5 : 1, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
        onMouseEnter={(e) => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '' }}
      >
        <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ background: 'var(--border-light)' }}>
          <Icon size={13} color="var(--text-secondary)" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
            {badge && <span className="text-xs px-1 rounded" style={{ background: 'var(--border)', color: 'var(--text-muted)', fontSize: 9 }}>{badge}</span>}
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{description}</span>
        </div>
        {status !== undefined ? statusIcon(status) : <ChevronRight size={11} color="var(--text-muted)" />}
      </button>
      {children}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
      className="p-1 rounded" title="Copy" style={{ color: copied ? 'var(--success)' : 'var(--text-muted)' }}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

// ── Tone Curve Editor ────────────────────────────────────────────
function ToneCurveEditor({ adj, onChange }: { adj: VideoAdjustments; onChange: (a: VideoAdjustments) => void }) {
  const W = 152, H = 110, pad = 10
  const plotW = W - 2 * pad, plotH = H - 2 * pad

  const handles = [
    { key: 'shadows'   as const, x: pad + plotW * 0.25, val: adj.shadows ?? 0,    range: 50 },
    { key: 'midtones'  as const, x: pad + plotW * 0.5,  val: adj.midtones ?? 0,   range: 50 },
    { key: 'highlights'as const, x: pad + plotW * 0.75, val: adj.highlights ?? 0, range: 100 },
  ]
  function valToY(val: number, range: number) { return pad + plotH * (0.5 - val / (range * 2)) }

  const allPts = [
    { x: pad, y: pad + plotH },
    { x: handles[0].x, y: valToY(handles[0].val, handles[0].range) },
    { x: handles[1].x, y: valToY(handles[1].val, handles[1].range) },
    { x: handles[2].x, y: valToY(handles[2].val, handles[2].range) },
    { x: pad + plotW, y: pad },
  ]

  function catmullBez(p0: {x:number;y:number}, p1: {x:number;y:number}, p2: {x:number;y:number}, p3: {x:number;y:number}) {
    return {
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
    }
  }

  let d = `M ${allPts[0].x} ${allPts[0].y}`
  for (let i = 0; i < allPts.length - 1; i++) {
    const p0 = allPts[Math.max(0, i - 1)]
    const p1 = allPts[i], p2 = allPts[i + 1]
    const p3 = allPts[Math.min(allPts.length - 1, i + 2)]
    const { c1, c2 } = catmullBez(p0, p1, p2, p3)
    d += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x} ${p2.y}`
  }

  function startDrag(e: React.PointerEvent, key: 'shadows' | 'midtones' | 'highlights', range: number) {
    e.preventDefault()
    const startY = e.clientY, startVal = (adj[key] ?? 0) as number
    const onMove = (ev: PointerEvent) => {
      const delta = (startY - ev.clientY) * 0.6
      onChange({ ...adj, [key]: Math.round(Math.max(-range, Math.min(range, startVal + delta))) })
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div>
      <svg width={W} height={H} style={{ display: 'block', margin: '0 auto', background: '#0d0d0d', borderRadius: 6, border: '1px solid var(--border)' }}>
        {[0.25, 0.5, 0.75].map(t => (
          <g key={t}>
            <line x1={pad + plotW * t} y1={pad} x2={pad + plotW * t} y2={pad + plotH} stroke="#1c1c1c" strokeWidth={0.5} />
            <line x1={pad} y1={pad + plotH * (1 - t)} x2={pad + plotW} y2={pad + plotH * (1 - t)} stroke="#1c1c1c" strokeWidth={0.5} />
          </g>
        ))}
        <line x1={pad} y1={pad + plotH} x2={pad + plotW} y2={pad} stroke="#252525" strokeWidth={0.5} strokeDasharray="3 3" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        {handles.map(h => (
          <circle key={h.key} cx={h.x} cy={valToY(h.val, h.range)} r={4.5} fill="var(--accent)" stroke="#fff" strokeWidth={1}
            style={{ cursor: 'ns-resize' }}
            onPointerDown={e => startDrag(e, h.key, h.range)} />
        ))}
      </svg>
      <div className="flex justify-between mt-1">
        {handles.map(h => (
          <span key={h.key} style={{ fontSize: 8, color: 'var(--text-muted)' }}>{h.val > 0 ? '+' : ''}{h.val}</span>
        ))}
      </div>
    </div>
  )
}

// ── Color Wheel (single master channel, drag up/down) ────────────
function ColorWheel({ label, value, min, max, defaultVal, onChange }: {
  label: string; value: number; min: number; max: number; defaultVal: number; onChange: (v: number) => void
}) {
  const range = max - min
  const norm = (value - defaultVal) / (range / 2)  // -1 to +1
  const dotY = 28 - norm * 22  // center=28, top=6, bottom=50 (within 56px circle)

  function startDrag(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY, startVal = value
    const onMove = (ev: PointerEvent) => {
      const delta = (startY - ev.clientY) * 0.5
      onChange(Math.round(Math.max(min, Math.min(max, startVal + delta))))
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        onPointerDown={startDrag}
        style={{
          width: 56, height: 56, borderRadius: '50%', cursor: 'ns-resize',
          background: 'radial-gradient(circle at center, var(--bg-card) 30%, var(--bg-base) 100%)',
          border: `1px solid ${value !== defaultVal ? 'var(--accent)' : 'var(--border)'}`,
          position: 'relative',
        }}
        onDoubleClick={() => onChange(defaultVal)}
        title="Drag up/down · Double-click to reset"
      >
        <div style={{
          position: 'absolute', left: '50%', top: dotY, transform: 'translate(-50%, -50%)',
          width: 8, height: 8, borderRadius: '50%',
          background: value !== defaultVal ? 'var(--accent)' : '#555',
          boxShadow: value !== defaultVal ? '0 0 4px var(--accent)' : 'none',
          transition: 'background 0.15s',
        }} />
        <span style={{ position: 'absolute', bottom: 5, left: 0, right: 0, textAlign: 'center', fontSize: 7, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize: 9, color: value !== defaultVal ? 'var(--accent-light)' : 'var(--text-muted)', fontFamily: 'monospace' }}>
        {value > defaultVal ? '+' : ''}{value - defaultVal}
      </span>
    </div>
  )
}

export default function Inspector({
  selectedItem, adjustments, outputs, onAdjustmentsChange, onTransitionChange, onClipChange,
  importedFile, transcribeStatus, transcribeProgress = 0, transcribeError, onTranscribe,
  captions, currentTime = 0, onSeek,
  silenceTrimStatus, silenceThreshold, onSilenceThresholdChange, onSilenceTrim,
  chapters, onAddChapter, onRenameChapter, onDeleteChapter,
  onSpeedChange,
  isAudioOnly,
  lutItems = [],
  audioDuckingEnabled = false,
  onAudioDuckingToggle,
}: Props) {
  const [tab, setTab] = useState<Tab>('tools')
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null)
  const [editingChapterTitle, setEditingChapterTitle] = useState('')
  const activeCaptionRef = useRef<HTMLDivElement>(null)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'tools',      label: 'Tools' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'clip',       label: 'Clip' },
    ...(!isAudioOnly ? [{ id: 'color' as Tab, label: 'Color' }] : []),
    { id: 'outputs',    label: 'Outputs' },
  ]

  function resetAdjustments() { onAdjustmentsChange({ ...DEFAULT_ADJUSTMENTS }) }

  const adj = adjustments
  const isDefaultAdj = adj.brightness === 100 && adj.contrast === 100 &&
    adj.saturation === 100 && adj.highlights === 0 &&
    (adj.vignette ?? 0) === 0 && (adj.shadows ?? 0) === 0 &&
    (adj.midtones ?? 0) === 0 && (adj.lift ?? 0) === 0 &&
    (adj.gamma ?? 100) === 100 && (adj.gain ?? 100) === 100

  const activeCaptionIdx = captions.findIndex(c => currentTime >= c.start && currentTime < c.end)

  useEffect(() => {
    if (tab === 'transcript' && activeCaptionRef.current) {
      activeCaptionRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeCaptionIdx, tab])

  const filteredCaptions = transcriptSearch.trim()
    ? captions.filter(c => c.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
    : captions

  const needsTranscript = !captions.length
  const transcriptRequired = 'Transcribe first to enable'

  // Switch to clip tab when a clip is selected
  useEffect(() => {
    if (selectedItem && tab === 'tools') { /* stay on tools */ }
  }, [selectedItem]) // eslint-disable-line

  function patchClip(patch: Partial<TimelineItem>) {
    if (selectedItem) onClipChange(selectedItem.id, patch)
  }

  function addFlag(color: string) {
    if (!selectedItem) return
    const flags = [...(selectedItem.flags ?? []), { id: crypto.randomUUID(), color }]
    patchClip({ flags })
  }

  function removeFlag(id: string) {
    if (!selectedItem) return
    patchClip({ flags: (selectedItem.flags ?? []).filter(f => f.id !== id) })
  }

  return (
    <div className="flex flex-col h-full select-none" style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}>

      {/* Tab bar */}
      <div className="flex shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 text-xs font-medium transition-colors whitespace-nowrap px-1"
            style={{
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              minWidth: 48,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">

        {/* ── Tools Tab ──────────────────────────────────── */}
        {tab === 'tools' && (
          <div className="flex flex-col gap-5">

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>SPEECH TO TEXT</p>
              {!importedFile ? (
                <div className="px-3 py-4 rounded-lg text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <Mic size={18} color="var(--text-muted)" className="mx-auto mb-2" />
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Import a video or audio file first</p>
                </div>
              ) : transcribeStatus === 'transcribing' ? (
                <div className="flex flex-col gap-2 px-3 py-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {transcribeProgress <= 100 ? `Uploading… ${transcribeProgress}%` : 'Deepgram processing…'}
                    </span>
                    <Loader2 size={11} className="animate-spin" color="var(--accent-light)" />
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-light)' }}>
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: transcribeProgress <= 100 ? `${transcribeProgress}%` : '100%', background: transcribeProgress <= 100 ? 'var(--accent)' : 'linear-gradient(90deg, var(--accent), var(--accent-light))', animation: transcribeProgress > 100 ? 'pulse 1.5s ease-in-out infinite' : undefined }} />
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {transcribeProgress <= 100 ? 'Sending directly to Deepgram…' : 'File received — transcription in progress'}
                  </p>
                </div>
              ) : transcribeStatus === 'done' ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <CheckCircle size={13} color="#10b981" />
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#10b981' }}>Transcription complete</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {captions.length} utterances · <button onClick={() => setTab('transcript')} className="underline" style={{ color: 'var(--accent-light)' }}>View transcript</button>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {transcribeStatus === 'error' && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <AlertCircle size={11} color="#ef4444" />
                      <span className="text-xs" style={{ color: '#ef4444' }}>{transcribeError ?? 'Transcription failed'}</span>
                    </div>
                  )}
                  <button onClick={onTranscribe}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-medium"
                    style={{ background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
                    <Mic size={12} /> Transcribe Media
                  </button>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>AUTO-EDIT</p>
              <div className="flex flex-col gap-1.5">
                <ActionRow icon={Sparkles} label="Auto-Silence Trim"
                  description={captions.length ? `Remove pauses >${silenceThreshold}s` : transcriptRequired}
                  status={silenceTrimStatus} onClick={onSilenceTrim}
                  disabled={needsTranscript || silenceTrimStatus === 'working'}>
                  {captions.length > 0 && (
                    <div className="px-3 pb-2.5 flex items-center gap-2">
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Threshold</span>
                      <input type="range" className="cf-slider flex-1" min={0.2} max={3} step={0.1}
                        value={silenceThreshold} onChange={(e) => onSilenceThresholdChange(Number(e.target.value))}
                        style={{ background: `linear-gradient(to right, var(--accent) ${((silenceThreshold - 0.2) / 2.8) * 100}%, var(--border-light) ${((silenceThreshold - 0.2) / 2.8) * 100}%)` }} />
                      <span className="text-xs font-mono shrink-0" style={{ color: 'var(--text-muted)', minWidth: 28 }}>{silenceThreshold.toFixed(1)}s</span>
                    </div>
                  )}
                </ActionRow>
                <ActionRow icon={Scissors} label="Detect Scenes" description="Find cut points automatically" badge="soon" disabled />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>CHAPTERS</p>
                <div className="flex items-center gap-1">
                  <button onClick={onAddChapter}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                    title="Mark chapter at current playhead">
                    <Flag size={9} /> Mark
                  </button>
                </div>
              </div>
              {chapters.length === 0 ? (
                <p className="text-xs py-2 text-center" style={{ color: 'var(--text-muted)' }}>No chapters yet. Press Mark at the playhead.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {chapters.map(ch => (
                    <div key={ch.id} className="flex items-center gap-2 px-2 py-1 rounded-lg group" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <span className="text-xs font-mono shrink-0" style={{ color: 'var(--accent-light)', minWidth: 36 }}>{fmtTime(ch.time)}</span>
                      {editingChapterId === ch.id ? (
                        <input autoFocus value={editingChapterTitle} onChange={e => setEditingChapterTitle(e.target.value)}
                          onBlur={() => { onRenameChapter(ch.id, editingChapterTitle.trim() || ch.title); setEditingChapterId(null) }}
                          onKeyDown={e => { if (e.key === 'Enter') { onRenameChapter(ch.id, editingChapterTitle.trim() || ch.title); setEditingChapterId(null) } if (e.key === 'Escape') setEditingChapterId(null) }}
                          className="flex-1 text-xs px-1 py-0 rounded outline-none min-w-0"
                          style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', color: 'var(--text-primary)' }} />
                      ) : (
                        <span className="flex-1 text-xs truncate cursor-pointer" style={{ color: 'var(--text-secondary)' }}
                          onDoubleClick={() => { setEditingChapterId(ch.id); setEditingChapterTitle(ch.title) }}
                          onClick={() => onSeek?.(ch.time)}>{ch.title}</span>
                      )}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingChapterId(ch.id); setEditingChapterTitle(ch.title) }} style={{ color: 'var(--text-muted)' }}><Pencil size={10} /></button>
                        <button onClick={() => onDeleteChapter(ch.id)} style={{ color: 'var(--text-muted)' }}><Trash2 size={10} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Transcript Tab ───────────────────────────────── */}
        {tab === 'transcript' && (
          <div className="flex flex-col gap-2 -mx-3 -mt-3">
            {captions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
                <Mic size={22} color="rgba(255,255,255,0.08)" />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Transcribe your media to see the transcript here.</p>
                <button onClick={() => setTab('tools')} className="text-xs mt-1 underline" style={{ color: 'var(--accent-light)' }}>Go to Tools tab →</button>
              </div>
            ) : (
              <>
                <div className="sticky top-0 px-3 py-2" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', zIndex: 10 }}>
                  <div className="flex items-center gap-1 mb-1.5">
                    {([
                      { label: '.txt', mime: 'text/plain', ext: 'txt', fn: () => captions.map(c => `[${formatDisplayTime(c.start)}]${c.speaker ? ` ${c.speaker}:` : ''} ${c.text}`).join('\n') },
                      { label: '.srt', mime: 'text/srt', ext: 'srt', fn: () => captions.map((c, i) => `${i+1}\n${fmtSRT(c.start)} --> ${fmtSRT(c.end)}\n${c.speaker ? `${c.speaker}: ` : ''}${c.text}\n`).join('\n') },
                      { label: '.vtt', mime: 'text/vtt', ext: 'vtt', fn: () => 'WEBVTT\n\n' + captions.map((c, i) => `${i+1}\n${fmtVTT(c.start)} --> ${fmtVTT(c.end)}\n${c.speaker ? `${c.speaker}: ` : ''}${c.text}\n`).join('\n') },
                    ] as const).map(({ label, mime, ext, fn }) => (
                      <button key={ext} onClick={() => downloadText(fn(), `transcript.${ext}`, mime)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        {label}
                      </button>
                    ))}
                    <span className="flex-1" />
                  </div>
                  <input type="text" placeholder="Search transcript…" value={transcriptSearch}
                    onChange={e => setTranscriptSearch(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                  {transcriptSearch && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{filteredCaptions.length} result{filteredCaptions.length !== 1 ? 's' : ''}</p>
                  )}
                </div>
                <div className="flex flex-col px-3 pb-3 gap-0.5">
                  {filteredCaptions.map((cap, idx) => {
                    const isActive = !transcriptSearch && captions.indexOf(cap) === activeCaptionIdx
                    const speakerColor = cap.speaker ? getSpeakerColor(cap.speaker) : 'var(--text-muted)'
                    return (
                      <div key={idx} ref={isActive ? activeCaptionRef : null}
                        onClick={() => onSeek?.(cap.start)}
                        className="flex gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors"
                        style={{ background: isActive ? 'rgba(139,92,246,0.12)' : 'transparent', borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent' }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)' }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}>
                        <div className="shrink-0 pt-0.5 flex flex-col items-end gap-1" style={{ minWidth: 36 }}>
                          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)', fontSize: 9 }}>{formatDisplayTime(cap.start)}</span>
                          {cap.speaker && <span className="text-xs font-semibold" style={{ color: speakerColor, fontSize: 8 }}>{cap.speaker.replace('Speaker ', 'S')}</span>}
                        </div>
                        <p className="text-xs leading-relaxed flex-1" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{cap.text}</p>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Clip Tab ────────────────────────────────────── */}
        {tab === 'clip' && (
          <div className="flex flex-col gap-4">
            {!selectedItem ? (
              <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="10" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  </svg>
                </div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>No clip selected</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>Click a clip in the timeline to edit its properties</p>
              </div>
            ) : (
              <>
                {/* CLIP INFO */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>CLIP INFO</p>
                  <div className="flex flex-col gap-1.5 p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{selectedItem.label}</div>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      {([
                        ['In',       formatDisplayTime(selectedItem.inPoint)],
                        ['Out',      formatDisplayTime(selectedItem.outPoint)],
                        ['Duration', formatDisplayTime(selectedItem.outPoint - selectedItem.inPoint)],
                        ['Captions', String(selectedItem.captions.length)],
                      ] as const).map(([k, v]) => (
                        <div key={k} className="flex flex-col">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</span>
                          <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* FLAGS */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>FLAGS</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(selectedItem.flags ?? []).map(f => (
                      <div key={f.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded group" style={{ background: `${f.color}22`, border: `1px solid ${f.color}66` }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.color, display: 'inline-block', flexShrink: 0 }} />
                        <button onClick={() => removeFlag(f.id)} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: f.color, lineHeight: 1, fontSize: 10 }}>×</button>
                      </div>
                    ))}
                    {FLAG_COLORS.map(c => (
                      <button key={c} onClick={() => addFlag(c)} title={`Add ${c} flag`}
                        style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', flexShrink: 0 }} />
                    ))}
                  </div>
                </div>

                {/* OPACITY */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>OPACITY</p>
                  <Slider label="Opacity" value={selectedItem.opacity ?? 100} min={0} max={100} unit="%" onChange={v => patchClip({ opacity: v })} />
                </div>

                {/* FLIP */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>FLIP</p>
                  <div className="flex gap-2">
                    {([
                      { key: 'flipH' as const, label: 'Horizontal', Icon: FlipHorizontal2 },
                      { key: 'flipV' as const, label: 'Vertical',   Icon: FlipVertical2 },
                    ] as const).map(({ key, label, Icon }) => {
                      const active = selectedItem[key] ?? false
                      return (
                        <button key={key} onClick={() => patchClip({ [key]: !active })}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs"
                          style={{ background: active ? 'var(--accent-subtle)' : 'var(--bg-card)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, color: active ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                          <Icon size={11} /> {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* FADES */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>FADE</p>
                  <div className="flex flex-col gap-2">
                    <Slider label="Fade In" value={selectedItem.fadeIn ?? 0} min={0} max={Math.min(5, (selectedItem.outPoint - selectedItem.inPoint) / 2)} step={0.1} unit="s" onChange={v => patchClip({ fadeIn: v || undefined })} />
                    <Slider label="Fade Out" value={selectedItem.fadeOut ?? 0} min={0} max={Math.min(5, (selectedItem.outPoint - selectedItem.inPoint) / 2)} step={0.1} unit="s" onChange={v => patchClip({ fadeOut: v || undefined })} />
                  </div>
                </div>

                {/* CROP & ZOOM */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>CROP & ZOOM</p>
                  <div className="flex flex-col gap-2">
                    <Slider label="Zoom" value={selectedItem.cropZoom ?? 100} min={100} max={400} unit="%" onChange={v => patchClip({ cropZoom: v })} />
                    <Slider label="Pan X" value={selectedItem.cropX ?? 0} min={-50} max={50} unit="%" onChange={v => patchClip({ cropX: v })} />
                    <Slider label="Pan Y" value={selectedItem.cropY ?? 0} min={-50} max={50} unit="%" onChange={v => patchClip({ cropY: v })} />
                    {((selectedItem.cropZoom ?? 100) !== 100 || (selectedItem.cropX ?? 0) !== 0 || (selectedItem.cropY ?? 0) !== 0) && (
                      <button onClick={() => patchClip({ cropZoom: undefined, cropX: undefined, cropY: undefined })}
                        className="text-xs text-left mt-0.5" style={{ color: 'var(--accent-light)' }}>Reset crop</button>
                    )}
                  </div>
                </div>

                {/* SPEED */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>SPEED</p>
                  <div className="flex gap-1 flex-wrap">
                    {([0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const).map(rate => {
                      const active = (selectedItem.speed ?? 1) === rate
                      return (
                        <button key={rate} onClick={() => onSpeedChange?.(selectedItem.id, rate)}
                          className="px-2 py-1 rounded text-xs font-mono"
                          style={{ background: active ? 'var(--accent-subtle)' : 'var(--bg-card)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, color: active ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                          {rate}×
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* VELOCITY RAMP */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>VELOCITY RAMP</p>
                  <div className="flex gap-1 flex-wrap">
                    {([
                      { label: 'None',     points: undefined },
                      { label: 'Ease In',  points: [{ t: 0, speed: 0.25 }, { t: 1, speed: 1 }] },
                      { label: 'Ease Out', points: [{ t: 0, speed: 1 }, { t: 1, speed: 0.25 }] },
                      { label: 'Bell',     points: [{ t: 0, speed: 0.25 }, { t: 0.5, speed: 1 }, { t: 1, speed: 0.25 }] },
                    ] as const).map(({ label, points }) => {
                      const hasRamp = !!selectedItem.speedPoints?.length
                      const isNone = label === 'None'
                      const active = isNone ? !hasRamp : JSON.stringify(selectedItem.speedPoints) === JSON.stringify(points)
                      return (
                        <button key={label}
                          onClick={() => patchClip({ speedPoints: points as any })}
                          className="px-2 py-1 rounded text-xs"
                          style={{ background: active ? 'var(--accent-subtle)' : 'var(--bg-card)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, color: active ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* MOTION BLUR */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox"
                      checked={selectedItem.motionBlurEnabled ?? false}
                      onChange={e => patchClip({ motionBlurEnabled: e.target.checked })}
                      style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>MOTION BLUR</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.65 }}>speed-proportional</span>
                  </label>
                </div>

                {/* KEN BURNS */}
                {selectedItem.contentType !== 'audio' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>KEN BURNS</p>
                      {selectedItem.kenBurns && (
                        <button onClick={() => patchClip({ kenBurns: undefined })} className="text-xs" style={{ color: 'var(--accent-light)' }}>Clear</button>
                      )}
                    </div>
                    {!selectedItem.kenBurns ? (
                      <div className="flex gap-1 flex-wrap">
                        {([
                          { label: 'Zoom In',  from: { zoom: 100, x: 0, y: 0 }, to: { zoom: 130, x: 0, y: 0 } },
                          { label: 'Zoom Out', from: { zoom: 130, x: 0, y: 0 }, to: { zoom: 100, x: 0, y: 0 } },
                          { label: 'Pan L→R',  from: { zoom: 115, x: -10, y: 0 }, to: { zoom: 115, x: 10, y: 0 } },
                          { label: 'Pan R→L',  from: { zoom: 115, x: 10, y: 0 }, to: { zoom: 115, x: -10, y: 0 } },
                        ]).map(({ label, from, to }) => (
                          <button key={label}
                            onClick={() => patchClip({ kenBurns: { fromZoom: from.zoom, fromX: from.x, fromY: from.y, toZoom: to.zoom, toX: to.x, toY: to.y } })}
                            className="px-2 py-1 rounded text-xs"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <Slider label="From Zoom" value={selectedItem.kenBurns.fromZoom} min={100} max={400} step={1} unit="%"
                          onChange={v => patchClip({ kenBurns: { ...selectedItem.kenBurns!, fromZoom: v } })} />
                        <Slider label="To Zoom"   value={selectedItem.kenBurns.toZoom}   min={100} max={400} step={1} unit="%"
                          onChange={v => patchClip({ kenBurns: { ...selectedItem.kenBurns!, toZoom: v } })} />
                        <Slider label="From X"    value={selectedItem.kenBurns.fromX}    min={-50} max={50} step={1} unit="%"
                          onChange={v => patchClip({ kenBurns: { ...selectedItem.kenBurns!, fromX: v } })} />
                        <Slider label="To X"      value={selectedItem.kenBurns.toX}      min={-50} max={50} step={1} unit="%"
                          onChange={v => patchClip({ kenBurns: { ...selectedItem.kenBurns!, toX: v } })} />
                      </div>
                    )}
                  </div>
                )}

                {/* BLEND MODE */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>BLEND MODE</p>
                  <select
                    value={selectedItem.blendMode ?? 'normal'}
                    onChange={e => patchClip({ blendMode: e.target.value === 'normal' ? undefined : e.target.value })}
                    className="w-full px-2 py-1.5 rounded text-xs"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', outline: 'none' }}>
                    {['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'].map(m => (
                      <option key={m} value={m}>{m.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                    ))}
                  </select>
                </div>

                {/* EQ */}
                {selectedItem.contentType !== 'title' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>EQ</p>
                      {selectedItem.eq && (
                        <button onClick={() => patchClip({ eq: undefined })} className="text-xs" style={{ color: 'var(--accent-light)' }}>Reset</button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Slider label="Low"  value={selectedItem.eq?.low  ?? 0} min={-12} max={12} step={0.5} unit="dB"
                        onChange={v => patchClip({ eq: { low: v, mid: selectedItem.eq?.mid ?? 0, high: selectedItem.eq?.high ?? 0 } })} />
                      <Slider label="Mid"  value={selectedItem.eq?.mid  ?? 0} min={-12} max={12} step={0.5} unit="dB"
                        onChange={v => patchClip({ eq: { low: selectedItem.eq?.low ?? 0, mid: v, high: selectedItem.eq?.high ?? 0 } })} />
                      <Slider label="High" value={selectedItem.eq?.high ?? 0} min={-12} max={12} step={0.5} unit="dB"
                        onChange={v => patchClip({ eq: { low: selectedItem.eq?.low ?? 0, mid: selectedItem.eq?.mid ?? 0, high: v } })} />
                    </div>
                  </div>
                )}

                {/* TITLE CLIP */}
                {selectedItem.contentType === 'title' && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>TITLE CLIP</p>
                    <textarea
                      value={selectedItem.titleText ?? ''}
                      onChange={e => patchClip({ titleText: e.target.value })}
                      rows={2}
                      placeholder="Enter title text…"
                      className="w-full px-2 py-1.5 rounded text-xs resize-none"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', outline: 'none' }}
                    />
                    <Slider label="Font Size" value={selectedItem.titleFontSize ?? 48} min={12} max={120} step={2} unit="px"
                      onChange={v => patchClip({ titleFontSize: v })} />
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Color</p>
                        <input type="color" value={selectedItem.titleColor ?? '#ffffff'}
                          onChange={e => patchClip({ titleColor: e.target.value })}
                          className="w-full h-7 rounded cursor-pointer" style={{ border: '1px solid var(--border)' }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Background</p>
                        <input type="color" value={selectedItem.titleBg === 'transparent' || !selectedItem.titleBg ? '#000000' : selectedItem.titleBg}
                          onChange={e => patchClip({ titleBg: e.target.value })}
                          className="w-full h-7 rounded cursor-pointer" style={{ border: '1px solid var(--border)' }} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Position</p>
                        <select value={selectedItem.titlePosition ?? 'center'} onChange={e => patchClip({ titlePosition: e.target.value as any })}
                          className="w-full px-2 py-1.5 rounded text-xs"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', outline: 'none' }}>
                          <option value="upper">Upper</option>
                          <option value="center">Center</option>
                          <option value="lower-third">Lower Third</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Animation</p>
                        <select value={selectedItem.titleAnimation ?? 'none'} onChange={e => patchClip({ titleAnimation: e.target.value as any })}
                          className="w-full px-2 py-1.5 rounded text-xs"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', outline: 'none' }}>
                          <option value="none">None</option>
                          <option value="fade">Fade</option>
                          <option value="slide-up">Slide Up</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* TRANSITION IN */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>TRANSITION IN</p>
                  <div className="flex flex-col gap-2">
                    <select value={selectedItem.transitionIn ?? 'none'}
                      onChange={(e) => {
                        const v = e.target.value as TransitionType | 'none'
                        onTransitionChange(selectedItem.id, v === 'none' ? undefined : v, selectedItem.transitionDuration ?? 0.5)
                      }}
                      className="w-full px-2 py-1.5 rounded text-xs"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', outline: 'none' }}>
                      {TRANSITIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {selectedItem.transitionIn && (
                      <Slider label="Duration" value={Math.round((selectedItem.transitionDuration ?? 0.5) * 10) / 10}
                        min={0.1} max={3} step={0.1} unit="s"
                        onChange={(v) => onTransitionChange(selectedItem.id, selectedItem.transitionIn, v)} />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Color Tab ────────────────────────────────────── */}
        {tab === 'color' && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>LIGHTING & COLOR</p>
              {!isDefaultAdj && (
                <button onClick={resetAdjustments} className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-light)' }}>
                  <RotateCcw size={10} /> Reset all
                </button>
              )}
            </div>

            {/* Primary controls */}
            <div className="flex flex-col gap-3 p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
              <Slider label="Brightness" value={adj.brightness} min={0} max={200} onChange={v => onAdjustmentsChange({ ...adj, brightness: v })} />
              <Slider label="Contrast"   value={adj.contrast}   min={0} max={200} onChange={v => onAdjustmentsChange({ ...adj, contrast: v })} />
              <Slider label="Saturation" value={adj.saturation} min={0} max={200} onChange={v => onAdjustmentsChange({ ...adj, saturation: v })} />
            </div>

            {/* Tone Curves */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>TONE CURVES</p>
              <ToneCurveEditor adj={adj} onChange={onAdjustmentsChange} />
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Drag handles · Shadows / Midtones / Highlights</p>
            </div>

            {/* Color Wheels */}
            <div>
              <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>COLOR WHEELS</p>
              <div className="flex justify-around">
                <ColorWheel label="LIFT"  value={adj.lift ?? 0}   min={-50} max={50}  defaultVal={0}   onChange={v => onAdjustmentsChange({ ...adj, lift: v })} />
                <ColorWheel label="GAMMA" value={adj.gamma ?? 100} min={50}  max={150} defaultVal={100} onChange={v => onAdjustmentsChange({ ...adj, gamma: v })} />
                <ColorWheel label="GAIN"  value={adj.gain ?? 100}  min={50}  max={150} defaultVal={100} onChange={v => onAdjustmentsChange({ ...adj, gain: v })} />
              </div>
              <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-muted)' }}>Drag up/down · Double-click to reset</p>
            </div>

            {/* Vignette */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>VIGNETTE</p>
              <Slider label="Strength" value={adj.vignette ?? 0} min={0} max={100} unit="%" onChange={v => onAdjustmentsChange({ ...adj, vignette: v })} />
            </div>

            {/* LUT */}
            {selectedItem && lutItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>LUT</p>
                <select
                  value={selectedItem.lutId ?? ''}
                  onChange={e => onClipChange(selectedItem.id, { lutId: e.target.value || undefined })}
                  className="w-full px-2 py-1.5 rounded text-xs"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', outline: 'none' }}>
                  <option value="">No LUT</option>
                  {lutItems.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
            {selectedItem && lutItems.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Import a .cube file to use a LUT</p>
            )}

            {/* Audio ducking */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox"
                  checked={audioDuckingEnabled}
                  onChange={() => onAudioDuckingToggle?.()}
                  style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>AUDIO DUCKING</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.65 }}>auto-lower music under dialogue</span>
              </label>
            </div>
          </div>
        )}

        {/* ── Outputs Tab ──────────────────────────────────── */}
        {tab === 'outputs' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>GENERATED CONTENT</p>
            {outputs.filter(o => o.type !== 'clips').length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>No documents yet.</p>
            ) : (
              outputs.filter(o => o.type !== 'clips').map((output) => {
                const Icon = outputIcons[output.type] ?? FileText
                return (
                  <div key={output.id} className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div className="flex items-start gap-2">
                      <Icon size={12} color="var(--text-muted)" className="mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{output.title}</div>
                          <CopyButton text={output.content} />
                        </div>
                        {output.wordCount && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{output.wordCount.toLocaleString()} words</div>}
                        <p className="text-xs mt-1 leading-relaxed line-clamp-3" style={{ color: 'var(--text-secondary)' }}>{output.content?.slice(0, 160)}…</p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
