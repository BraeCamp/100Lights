'use client'

import { useState, useRef } from 'react'
import { Scissors, FileText, Newspaper, AlignLeft, Plus, FolderOpen } from 'lucide-react'
import { formatDisplayTime } from '@/lib/captions'
import type { Output } from '@/lib/types'
import type { TimelineItem } from '@/lib/editor-types'

interface Props {
  timelineItems: TimelineItem[]
  outputs: Output[]
  selectedId: string | null
  onSelectItem: (id: string) => void
  onAddToTimeline: (item: TimelineItem) => void
  onImportFile?: (file: File) => void
}

const outputIcons: Partial<Record<string, React.ElementType>> = {
  article: FileText,
  blog_post: Newspaper,
  show_notes: AlignLeft,
}

export default function MediaPool({ timelineItems, outputs, selectedId, onSelectItem, onAddToTimeline, onImportFile }: Props) {
  const [tab, setTab] = useState<'clips' | 'outputs'>('clips')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && onImportFile) onImportFile(file)
    e.target.value = ''
  }

  const textOutputs = outputs.filter((o) => o.type !== 'clips' && o.type !== 'transcript')

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
    >
      {onImportFile && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={handleFileInput}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 mx-2 mt-2 mb-1 px-3 py-2 rounded-lg text-xs font-medium w-[calc(100%-16px)]"
            style={{ background: 'var(--accent-subtle)', color: 'var(--accent-light)', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            <FolderOpen size={13} /> Import Media
          </button>
        </>
      )}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {(['clips', 'outputs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2.5 text-xs font-semibold capitalize transition-colors"
            style={{
              color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {tab === 'clips' && (
          <>
            <p className="text-xs px-1 py-1.5 font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Timeline
            </p>
            {timelineItems.length === 0 && (
              <p className="text-xs px-2 py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                No clips yet
              </p>
            )}
            {timelineItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelectItem(item.id)}
                className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-left transition-colors"
                style={{
                  background: selectedId === item.id ? 'var(--accent-subtle)' : 'transparent',
                  border: `1px solid ${selectedId === item.id ? item.color + '60' : 'transparent'}`,
                }}
              >
                <div className="w-2 h-8 rounded-sm shrink-0" style={{ background: item.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {item.label}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {formatDisplayTime(item.inPoint)} – {formatDisplayTime(item.outPoint)}
                  </div>
                </div>
              </button>
            ))}
          </>
        )}

        {tab === 'outputs' && (
          <>
            <p className="text-xs px-1 py-1.5 font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Generated content
            </p>
            {textOutputs.length === 0 && (
              <p className="text-xs px-2 py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                No written outputs yet
              </p>
            )}
            {textOutputs.map((output) => {
              const Icon = outputIcons[output.type] ?? FileText
              return (
                <div
                  key={output.id}
                  className="flex items-start gap-2 px-2 py-2 rounded-lg"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                >
                  <Icon size={13} color="var(--text-muted)" className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {output.title}
                    </div>
                    {output.wordCount && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {output.wordCount.toLocaleString()} words
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
