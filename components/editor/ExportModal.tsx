'use client'

import { useState, useRef } from 'react'
import { X, Download, Film, AlertCircle, CheckCircle2 } from 'lucide-react'
import { exportTimeline, type ExportOptions, type ExportProgress, type ExportClip } from '@/lib/exporter'
import type { Caption } from '@/lib/types'
import type { TimelineItem, MediaItem } from '@/lib/editor-types'

interface Props {
  projectName: string
  timelineItems: TimelineItem[]
  mediaItems: MediaItem[]
  captions?: Caption[]
  inPoint?: number | null
  outPoint?: number | null
  onClose: () => void
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const EXPORT_PRESETS = [
  { id: 'youtube', label: 'YouTube', desc: '1080p · High quality', quality: 'high'   as const, resolution: '1080p'    as const },
  { id: 'web',     label: 'Web',     desc: '720p · Balanced',      quality: 'medium' as const, resolution: '720p'     as const },
  { id: 'draft',   label: 'Draft',   desc: '480p · Fast export',   quality: 'web'    as const, resolution: '480p'     as const },
] as const

const QUALITIES = [
  { id: 'high',   label: 'High',   desc: 'Best quality · largest file' },
  { id: 'medium', label: 'Medium', desc: 'Balanced (recommended)' },
  { id: 'web',    label: 'Web',    desc: 'Small file · fastest encode' },
] as const

const RESOLUTIONS = [
  { id: 'original', label: 'Original' },
  { id: '1080p',    label: '1080p' },
  { id: '720p',     label: '720p' },
  { id: '480p',     label: '480p' },
] as const

export default function ExportModal({ projectName, timelineItems, mediaItems, captions, inPoint, outPoint, onClose }: Props) {
  const [quality, setQuality]         = useState<ExportOptions['quality']>('medium')
  const [resolution, setResolution]   = useState<ExportOptions['resolution']>('original')
  const [progress, setProgress]       = useState<ExportProgress | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [burnInSubs, setBurnInSubs]   = useState(false)
  const [useRange, setUseRange]       = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const hasRange = inPoint != null && outPoint != null && outPoint > inPoint
  const rangeStart = (useRange && hasRange) ? inPoint! : null
  const rangeEnd   = (useRange && hasRange) ? outPoint! : null

  const allClips = timelineItems.filter(
    i => i.enabled !== false && i.url && (i.contentType === 'video' || i.contentType === 'audio' || !i.contentType),
  )
  const exportableClips = rangeStart !== null && rangeEnd !== null
    ? allClips.filter(i => {
        const clipEnd = i.startTime + (i.outPoint - i.inPoint)
        return clipEnd > rangeStart! && i.startTime < rangeEnd!
      })
    : allClips

  const isAudioOnly   = exportableClips.length > 0 && exportableClips.every(i => i.contentType === 'audio')
  const canExport     = exportableClips.length > 0 && !progress

  function buildExportClips(): ExportClip[] {
    return exportableClips
      .sort((a, b) => a.startTime - b.startTime)
      .map(item => {
        const media = mediaItems.find(m => m.url === item.url)
        let trimIn = item.inPoint, trimOut = item.outPoint

        if (rangeStart !== null && rangeEnd !== null) {
          const clipEnd = item.startTime + (item.outPoint - item.inPoint)
          if (item.startTime < rangeStart) trimIn = item.inPoint + (rangeStart - item.startTime)
          if (clipEnd > rangeEnd) trimOut = item.outPoint - (clipEnd - rangeEnd)
        }

        return {
          id:          item.id,
          label:       item.label,
          inPoint:     trimIn,
          outPoint:    trimOut,
          contentType: item.contentType ?? 'video',
          file:        media?.file,
          url:         item.url,
        }
      })
  }

  async function handleExport() {
    setError(null)
    setDownloadUrl(null)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const blob = await exportTimeline(
        buildExportClips(),
        { quality, resolution },
        setProgress,
        controller.signal,
      )
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgress(null)
      } else {
        setError(err instanceof Error ? err.message : 'Export failed')
        setProgress(null)
      }
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
  }

  function handleDownload() {
    if (!downloadUrl) return
    const slug = projectName.toLowerCase().replace(/\s+/g, '-')
    const a = Object.assign(document.createElement('a'), {
      href:     downloadUrl,
      download: isAudioOnly ? `${slug}.m4a` : `${slug}.mp4`,
    })
    a.click()
  }

  function handleClose() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    onClose()
  }

  const isExporting = !!progress && progress.phase !== 'done' && progress.phase !== 'error'
  const isDone      = progress?.phase === 'done'

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget && !isExporting) handleClose() }}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{ width: 440, background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <Film size={16} color="var(--accent)" />
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Export Video</span>
          </div>
          {!isExporting && (
            <button onClick={handleClose} className="p-1 rounded" style={{ color: 'var(--text-muted)' }}>
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-5 flex flex-col gap-5">

          {/* Settings — hidden during export */}
          {!isExporting && !isDone && (
            <>
              {/* Quick presets */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Quick Preset</p>
                <div className="flex gap-2">
                  {EXPORT_PRESETS.map(p => {
                    const active = quality === p.quality && resolution === p.resolution
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setQuality(p.quality); setResolution(p.resolution) }}
                        className="flex-1 flex flex-col items-center py-2.5 px-2 rounded-lg text-xs"
                        style={{
                          background: active ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          color: active ? 'var(--accent-light)' : 'var(--text-secondary)',
                        }}
                      >
                        <span className="font-semibold">{p.label}</span>
                        <span className="text-center leading-tight mt-0.5" style={{ fontSize: 10, opacity: 0.7 }}>{p.desc}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Quality */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Quality</p>
                <div className="flex gap-2">
                  {QUALITIES.map(q => (
                    <button
                      key={q.id}
                      onClick={() => setQuality(q.id)}
                      className="flex-1 flex flex-col items-center py-2.5 px-2 rounded-lg text-xs"
                      style={{
                        background: quality === q.id ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                        border: `1px solid ${quality === q.id ? 'var(--accent)' : 'var(--border)'}`,
                        color: quality === q.id ? 'var(--accent-light)' : 'var(--text-secondary)',
                      }}
                    >
                      <span className="font-semibold">{q.label}</span>
                      <span className="text-center leading-tight mt-0.5" style={{ fontSize: 10, opacity: 0.7 }}>{q.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Resolution</p>
                <div className="flex gap-2">
                  {RESOLUTIONS.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setResolution(r.id)}
                      className="flex-1 py-2 rounded-lg text-xs font-medium"
                      style={{
                        background: resolution === r.id ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                        border: `1px solid ${resolution === r.id ? 'var(--accent)' : 'var(--border)'}`,
                        color: resolution === r.id ? 'var(--accent-light)' : 'var(--text-secondary)',
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="flex flex-col gap-2">
                {hasRange && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={useRange} onChange={e => setUseRange(e.target.checked)}
                      className="rounded" style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Export In/Out range only
                      <span className="ml-1.5 font-mono" style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                        ({fmtTime(inPoint!)}–{fmtTime(outPoint!)})
                      </span>
                    </span>
                  </label>
                )}
                {captions && captions.length > 0 && !isAudioOnly && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={burnInSubs} onChange={e => setBurnInSubs(e.target.checked)}
                      className="rounded" style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Burn-in subtitles
                      <span className="ml-1.5" style={{ color: 'var(--text-muted)', fontSize: 10 }}>({captions.length} utterances)</span>
                    </span>
                  </label>
                )}
              </div>

              {/* Clip summary */}
              <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                {exportableClips.length > 0
                  ? <>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {exportableClips.length} {isAudioOnly ? 'audio' : 'media'} clip{exportableClips.length !== 1 ? 's' : ''}
                        {useRange && hasRange ? ' (in range)' : ''}
                      </span>{' '}
                      will be encoded and merged into a single {isAudioOnly ? 'M4A' : 'MP4'}.
                      {burnInSubs && ' Subtitles will be embedded.'}
                    </>
                  : <span style={{ color: '#ef4444' }}>No clips on the timeline. Add video or audio clips before exporting.</span>
                }
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </>
          )}

          {/* Progress */}
          {isExporting && progress && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{progress.message}</p>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%`, background: 'var(--accent)' }}
                />
              </div>
              <p className="text-xs text-right" style={{ color: 'var(--text-muted)' }}>{progress.percent}%</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                FFmpeg is running in your browser — this may take a few minutes depending on clip length and quality settings. You can keep working in another tab.
              </p>
            </div>
          )}

          {/* Done */}
          {isDone && (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.12)' }}>
                <CheckCircle2 size={24} color="#22c55e" />
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Export complete</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Your video is ready to download.</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-4"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {isExporting ? (
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              Cancel Export
            </button>
          ) : isDone ? (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                Close
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
              >
                <Download size={14} /> Download MP4
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={!canExport}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: canExport ? 'var(--accent)' : 'var(--bg-surface)',
                  color: canExport ? '#fff' : 'var(--text-muted)',
                  border: canExport ? 'none' : '1px solid var(--border)',
                  cursor: canExport ? 'pointer' : 'default',
                }}
              >
                <Film size={14} /> {isAudioOnly ? 'Export Audio' : 'Export'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
