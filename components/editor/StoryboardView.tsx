'use client'

import { useState } from 'react'
import { X, GripVertical } from 'lucide-react'
import type { TimelineItem, MediaItem } from '@/lib/editor-types'

interface Props {
  items: TimelineItem[]
  mediaItems: MediaItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onSeek: (t: number) => void
  onReorder: (draggedId: string, targetId: string) => void
  onClose: () => void
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function StoryboardView({ items, mediaItems, selectedId, onSelect, onSeek, onReorder, onClose }: Props) {
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const sorted = [...items].sort((a, b) => a.startTime - b.startTime)

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 10,
        background: 'var(--bg-base)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 36, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          Storyboard — {sorted.length} clip{sorted.length !== 1 ? 's' : ''}
        </span>
        <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title="Close storyboard">
          <X size={14} />
        </button>
      </div>

      {/* Grid */}
      <div
        className="flex-1 overflow-auto p-4"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignContent: 'flex-start' }}
      >
        {sorted.length === 0 ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            No clips on the timeline yet. Drag media from the pool onto a track to begin.
          </div>
        ) : (
          sorted.map((item, idx) => {
            const media = mediaItems.find(m => m.url === item.url)
            const selected = item.id === selectedId
            const isOver = dragOverId === item.id

            return (
              <div
                key={item.id}
                draggable
                onDragStart={e => { e.dataTransfer.setData('sbId', item.id); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={e => { e.preventDefault(); setDragOverId(item.id) }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={e => {
                  e.preventDefault()
                  const fromId = e.dataTransfer.getData('sbId')
                  if (fromId && fromId !== item.id) onReorder(fromId, item.id)
                  setDragOverId(null)
                }}
                onClick={() => { onSelect(item.id); onSeek(item.startTime) }}
                style={{
                  width: 152, flexShrink: 0, cursor: 'pointer',
                  border: `2px solid ${selected ? item.color : isOver ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8, overflow: 'hidden',
                  background: 'var(--bg-card)',
                  boxShadow: selected ? `0 0 0 2px ${item.color}33, 0 4px 12px rgba(0,0,0,0.4)` : '0 2px 6px rgba(0,0,0,0.3)',
                  transform: isOver ? 'scale(1.03)' : 'scale(1)',
                  transition: 'transform 0.1s, box-shadow 0.1s',
                  opacity: item.enabled === false ? 0.4 : 1,
                }}
              >
                {/* Thumbnail */}
                <div style={{ width: '100%', height: 86, background: '#111', position: 'relative', overflow: 'hidden' }}>
                  {media?.thumbnail ? (
                    <img
                      src={media.thumbnail} alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: `${item.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {item.contentType === 'audio'
                        ? <span style={{ color: item.color, fontSize: 28, opacity: 0.6 }}>♪</span>
                        : <span style={{ color: item.color, fontSize: 22, opacity: 0.4 }}>▶</span>}
                    </div>
                  )}
                  {/* Overlay: clip index + duration */}
                  <div style={{ position: 'absolute', top: 3, left: 4, fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.45)', padding: '1px 3px', borderRadius: 2 }}>
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  <div style={{ position: 'absolute', bottom: 3, right: 4, fontSize: 8, fontFamily: 'monospace', color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '1px 4px', borderRadius: 2 }}>
                    {fmtDur(item.outPoint - item.inPoint)}
                  </div>
                  {/* Clip flags */}
                  {item.flags && item.flags.length > 0 && (
                    <div style={{ position: 'absolute', top: 3, right: 4, display: 'flex', gap: 2 }}>
                      {item.flags.map(f => (
                        <span key={f.id} style={{ width: 8, height: 8, borderRadius: '50%', background: f.color, display: 'block', boxShadow: '0 0 3px rgba(0,0,0,0.6)' }} title={f.label} />
                      ))}
                    </div>
                  )}
                  {/* Color strip at bottom */}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: item.color }} />
                </div>
                {/* Info */}
                <div style={{ padding: '5px 8px 6px', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <GripVertical size={10} style={{ color: 'var(--text-muted)', marginTop: 1, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 1 }}>
                      {fmtDur(item.startTime)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
