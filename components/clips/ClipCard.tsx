'use client'

import { Scissors, Download, Sparkles } from 'lucide-react'
import { formatDisplayTime, downloadCaption } from '@/lib/captions'
import CaptionViewer from '@/components/captions/CaptionViewer'
import type { Clip } from '@/lib/types'

interface Props {
  clip: Clip
  index: number
}

export default function ClipCard({ clip, index }: Props) {
  const duration = clip.end - clip.start

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold"
            style={{ background: 'var(--accent-subtle)', color: 'var(--accent-light)' }}
          >
            {index + 1}
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {clip.title}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {formatDisplayTime(clip.start)} – {formatDisplayTime(clip.end)}
              {' · '}
              {Math.round(duration)}s
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCaption(`${clip.title.toLowerCase().replace(/\s+/g, '-')}`, clip.captions, 'srt')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Download size={11} />
            SRT
          </button>
          <button
            onClick={() => downloadCaption(`${clip.title.toLowerCase().replace(/\s+/g, '-')}`, clip.captions, 'vtt')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Download size={11} />
            VTT
          </button>
        </div>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
          style={{ background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.15)' }}
        >
          <Sparkles size={13} color="#f59e0b" className="shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed" style={{ color: '#d4a24a' }}>
            {clip.reason}
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Scissors size={12} color="var(--text-muted)" />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Caption track
            </span>
          </div>
          <CaptionViewer
            captions={clip.captions}
            filename={clip.title.toLowerCase().replace(/\s+/g, '-')}
            maxHeight="200px"
          />
        </div>
      </div>
    </div>
  )
}
