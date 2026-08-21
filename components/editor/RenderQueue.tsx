'use client'

import { useState, useRef } from 'react'
import { X, Film, Download, Trash2, Plus, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { exportTimeline, type ExportOptions, type ExportProgress, type ExportClip } from '@/lib/exporter'
import type { GradeNode } from '@/lib/editor-types'
import { exportTimelineFidelity } from '@/lib/video-export'
import type { Caption } from '@/lib/types'
import type { TimelineItem, MediaItem, Track, VideoAdjustments, ProjectAspect, CaptionStyle } from '@/lib/editor-types'
import { DEFAULT_ADJUSTMENTS } from '@/lib/editor-types'
import type { LutData } from '@/lib/lut-parser'

export interface RenderJob {
  id: string
  name: string
  quality: ExportOptions['quality']
  resolution: ExportOptions['resolution']
  inPoint: number | null
  outPoint: number | null
  status: 'queued' | 'running' | 'done' | 'error'
  progress: ExportProgress | null
  downloadUrl: string | null
  downloadExt: 'mp4' | 'webm' | 'm4a'
  error: string | null
  isAudioOnly: boolean
}

interface Props {
  timelineItems: TimelineItem[]
  mediaItems: MediaItem[]
  tracks?: Track[]
  adjustments?: VideoAdjustments
  aspect?: ProjectAspect
  captions?: Caption[]
  captionStyle?: CaptionStyle
  luts?: Map<string, LutData>
  lookNodes?: GradeNode[]
  projectName: string
  inPoint: number | null
  outPoint: number | null
  onClose: () => void
  inline?: boolean  // when true, renders without the modal backdrop
}


// Delivery presets — a preset does nothing magic: it fills the settings below.
// The point is that a destination ("YouTube") is a thing people know, whereas
// a quality/resolution pair is a thing they have to guess at.
const DELIVERY_PRESETS: Array<{
  id: string; label: string; hint: string
  quality: ExportOptions['quality']; resolution: ExportOptions['resolution']
}> = [
  // Uploading a larger frame makes YouTube pick a better encoding ladder, so
  // the same footage survives their compression looking cleaner.
  { id: 'youtube', label: 'YouTube',  hint: 'high quality, 1080p — upload big, let YouTube compress', quality: 'high',   resolution: '1080p' },
  { id: 'social',  label: 'Social',   hint: 'balanced 1080p for Instagram / TikTok',                  quality: 'medium', resolution: '1080p' },
  { id: 'draft',   label: 'Draft',    hint: 'fast 720p for review copies',                            quality: 'web',    resolution: '720p'  },
  { id: 'master',  label: 'Master',   hint: 'highest quality at the source resolution — keep this one', quality: 'high',  resolution: 'original' },
]

const QUALITIES: ExportOptions['quality'][] = ['high', 'medium', 'web']
const RESOLUTIONS: ExportOptions['resolution'][] = ['original', '1080p', '720p', '480p']

function buildClips(
  timelineItems: TimelineItem[],
  mediaItems: MediaItem[],
  inPoint: number | null,
  outPoint: number | null,
): ExportClip[] {
  const useRange = inPoint != null && outPoint != null && outPoint > inPoint
  const clips = timelineItems.filter(
    i => i.enabled !== false && i.url &&
      (i.contentType === 'video' || i.contentType === 'audio' || !i.contentType),
  )
  const scoped = useRange
    ? clips.filter(i => {
        const end = i.startTime + (i.outPoint - i.inPoint)
        return end > inPoint! && i.startTime < outPoint!
      })
    : clips

  return scoped
    .sort((a, b) => a.startTime - b.startTime)
    .map(item => {
      const media = mediaItems.find(m => m.url === item.url)
      let trimIn = item.inPoint, trimOut = item.outPoint
      if (useRange) {
        const end = item.startTime + (item.outPoint - item.inPoint)
        if (item.startTime < inPoint!) trimIn = item.inPoint + (inPoint! - item.startTime)
        if (end > outPoint!) trimOut = item.outPoint - (end - outPoint!)
      }
      return {
        id: item.id,
        label: item.label,
        inPoint: trimIn,
        outPoint: trimOut,
        contentType: item.contentType ?? 'video',
        file: media?.file,
        url: item.url,
      }
    })
}

export default function RenderQueue({ timelineItems, mediaItems, tracks = [], adjustments = DEFAULT_ADJUSTMENTS, aspect = '16:9', captions = [], captionStyle, luts, lookNodes, projectName, inPoint, outPoint, onClose, inline }: Props) {
  const [jobs, setJobs] = useState<RenderJob[]>([])
  const [draftQuality, setDraftQuality] = useState<ExportOptions['quality']>('medium')
  const [draftRes, setDraftRes] = useState<ExportOptions['resolution']>('original')
  const [draftRange, setDraftRange] = useState(false)
  const abortRefs = useRef<Map<string, AbortController>>(new Map())

  const hasRange = inPoint != null && outPoint != null && outPoint > inPoint
  const isRunning = jobs.some(j => j.status === 'running')

  function addJob() {
    const clips = buildClips(
      timelineItems, mediaItems,
      draftRange && hasRange ? inPoint : null,
      draftRange && hasRange ? outPoint : null,
    )
    const isAudioOnly = clips.length > 0 && clips.every(c => c.contentType === 'audio')
    const rangeTag = draftRange && hasRange ? ` (range)` : ''
    const job: RenderJob = {
      id: crypto.randomUUID(),
      name: `${projectName} · ${draftRes} ${draftQuality}${rangeTag}`,
      quality: draftQuality,
      resolution: draftRes,
      inPoint: draftRange && hasRange ? inPoint : null,
      outPoint: draftRange && hasRange ? outPoint : null,
      status: 'queued',
      progress: null,
      downloadUrl: null,
      downloadExt: isAudioOnly ? 'm4a' : 'mp4',
      error: null,
      isAudioOnly,
    }
    setJobs(prev => [...prev, job])
  }

  async function runJob(job: RenderJob) {
    const controller = new AbortController()
    abortRefs.current.set(job.id, controller)

    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'running', progress: null, error: null } : j))

    try {
      let blob: Blob
      if (job.isAudioOnly) {
        // Audio-only → fast ffmpeg trim+concat (.m4a).
        const clips = buildClips(timelineItems, mediaItems, job.inPoint, job.outPoint)
        blob = await exportTimeline(
          clips,
          { quality: job.quality, resolution: job.resolution },
          (p) => setJobs(prev => prev.map(j => j.id === job.id ? { ...j, progress: p } : j)),
          controller.signal,
        )
      } else {
        // Video → the same full-fidelity pipeline as the Export button, so the
        // Deliver page bakes in grades/titles/captions/transitions identically.
        const useRange = job.inPoint != null && job.outPoint != null && job.outPoint > job.inPoint
        blob = await exportTimelineFidelity({
          lookNodes,
          timelineItems,
          tracks,
          adjustments,
          captions,
          captionStyle,
          luts,
          quality: job.quality,
          resolution: job.resolution,
          aspect,
          range: useRange ? { start: job.inPoint!, end: job.outPoint! } : null,
          onProgress: (frac, message) => setJobs(prev => prev.map(j =>
            j.id === job.id ? { ...j, progress: { phase: 'encoding', percent: Math.round(frac * 100), message } } : j)),
          signal: controller.signal,
        })
      }
      const ext: RenderJob['downloadExt'] = job.isAudioOnly ? 'm4a' : blob.type.includes('mp4') ? 'mp4' : 'webm'
      const url = URL.createObjectURL(blob)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'done', downloadUrl: url, downloadExt: ext, progress: null } : j))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'queued', progress: null } : j))
      } else {
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'error', error: err instanceof Error ? err.message : 'Export failed', progress: null } : j))
      }
    } finally {
      abortRefs.current.delete(job.id)
    }
  }

  async function runAll() {
    for (const job of jobs.filter(j => j.status === 'queued')) {
      await runJob(job)
    }
  }

  function cancelJob(id: string) {
    abortRefs.current.get(id)?.abort()
  }

  function removeJob(id: string) {
    cancelJob(id)
    const job = jobs.find(j => j.id === id)
    if (job?.downloadUrl) URL.revokeObjectURL(job.downloadUrl)
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  function downloadJob(job: RenderJob) {
    if (!job.downloadUrl) return
    const slug = job.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const a = Object.assign(document.createElement('a'), {
      href: job.downloadUrl,
      download: `${slug}.${job.downloadExt}`,
    })
    a.click()
  }

  const queuedCount = jobs.filter(j => j.status === 'queued').length

  const inner = (
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={inline
          ? { width: '100%', height: '100%', background: 'var(--bg-base)', border: 'none', borderRadius: 0 }
          : { width: 540, maxHeight: '80vh', background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <Film size={16} color="var(--accent)" />
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Render Queue</span>
            {jobs.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-light)' }}>
                {jobs.length}
              </span>
            )}
          </div>
          {!isRunning && (
            <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--text-muted)' }}>
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">
          {/* Add job form */}
          <div className="rounded-lg p-3 flex flex-col gap-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>NEW JOB</p>

            {/* Presets fill the settings below — pick a destination, not a codec */}
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Preset</p>
              <div className="flex gap-1 flex-wrap">
                {DELIVERY_PRESETS.map(pre => {
                  const active = draftQuality === pre.quality && draftRes === pre.resolution
                  return (
                    <button key={pre.id}
                      data-delivery-preset={pre.id}
                      onClick={() => { setDraftQuality(pre.quality); setDraftRes(pre.resolution) }}
                      title={pre.hint}
                      className="px-2 py-1 rounded text-xs"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--bg-card)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        color: active ? '#0b0d10' : 'var(--text-secondary)',
                        fontWeight: active ? 700 : 400,
                      }}>
                      {pre.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Quality</p>
                <div className="flex gap-1">
                  {QUALITIES.map(q => (
                    <button key={q} onClick={() => setDraftQuality(q)}
                      className="flex-1 py-1 rounded text-xs"
                      style={{ background: draftQuality === q ? 'var(--accent-subtle)' : 'var(--bg-card)', border: `1px solid ${draftQuality === q ? 'var(--accent)' : 'var(--border)'}`, color: draftQuality === q ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Resolution</p>
                <div className="flex gap-1">
                  {RESOLUTIONS.map(r => (
                    <button key={r} onClick={() => setDraftRes(r)}
                      className="flex-1 py-1 rounded text-xs"
                      style={{ background: draftRes === r ? 'var(--accent-subtle)' : 'var(--bg-card)', border: `1px solid ${draftRes === r ? 'var(--accent)' : 'var(--border)'}`, color: draftRes === r ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {hasRange && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={draftRange} onChange={e => setDraftRange(e.target.checked)}
                  style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Use In/Out range</span>
              </label>
            )}

            <button onClick={addJob}
              className="flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium"
              style={{ background: 'var(--accent-subtle)', border: '1px solid var(--accent)', color: 'var(--accent-light)' }}>
              <Plus size={12} /> Add to Queue
            </button>
          </div>

          {/* Job list */}
          {jobs.length > 0 && (
            <div className="flex flex-col gap-2">
              {jobs.map(job => (
                <div key={job.id} className="rounded-lg p-3 flex flex-col gap-2"
                  style={{ background: 'var(--bg-surface)', border: `1px solid ${job.status === 'error' ? 'rgba(239,68,68,0.3)' : 'var(--border)'}` }}>
                  <div className="flex items-center gap-2">
                    {job.status === 'queued'  && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--text-muted)' }} />}
                    {job.status === 'running' && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />}
                    {job.status === 'done'    && <CheckCircle2 size={12} color="#22c55e" />}
                    {job.status === 'error'   && <AlertCircle size={12} color="#ef4444" />}
                    <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-primary)' }}>{job.name}</span>
                    <div className="flex items-center gap-1">
                      {job.status === 'done' && (
                        <button onClick={() => downloadJob(job)} className="p-1 rounded" title="Download"
                          style={{ color: '#22c55e' }}>
                          <Download size={12} />
                        </button>
                      )}
                      {job.status === 'running' ? (
                        <button onClick={() => cancelJob(job.id)} className="p-1 rounded text-xs"
                          style={{ color: '#ef4444' }}>Cancel</button>
                      ) : (
                        <button onClick={() => removeJob(job.id)} className="p-1 rounded"
                          style={{ color: 'var(--text-muted)' }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  {job.status === 'running' && job.progress && (
                    <div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                        <div className="h-full rounded-full transition-all duration-200" style={{ width: `${job.progress.percent}%`, background: 'var(--accent)' }} />
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{job.progress.message} · {job.progress.percent}%</p>
                    </div>
                  )}
                  {job.status === 'error' && (
                    <p className="text-xs" style={{ color: '#f87171' }}>{job.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {jobs.length === 0 && (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>
              Queue is empty. Add a job above to batch export multiple formats.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {queuedCount > 0 ? `${queuedCount} job${queuedCount !== 1 ? 's' : ''} queued` : 'No jobs queued'}
          </p>
          <div className="flex gap-2">
            {!isRunning && <button onClick={onClose} className="px-3 py-1.5 rounded text-xs"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              Close
            </button>}
            <button onClick={runAll} disabled={queuedCount === 0 || isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
              style={{
                background: queuedCount > 0 && !isRunning ? 'var(--accent)' : 'var(--bg-surface)',
                color: queuedCount > 0 && !isRunning ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${queuedCount > 0 && !isRunning ? 'transparent' : 'var(--border)'}`,
                cursor: queuedCount > 0 && !isRunning ? 'pointer' : 'default',
              }}>
              {isRunning ? <><Loader2 size={12} className="animate-spin" /> Rendering…</> : <><Film size={12} /> Render All</>}
            </button>
          </div>
        </div>
      </div>
  )

  if (inline) return inner

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget && !isRunning) onClose() }}
    >
      {inner}
    </div>
  )
}
