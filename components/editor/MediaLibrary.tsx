'use client'

import { useRef, useState, useEffect } from 'react'
import { Film, Mic, FolderOpen, Layers, CloudUpload, CheckCircle2, AlertCircle, Library } from 'lucide-react'
import type { MediaItem } from '@/lib/editor-types'
import type { ContextMenuItem } from './ContextMenu'
import type { LibraryMediaItem } from '@/app/api/media/library/route'

interface Props {
  items: MediaItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onImport: (file: File) => void
  onAddToTimeline: (item: MediaItem) => void
  onRemove: (id: string) => void
  onContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void
  onAddFromLibrary: (item: LibraryMediaItem) => void
}

function formatDur(s?: number) {
  if (!s) return '—'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function MediaLibrary({
  items, selectedId, onSelect, onImport, onAddToTimeline, onRemove, onContextMenu, onAddFromLibrary,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState('')
  const [tab, setTab] = useState<'local' | 'library'>('local')
  const [libraryItems, setLibraryItems] = useState<LibraryMediaItem[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)

  const ACCEPTED_TYPES = ['video/', 'audio/']
  const MAX_BYTES = 500 * 1024 * 1024

  function validateFile(file: File): string {
    const isCube = file.name.toLowerCase().endsWith('.cube')
    if (!isCube && !ACCEPTED_TYPES.some(t => file.type.startsWith(t)))
      return `Unsupported file type "${file.type || file.name.split('.').pop()}". Upload a video, audio, or .cube LUT file.`
    if (file.size > MAX_BYTES)
      return `File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum size is 500 MB.`
    return ''
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateFile(file)
    if (err) { setImportError(err); return }
    setImportError('')
    onImport(file)
  }

  function getMenuItems(item: MediaItem): ContextMenuItem[] {
    return [
      { id: 'add', label: 'Add to Timeline', shortcut: 'Enter', onClick: () => onAddToTimeline(item) },
      { id: 'sep', separator: true, label: '' },
      { id: 'remove', label: 'Remove from Library', danger: true, onClick: () => onRemove(item.id) },
    ]
  }

  useEffect(() => {
    if (tab !== 'library') return
    setLibraryLoading(true)
    fetch('/api/media/library')
      .then(r => r.json())
      .then((data: LibraryMediaItem[]) => setLibraryItems(data))
      .catch(() => {})
      .finally(() => setLibraryLoading(false))
  }, [tab])

  // Refresh library tab when a new item is uploaded in the local tab
  useEffect(() => {
    if (tab !== 'library') return
    const uploaded = items.filter(m => m.uploadStatus === 'uploaded')
    if (uploaded.length === 0) return
    fetch('/api/media/library')
      .then(r => r.json())
      .then((data: LibraryMediaItem[]) => setLibraryItems(data))
      .catch(() => {})
  }, [items, tab])

  const localItemIds = new Set(items.map(m => m.id))

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Media Pool
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs"
          style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}
          title="Import media (also drag files onto the viewer)"
        >
          <FolderOpen size={11} /> Import
        </button>
        <input ref={fileInputRef} type="file" accept="video/*,audio/*,.cube" className="hidden" onChange={handleFileInput} />
      </div>

      {/* Import error */}
      {importError && (
        <div
          className="mx-3 mt-2 px-2.5 py-2 rounded-lg text-xs flex items-start gap-2"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
        >
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span>{importError}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button
          className="flex-1 py-1.5 text-xs font-medium"
          style={{ color: tab === 'local' ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === 'local' ? 'var(--accent)' : 'transparent'}` }}
          onClick={() => setTab('local')}
        >
          This project
        </button>
        <button
          className="flex-1 py-1.5 text-xs font-medium"
          style={{ color: tab === 'library' ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === 'library' ? 'var(--accent)' : 'transparent'}` }}
          onClick={() => setTab('library')}
        >
          My Library
        </button>
      </div>

      {/* Local media list */}
      {tab === 'local' && (
        <div className="flex-1 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--border)' }}>
                <Layers size={18} color="var(--text-muted)" />
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Import or drop a file here. Drag clips to the timeline tracks below.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = item.contentType === 'video' ? Film : Mic
                const selected = item.id === selectedId
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('mediaId', item.id)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => onSelect(item.id)}
                    onDoubleClick={() => onAddToTimeline(item)}
                    onContextMenu={(e) => { e.preventDefault(); onSelect(item.id); onContextMenu(e, getMenuItems(item)) }}
                    className="flex items-center gap-2 w-full px-2 py-2 rounded text-left cursor-grab active:cursor-grabbing transition-colors"
                    style={{
                      background: selected ? 'rgba(124,58,237,0.15)' : 'transparent',
                      border: `1px solid ${selected ? 'rgba(124,58,237,0.3)' : 'transparent'}`,
                    }}
                    title="Drag to a timeline track, or double-click to add"
                  >
                    <div
                      className="w-10 h-7 rounded shrink-0 flex items-center justify-center overflow-hidden"
                      style={{ background: 'var(--border)' }}
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <Icon size={12} color="var(--text-muted)" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.name}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {item.contentType} · {formatDur(item.duration)}
                      </div>
                    </div>
                    {item.uploadStatus === 'uploading' && (
                      <span title="Uploading to cloud…" style={{ flexShrink: 0, display: 'flex' }}>
                        <CloudUpload size={12} color="var(--text-muted)" style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                      </span>
                    )}
                    {item.uploadStatus === 'error' && (
                      <span title="Upload failed — file is local only" style={{ flexShrink: 0, display: 'flex' }}>
                        <AlertCircle size={12} color="#ef4444" />
                      </span>
                    )}
                    {item.uploadStatus === 'uploaded' && (
                      <span title="Saved to cloud" style={{ flexShrink: 0, display: 'flex' }}>
                        <CheckCircle2 size={12} color="var(--success)" />
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Shared library */}
      {tab === 'library' && (
        <div className="flex-1 overflow-y-auto p-1.5">
          {libraryLoading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</span>
            </div>
          ) : libraryItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--border)' }}>
                <Library size={18} color="var(--text-muted)" />
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Files you upload are saved here and can be reused across all projects without re-uploading.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {libraryItems.map((item) => {
                const Icon = item.contentType.startsWith('video') ? Film : Mic
                const alreadyInProject = localItemIds.has(item.id)
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 w-full px-2 py-2 rounded text-left transition-colors"
                    style={{ background: 'transparent', border: '1px solid transparent' }}
                    onMouseEnter={e => { if (!alreadyInProject) (e.currentTarget as HTMLDivElement).style.background = 'rgba(124,58,237,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  >
                    <div
                      className="w-10 h-7 rounded shrink-0 flex items-center justify-center overflow-hidden"
                      style={{ background: 'var(--border)' }}
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <Icon size={12} color="var(--text-muted)" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.name}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatDur(item.duration)}
                      </div>
                    </div>
                    {alreadyInProject ? (
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>In project</span>
                    ) : (
                      <button
                        onClick={() => onAddFromLibrary(item)}
                        className="text-xs px-2 py-1 rounded shrink-0"
                        style={{ background: 'var(--accent-subtle)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.3)' }}
                        title="Add to this project (no re-upload)"
                      >
                        Add
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Drag hint — only shown in local tab */}
      {tab === 'local' && items.length > 0 && (
        <div
          className="px-3 py-2 shrink-0 text-center text-xs"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          Drag to timeline · Double-click to add
        </div>
      )}
    </div>
  )
}
