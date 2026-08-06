'use client'

import { useRef, useState, useEffect } from 'react'
import { Film, Mic, FolderOpen, Layers, CloudUpload, CheckCircle2, AlertCircle, Library, Music2, Link2, RotateCw, ArrowUpRight, ChevronDown } from 'lucide-react'
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
  /** Present when the project carries a DAW arrangement — links its real mix
   *  (or a single DAW track as a stem) as a live-updating clip. */
  onBounceDawMix?: (trackIds?: string[]) => void
  /** Open the project picker to link ANOTHER project's audio in (cross-project sync). */
  onLinkProject?: () => void
  /** Open the picker to SEND this project's audio into another project (push). */
  onSendProject?: () => void
  /** DAW tracks that carry clips — offered as stem link targets. */
  dawTracks?: Array<{ id: string; name: string }>
  bounceStatus?: 'idle' | 'working' | 'error'
  /** Projects whose audio is linked in — surfaced so you can see + reach them. */
  linkedSources?: Array<{ id: string; name: string; syncing?: boolean }>
  onOpenSource?: (id: string) => void
  onResyncSource?: (id: string) => void
}

function formatDur(s?: number) {
  if (!s) return '—'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Compact waveform strip for audio media, drawn from the peaks already computed
// on import (computeAudioPeaks). Mirrors the audio editor's Sound Library so a
// sound reads as a sound here too, not just a text row.
function MiniWave({ peaks }: { peaks: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx || !peaks.length) return
    const W = 240, H = 32
    c.width = W; c.height = H
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(99,102,241,0.55)'
    const step = W / peaks.length
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * (H - 4))
      ctx.fillRect(i * step, (H - h) / 2, Math.max(1, step - 0.5), h)
    }
  }, [peaks])
  return <canvas ref={ref} style={{ width: '100%', height: 22, display: 'block', borderRadius: 4, background: 'rgba(0,0,0,0.2)' }} />
}

// One row of the "Audio ▾" menu: icon + label + a muted one-line explainer.
function MenuRow({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick}
      className="flex items-start gap-2.5 w-full text-left rounded"
      style={{ padding: '7px 8px', background: 'transparent', border: 'none', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ color: 'var(--accent-light)', marginTop: 1, flexShrink: 0 }}>{icon}</span>
      <span className="min-w-0">
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)' }}>{sub}</span>
      </span>
    </button>
  )
}

export default function MediaLibrary({
  items, selectedId, onSelect, onImport, onAddToTimeline, onRemove, onContextMenu, onAddFromLibrary,
  onBounceDawMix, onLinkProject, onSendProject, bounceStatus = 'idle',
  linkedSources = [], onOpenSource, onResyncSource,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState('')
  const [tab, setTab] = useState<'local' | 'library'>('local')
  const [showAudioMenu, setShowAudioMenu] = useState(false)
  const [audioMenuPos, setAudioMenuPos] = useState<{ top: number; left: number } | null>(null)
  const audioBtnRef = useRef<HTMLButtonElement>(null)
  const hasAudioActions = !!(onBounceDawMix || onLinkProject || onSendProject)
  const toggleAudioMenu = () => {
    // Fixed-positioned so it escapes the (clipped) Media Pool column.
    const r = audioBtnRef.current?.getBoundingClientRect()
    if (r) setAudioMenuPos({ top: r.bottom + 4, left: r.left })
    setShowAudioMenu(v => !v)
  }
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
        <div className="flex items-center gap-1">
          {/* One grouped "Audio ▾" menu instead of three separate buttons. */}
          {hasAudioActions && (
            <div style={{ position: 'relative' }}>
              <button
                ref={audioBtnRef}
                onClick={toggleAudioMenu}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                style={{ background: 'var(--accent-subtle)', border: '1px solid var(--accent)', color: bounceStatus === 'error' ? '#f87171' : 'var(--accent-light)' }}
                title="Link, sync, or send project audio"
                aria-haspopup="menu" aria-expanded={showAudioMenu}
              >
                <Music2 size={11} />
                {bounceStatus === 'working' ? 'Syncing…' : 'Audio'}
                <ChevronDown size={11} />
              </button>
              {showAudioMenu && audioMenuPos && (<>
                <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowAudioMenu(false)} />
                <div role="menu" style={{ position: 'fixed', top: audioMenuPos.top, left: audioMenuPos.left, zIndex: 1000, minWidth: 210, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 4 }}>
                  {onBounceDawMix && (
                    <MenuRow icon={<Music2 size={13} />} label="Sync this project's audio"
                      sub="Its full mix as a live clip"
                      onClick={() => { setShowAudioMenu(false); onBounceDawMix() }} />
                  )}
                  {onLinkProject && (
                    <MenuRow icon={<Link2 size={13} />} label="Link a project's audio"
                      sub="Pull another project's mix in"
                      onClick={() => { setShowAudioMenu(false); onLinkProject() }} />
                  )}
                  {onSendProject && (
                    <MenuRow icon={<ArrowUpRight size={13} />} label="Send to a project"
                      sub="Push this mix into another project"
                      onClick={() => { setShowAudioMenu(false); onSendProject() }} />
                  )}
                </div>
              </>)}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}
            title="Import media (also drag files onto the viewer)"
          >
            <FolderOpen size={11} /> Import
          </button>
        </div>
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

      {/* Linked projects — the audio projects synced in, so they're findable +
          reachable (open to edit the source; re-sync pulls its latest mix). */}
      {linkedSources.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border)', padding: '6px 8px' }}>
          <p style={{ margin: '0 0 4px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Linked projects</p>
          {linkedSources.map(s => (
            <div key={s.id} className="flex items-center gap-1.5" style={{ padding: '3px 4px', borderRadius: 5 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              <Link2 size={11} color="var(--accent-light)" style={{ flexShrink: 0 }} />
              <span className="flex-1 min-w-0 truncate" style={{ fontSize: 11.5, color: 'var(--text-primary)' }} title={s.name}>{s.name}</span>
              {s.syncing && <span style={{ fontSize: 9, color: 'var(--accent-light)' }}>syncing…</span>}
              {onResyncSource && !s.syncing && (
                <button onClick={() => onResyncSource(s.id)} title="Re-sync from this project's latest mix" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}><RotateCw size={11} /></button>
              )}
              {onOpenSource && (
                <button onClick={() => onOpenSource(s.id)} title="Open this project to edit its audio" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}><ArrowUpRight size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}

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
                const isVideo = item.contentType === 'video'
                const Icon = isVideo ? Film : Mic
                const selected = item.id === selectedId
                const accent = isVideo ? 'var(--accent)' : '#6366f1'
                const showWave = !isVideo && !!item.peaks && item.peaks.length > 0
                const statusIcon =
                  item.uploadStatus === 'uploading' ? (
                    <span title="Uploading to cloud…" style={{ flexShrink: 0, display: 'flex' }}>
                      <CloudUpload size={12} color="var(--text-muted)" style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </span>
                  ) : item.uploadStatus === 'error' ? (
                    <span title={item.uploadError ? `Upload failed — file is local only.\n${item.uploadError}` : 'Upload failed — file is local only'} style={{ flexShrink: 0, display: 'flex' }}>
                      <AlertCircle size={12} color="#ef4444" />
                    </span>
                  ) : item.uploadStatus === 'uploaded' ? (
                    <span title="Saved to cloud" style={{ flexShrink: 0, display: 'flex' }}>
                      <CheckCircle2 size={12} color="var(--success)" />
                    </span>
                  ) : null
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
                    className="w-full px-2 py-2 rounded text-left cursor-grab active:cursor-grabbing transition-colors"
                    style={{
                      background: selected ? 'rgba(124,58,237,0.15)' : 'transparent',
                      border: `1px solid ${selected ? 'rgba(124,58,237,0.3)' : 'transparent'}`,
                      borderLeft: `2px solid ${selected ? 'var(--accent)' : accent}`,
                    }}
                    title="Drag to a timeline track, or double-click to add"
                  >
                    <div className="flex items-center gap-2">
                      {isVideo ? (
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
                      ) : (
                        <div
                          className="w-6 h-6 rounded shrink-0 flex items-center justify-center"
                          style={{ background: 'var(--border)' }}
                        >
                          <Icon size={12} color={accent} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.name}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {item.contentType} · {formatDur(item.duration)}
                        </div>
                      </div>
                      {statusIcon}
                    </div>
                    {showWave && (
                      <div style={{ marginTop: 6 }}>
                        <MiniWave peaks={item.peaks!} />
                      </div>
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
