'use client'

// The Media page — Resolve's "get organised before you edit" mode.
//
// The distinction that makes it work: the media POOL is what the project
// knows about, and organising it is a first-class activity rather than a
// sidebar afterthought. Bins are folders you drop items into; smart bins are
// saved live filters (an item shows up in one because it matches, not because
// it was filed there); the metadata you log — scene, shot/take, keywords —
// is what those filters search.

import { useMemo, useRef, useState } from 'react'
import { Folder, FolderPlus, Search, Trash2, Sparkle, List, Grid2X2 } from 'lucide-react'
import type { MediaItem, SmartBin } from '@/lib/editor-types'

interface Props {
  items: MediaItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onPatchItem: (id: string, patch: Partial<MediaItem>) => void
  onAddToTimeline: (item: MediaItem) => void
  bins: string[]
  onBinsChange: (bins: string[]) => void
  smartBins: SmartBin[]
  onSmartBinsChange: (bins: SmartBin[]) => void
}

const ROOT = '__root__'

/** Does an item satisfy a smart bin's live filter? */
export function matchesSmartBin(item: MediaItem, bin: SmartBin): boolean {
  if (bin.contentType && bin.contentType !== 'all' && item.contentType !== bin.contentType) return false
  const q = bin.query.trim().toLowerCase()
  if (!q) return true
  const hay = [item.name, item.scene, item.shotTake, item.notes, ...(item.keywords ?? [])]
    .filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q)
}

function formatDur(s?: number) {
  if (!s) return '—'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Hover-scrub: moving across a thumbnail scrubs the clip, so you can find the
// shot without opening it (the Resolve behaviour people miss most elsewhere).
function HoverScrubThumb({ item, width, height }: { item: MediaItem; width: number; height: number }) {
  const vidRef = useRef<HTMLVideoElement>(null)
  const isVideo = item.contentType === 'video'

  return (
    <div
      style={{ width, height, position: 'relative', background: '#000', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}
      onPointerMove={e => {
        const v = vidRef.current
        if (!v || !v.duration) return
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
        v.currentTime = frac * v.duration
      }}
      onPointerLeave={() => { const v = vidRef.current; if (v && v.duration) v.currentTime = 0 }}
    >
      {isVideo && item.url ? (
        <video ref={vidRef} src={item.url} muted playsInline preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : item.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbnail} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
          {item.contentType}
        </div>
      )}
    </div>
  )
}

export default function MediaPage({
  items, selectedId, onSelect, onPatchItem, onAddToTimeline,
  bins, onBinsChange, smartBins, onSmartBinsChange,
}: Props) {
  const [activeBin, setActiveBin] = useState<string>(ROOT)
  const [activeSmart, setActiveSmart] = useState<string | null>(null)
  const [view, setView] = useState<'thumb' | 'list'>('thumb')
  const [search, setSearch] = useState('')
  const [thumbSize, setThumbSize] = useState(128)

  const selected = items.find(i => i.id === selectedId) ?? null

  const shown = useMemo(() => {
    let list = items
    if (activeSmart) {
      const sb = smartBins.find(b => b.id === activeSmart)
      list = sb ? items.filter(i => matchesSmartBin(i, sb)) : items
    } else if (activeBin !== ROOT) {
      list = items.filter(i => i.bin === activeBin)
    } else {
      list = items.filter(i => !i.bin)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(i => [i.name, i.scene, i.shotTake, i.notes, ...(i.keywords ?? [])]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    return list
  }, [items, activeBin, activeSmart, smartBins, search])

  const binRow = (label: string, key: string, count: number, isSmart: boolean, onClick: () => void, onDelete?: () => void) => {
    const active = isSmart ? activeSmart === key : (!activeSmart && activeBin === key)
    return (
      <div key={`${isSmart ? 's' : 'b'}:${key}`}
        onClick={onClick}
        onDragOver={!isSmart && key !== ROOT ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }) : undefined}
        onDrop={!isSmart ? (e => {
          e.preventDefault()
          const id = e.dataTransfer.getData('application/x-media-id')
          if (id) onPatchItem(id, { bin: key === ROOT ? undefined : key })
        }) : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
          background: active ? 'var(--accent)' : 'transparent',
          color: active ? '#0b0d10' : 'var(--text-secondary)',
          fontSize: 11,
        }}>
        {isSmart ? <Sparkle size={11} /> : <Folder size={11} />}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontSize: 9, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
        {onDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete() }} title="Delete bin"
            style={{ display: 'flex', padding: 1, background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6 }}>
            <Trash2 size={9} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* ── Bin list ───────────────────────────────────────────── */}
      <div style={{ width: 190, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)' }}>
        <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', flex: 1 }}>Bins</span>
          <button
            onClick={() => {
              const name = prompt('New bin name')?.trim()
              if (name && !bins.includes(name)) onBinsChange([...bins, name])
            }}
            title="New bin" data-media-newbin
            style={{ display: 'flex', padding: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <FolderPlus size={12} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {binRow('Master', ROOT, items.filter(i => !i.bin).length, false, () => { setActiveBin(ROOT); setActiveSmart(null) })}
          {bins.map(b => binRow(
            b, b, items.filter(i => i.bin === b).length, false,
            () => { setActiveBin(b); setActiveSmart(null) },
            () => {
              onBinsChange(bins.filter(x => x !== b))
              for (const it of items.filter(i => i.bin === b)) onPatchItem(it.id, { bin: undefined })
              if (activeBin === b) setActiveBin(ROOT)
            },
          ))}

          <div style={{ height: 1, background: 'var(--border)', margin: '6px 2px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 2px' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', flex: 1 }}>Smart bins</span>
            <button
              onClick={() => {
                const q = prompt('Smart bin — show every item matching:')?.trim()
                if (!q) return
                onSmartBinsChange([...smartBins, { id: crypto.randomUUID(), name: q, query: q }])
              }}
              title="New smart bin (a saved live filter)" data-media-newsmart
              style={{ display: 'flex', padding: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <FolderPlus size={12} />
            </button>
          </div>
          {smartBins.map(sb => binRow(
            sb.name, sb.id, items.filter(i => matchesSmartBin(i, sb)).length, true,
            () => { setActiveSmart(sb.id) },
            () => { onSmartBinsChange(smartBins.filter(x => x.id !== sb.id)); if (activeSmart === sb.id) setActiveSmart(null) },
          ))}
        </div>
      </div>

      {/* ── Pool ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <Search size={11} color="var(--text-muted)" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, scene, keywords…"
            data-media-search
            style={{ flex: 1, maxWidth: 260, fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px', outline: 'none' }}
          />
          <div style={{ flex: 1 }} />
          <input type="range" min={72} max={200} value={thumbSize} onChange={e => setThumbSize(Number(e.target.value))}
            className="cf-slider" style={{ width: 80, height: 4 }} title="Thumbnail size" />
          {(['thumb', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} title={v === 'thumb' ? 'Thumbnail view' : 'List view'}
              style={{
                display: 'flex', padding: 3, borderRadius: 3, cursor: 'pointer',
                background: view === v ? 'var(--accent)' : 'transparent',
                color: view === v ? '#0b0d10' : 'var(--text-muted)',
                border: `1px solid ${view === v ? 'var(--accent)' : 'var(--border)'}`,
              }}>
              {v === 'thumb' ? <Grid2X2 size={11} /> : <List size={11} />}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {shown.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {items.length === 0 ? 'Import media on the Edit page — it lands here for logging and organising.' : 'Nothing in this bin.'}
            </p>
          )}
          {view === 'thumb' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {shown.map(it => (
                <div key={it.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('application/x-media-id', it.id)}
                  onClick={() => onSelect(it.id)}
                  onDoubleClick={() => onAddToTimeline(it)}
                  data-media-item={it.id}
                  title={`${it.name} — double-click to add to the timeline`}
                  style={{
                    width: thumbSize, cursor: 'pointer', borderRadius: 4, padding: 4,
                    border: `2px solid ${selectedId === it.id ? 'var(--accent)' : 'transparent'}`,
                    background: selectedId === it.id ? 'var(--bg-card)' : 'transparent',
                  }}>
                  <HoverScrubThumb item={it} width={thumbSize - 8} height={(thumbSize - 8) * 0.56} />
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDur(it.duration)}</div>
                </div>
              ))}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  {['Name', 'Type', 'Scene', 'Shot/Take', 'Keywords', 'Dur'].map(h => (
                    <th key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(it => (
                  <tr key={it.id}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('application/x-media-id', it.id)}
                    onClick={() => onSelect(it.id)}
                    onDoubleClick={() => onAddToTimeline(it)}
                    data-media-item={it.id}
                    style={{ cursor: 'pointer', background: selectedId === it.id ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)' }}>
                    <td style={{ padding: '3px 6px' }}>{it.name}</td>
                    <td style={{ padding: '3px 6px' }}>{it.contentType}</td>
                    <td style={{ padding: '3px 6px' }}>{it.scene ?? '—'}</td>
                    <td style={{ padding: '3px 6px' }}>{it.shotTake ?? '—'}</td>
                    <td style={{ padding: '3px 6px' }}>{(it.keywords ?? []).join(', ') || '—'}</td>
                    <td style={{ padding: '3px 6px', fontVariantNumeric: 'tabular-nums' }}>{formatDur(it.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Metadata / logging ─────────────────────────────────── */}
      <div style={{ width: 230, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 30, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Metadata</span>
        </div>
        {!selected ? (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: 10 }}>Select a clip to log it.</p>
        ) : (
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-word' }}>{selected.name}</div>
            {([
              ['Scene', 'scene'],
              ['Shot / Take', 'shotTake'],
              ['Notes', 'notes'],
            ] as const).map(([label, key]) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
                <input
                  value={(selected[key] as string | undefined) ?? ''}
                  onChange={e => onPatchItem(selected.id, { [key]: e.target.value })}
                  data-media-field={key}
                  style={{ fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '3px 6px', outline: 'none' }}
                />
              </label>
            ))}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Keywords</span>
              <input
                value={(selected.keywords ?? []).join(', ')}
                onChange={e => onPatchItem(selected.id, { keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="wide, ots, b-roll"
                data-media-field="keywords"
                style={{ fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '3px 6px', outline: 'none' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Bin</span>
              <select
                value={selected.bin ?? ''}
                onChange={e => onPatchItem(selected.id, { bin: e.target.value || undefined })}
                style={{ fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '3px 6px', outline: 'none' }}
              >
                <option value="">Master</option>
                {bins.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
