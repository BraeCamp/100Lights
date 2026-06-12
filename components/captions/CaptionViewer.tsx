'use client'

import { Download } from 'lucide-react'
import { formatDisplayTime, downloadCaption } from '@/lib/captions'
import type { Caption } from '@/lib/types'

interface Props {
  captions: Caption[]
  filename?: string
  maxHeight?: string
}

export default function CaptionViewer({ captions, filename = 'transcript', maxHeight = '320px' }: Props) {
  const speakers = Array.from(new Set(captions.map((c) => c.speaker).filter(Boolean)))
  const speakerColors: Record<string, string> = {}
  const palette = ['var(--accent-light)', '#3b82f6', '#10b981', '#f59e0b']
  speakers.forEach((s, i) => { speakerColors[s!] = palette[i % palette.length] })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {captions.length} captions
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCaption(filename, captions, 'srt')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
            style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Download size={11} />
            SRT
          </button>
          <button
            onClick={() => downloadCaption(filename, captions, 'vtt')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
            style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Download size={11} />
            VTT
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex flex-col gap-1" style={{ maxHeight }}>
        {captions.map((caption, i) => (
          <div key={i} className="flex gap-3 items-start py-1.5 px-2 rounded-lg group">
            <span
              className="text-xs font-mono shrink-0 mt-0.5"
              style={{ color: 'var(--text-muted)', minWidth: '2.8rem' }}
            >
              {formatDisplayTime(caption.start)}
            </span>
            <div className="flex-1 min-w-0">
              {caption.speaker && (
                <span
                  className="text-xs font-semibold mr-1.5"
                  style={{ color: speakerColors[caption.speaker] ?? 'var(--text-muted)' }}
                >
                  {caption.speaker}
                </span>
              )}
              <span className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {caption.text}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
