'use client'

import { useState } from 'react'
import { FileText, Newspaper, AlignLeft, RotateCcw, Mic, Scissors, Sparkles, CheckCircle, AlertCircle, Loader2, Wand2, ChevronRight } from 'lucide-react'
import { formatDisplayTime } from '@/lib/captions'
import type { TimelineItem, VideoAdjustments, TransitionType } from '@/lib/editor-types'
import type { Caption, Output } from '@/lib/types'

type TranscribeStatus = 'idle' | 'transcribing' | 'done' | 'error'
type AiStatus = 'idle' | 'working' | 'done' | 'error'

interface Props {
  selectedItem: TimelineItem | null
  adjustments: VideoAdjustments
  outputs: Output[]
  onAdjustmentsChange: (a: VideoAdjustments) => void
  onTransitionChange: (id: string, type: TransitionType | undefined, duration: number) => void
  // AI tab — transcription
  importedFile: File | null
  transcribeStatus: TranscribeStatus
  transcribeProgress?: number   // 0–100 upload, 101 = Deepgram processing
  transcribeError?: string
  onTranscribe: () => void
  // AI tab — auto-edit
  captions: Caption[]
  silenceTrimStatus: AiStatus
  silenceThreshold: number
  onSilenceThresholdChange: (v: number) => void
  onSilenceTrim: () => void
  smartClipStatus: AiStatus
  onSmartClip: () => void
  genContentStatus: Record<string, AiStatus>
  onGenerateContent: (type: 'article' | 'blog_post' | 'show_notes') => void
}

type Tab = 'clip' | 'color' | 'outputs' | 'ai'

const TRANSITIONS: { value: TransitionType | 'none'; label: string }[] = [
  { value: 'none',      label: 'Cut (none)' },
  { value: 'dissolve',  label: 'Dissolve' },
  { value: 'dip_black', label: 'Dip to Black' },
  { value: 'wipe_right',label: 'Wipe Right' },
  { value: 'push',      label: 'Push' },
]

const outputIcons: Partial<Record<string, React.ElementType>> = {
  article:    FileText,
  blog_post:  Newspaper,
  show_notes: AlignLeft,
  transcript: AlignLeft,
}

function Slider({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{value}{unit ?? ''}</span>
      </div>
      <input
        type="range" className="cf-slider w-full" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--border-light) ${pct}%)` }}
      />
    </div>
  )
}

function statusIcon(status: AiStatus) {
  if (status === 'working') return <Loader2 size={13} color="var(--accent-light)" style={{ animation: 'spin 1s linear infinite' }} />
  if (status === 'done')    return <CheckCircle size={13} color="var(--success, #10b981)" />
  if (status === 'error')   return <AlertCircle size={13} color="#ef4444" />
  return <ChevronRight size={11} color="var(--text-muted)" />
}

function AiActionRow({ icon: Icon, label, description, badge, status, onClick, disabled, children }: {
  icon: React.ElementType; label: string; description: string; badge?: string
  status?: AiStatus; onClick?: () => void; disabled?: boolean; children?: React.ReactNode
}) {
  const isWorking = status === 'working'
  const isDisabled = disabled || isWorking
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={onClick}
        disabled={isDisabled}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        style={{
          opacity: isDisabled ? 0.5 : 1,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
        }}
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

export default function Inspector({
  selectedItem, adjustments, outputs, onAdjustmentsChange, onTransitionChange,
  importedFile, transcribeStatus, transcribeProgress = 0, transcribeError, onTranscribe,
  captions,
  silenceTrimStatus, silenceThreshold, onSilenceThresholdChange, onSilenceTrim,
  smartClipStatus, onSmartClip,
  genContentStatus, onGenerateContent,
}: Props) {
  const [tab, setTab] = useState<Tab>('ai')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'ai',      label: 'AI' },
    { id: 'clip',    label: 'Clip' },
    { id: 'color',   label: 'Color' },
    { id: 'outputs', label: 'Outputs' },
  ]

  function resetAdjustments() {
    onAdjustmentsChange({ brightness: 100, contrast: 100, saturation: 100, highlights: 0 })
  }

  const isDefaultAdj = adjustments.brightness === 100 && adjustments.contrast === 100 &&
    adjustments.saturation === 100 && adjustments.highlights === 0

  return (
    <div className="flex flex-col h-full select-none" style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}>

      {/* Tab bar */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 py-2 text-xs font-medium transition-colors"
            style={{
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">

        {/* ── AI Tab ─────────────────────────────────────── */}
        {tab === 'ai' && (
          <div className="flex flex-col gap-5">

            {/* Transcribe */}
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
                  {/* Progress bar */}
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-light)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: transcribeProgress <= 100 ? `${transcribeProgress}%` : '100%',
                        background: transcribeProgress <= 100 ? 'var(--accent)' : 'linear-gradient(90deg, var(--accent), var(--accent-light))',
                        backgroundSize: transcribeProgress > 100 ? '200% 100%' : undefined,
                        animation: transcribeProgress > 100 ? 'pulse 1.5s ease-in-out infinite' : undefined,
                      }}
                    />
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {transcribeProgress <= 100
                      ? 'Sending directly to Deepgram…'
                      : 'File received — transcription in progress'}
                  </p>
                </div>
              ) : transcribeStatus === 'done' ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <CheckCircle size={13} color="#10b981" />
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#10b981' }}>Transcription complete</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Captions added to timeline</p>
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
                  <button
                    onClick={onTranscribe}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-medium"
                    style={{ background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                  >
                    <Mic size={12} /> Transcribe Media
                  </button>
                </div>
              )}
            </div>

            {/* Auto-edit */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>AUTO-EDIT</p>
              <div className="flex flex-col gap-1.5">
                <AiActionRow
                  icon={Sparkles}
                  label="Auto-Silence Trim"
                  description={captions.length ? `Remove pauses >${silenceThreshold}s` : 'Transcribe first to enable'}
                  status={silenceTrimStatus}
                  onClick={onSilenceTrim}
                  disabled={!captions.length || silenceTrimStatus === 'working'}
                >
                  {captions.length > 0 && (
                    <div className="px-3 pb-2.5 flex items-center gap-2">
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Threshold</span>
                      <input
                        type="range" className="cf-slider flex-1" min={0.2} max={3} step={0.1}
                        value={silenceThreshold}
                        onChange={(e) => onSilenceThresholdChange(Number(e.target.value))}
                        style={{ background: `linear-gradient(to right, var(--accent) ${((silenceThreshold - 0.2) / 2.8) * 100}%, var(--border-light) ${((silenceThreshold - 0.2) / 2.8) * 100}%)` }}
                      />
                      <span className="text-xs font-mono shrink-0" style={{ color: 'var(--text-muted)', minWidth: 28 }}>{silenceThreshold.toFixed(1)}s</span>
                    </div>
                  )}
                </AiActionRow>
                <AiActionRow
                  icon={Wand2}
                  label="Smart Clip"
                  description={captions.length ? 'Pick highlight moments with AI' : 'Transcribe first to enable'}
                  status={smartClipStatus}
                  onClick={onSmartClip}
                  disabled={!captions.length || smartClipStatus === 'working'}
                />
                <AiActionRow
                  icon={Scissors}
                  label="Detect Scenes"
                  description="Find cut points automatically"
                  badge="soon"
                  disabled
                />
              </div>
            </div>

            {/* Generate content */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>GENERATE CONTENT</p>
              <div className="flex flex-col gap-1.5">
                <AiActionRow
                  icon={FileText}
                  label="Write Article"
                  description={captions.length ? 'Long-form from transcript' : 'Transcribe first to enable'}
                  status={genContentStatus['article']}
                  onClick={() => onGenerateContent('article')}
                  disabled={!captions.length || genContentStatus['article'] === 'working'}
                />
                <AiActionRow
                  icon={Newspaper}
                  label="Blog Post"
                  description={captions.length ? 'SEO-ready summary' : 'Transcribe first to enable'}
                  status={genContentStatus['blog_post']}
                  onClick={() => onGenerateContent('blog_post')}
                  disabled={!captions.length || genContentStatus['blog_post'] === 'working'}
                />
                <AiActionRow
                  icon={AlignLeft}
                  label="Show Notes"
                  description={captions.length ? 'Podcast episode notes' : 'Transcribe first to enable'}
                  status={genContentStatus['show_notes']}
                  onClick={() => onGenerateContent('show_notes')}
                  disabled={!captions.length || genContentStatus['show_notes'] === 'working'}
                />
              </div>
            </div>
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

                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>TRANSITION IN</p>
                  <div className="flex flex-col gap-2">
                    <select
                      value={selectedItem.transitionIn ?? 'none'}
                      onChange={(e) => {
                        const v = e.target.value as TransitionType | 'none'
                        onTransitionChange(selectedItem.id, v === 'none' ? undefined : v, selectedItem.transitionDuration ?? 0.5)
                      }}
                      className="w-full px-2 py-1.5 rounded text-xs"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', outline: 'none' }}
                    >
                      {TRANSITIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {selectedItem.transitionIn && (
                      <Slider
                        label="Duration"
                        value={Math.round((selectedItem.transitionDuration ?? 0.5) * 10) / 10}
                        min={0.1} max={3} unit="s"
                        onChange={(v) => onTransitionChange(selectedItem.id, selectedItem.transitionIn, v)}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Color Tab ────────────────────────────────────── */}
        {tab === 'color' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>LIGHTING & COLOR</p>
              {!isDefaultAdj && (
                <button onClick={resetAdjustments} className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-light)' }}>
                  <RotateCcw size={10} /> Reset
                </button>
              )}
            </div>
            <div className="flex flex-col gap-4 p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
              <Slider label="Brightness" value={adjustments.brightness} min={0} max={200} onChange={(v) => onAdjustmentsChange({ ...adjustments, brightness: v })} />
              <Slider label="Contrast"   value={adjustments.contrast}   min={0} max={200} onChange={(v) => onAdjustmentsChange({ ...adjustments, contrast: v })} />
              <Slider label="Saturation" value={adjustments.saturation} min={0} max={200} onChange={(v) => onAdjustmentsChange({ ...adjustments, saturation: v })} />
              <Slider label="Highlights" value={adjustments.highlights} min={-100} max={100} onChange={(v) => onAdjustmentsChange({ ...adjustments, highlights: v })} />
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Adjustments apply to the active viewer. Export includes these settings as metadata.
            </p>
          </div>
        )}

        {/* ── Outputs Tab ──────────────────────────────────── */}
        {tab === 'outputs' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>GENERATED CONTENT</p>
            {outputs.filter(o => o.type !== 'clips').length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>
                No outputs yet. Transcribe a file to generate content.
              </p>
            ) : (
              outputs.filter(o => o.type !== 'clips').map((output) => {
                const Icon = outputIcons[output.type] ?? FileText
                return (
                  <div key={output.id} className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div className="flex items-start gap-2">
                      <Icon size={12} color="var(--text-muted)" className="mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{output.title}</div>
                        {output.wordCount && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{output.wordCount.toLocaleString()} words</div>}
                        <p className="text-xs mt-1 leading-relaxed line-clamp-3" style={{ color: 'var(--text-secondary)' }}>
                          {output.content?.slice(0, 160)}…
                        </p>
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
