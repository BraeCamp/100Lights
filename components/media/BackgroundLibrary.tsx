'use client'

// Shared background/visuals library — the same catalog Lightning Bug uses (lib/bg-library),
// surfaced app-wide so it isn't siloed in one app. Browse by category, hover to preview the
// motion, save for offline, download, or open a clip straight into Lightning Bug.
//
// Embedded in an app: pass `onPick` to select a clip. Standalone (library page): omit it and
// each tile opens /apps/musicvideo?bg=<id>.

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Download, DownloadCloud, Check, Sparkles } from 'lucide-react'
import { BG_CATEGORIES, clipsByCategory, type BgClip, type BgCategory } from '@/lib/bg-library'
import { saveAssets, removeAssets, hasAsset, downloadToDevice } from '@/lib/offline-media'

export default function BackgroundLibrary({ onPick }: { onPick?: (clip: BgClip) => void }) {
  const router = useRouter()
  const [cat, setCat] = useState<BgCategory>(BG_CATEGORIES[0])
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState('')
  const clips = clipsByCategory(cat)

  // Reflect which of the visible clips are already saved offline.
  useEffect(() => {
    let live = true
    ;(async () => {
      const entries = await Promise.all(clips.map(async c => [c.id, await hasAsset(c.src)] as const))
      if (live) setSaved(s => ({ ...s, ...Object.fromEntries(entries) }))
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat])

  const save = useCallback(async (c: BgClip) => {
    setMsg('')
    const ok = await saveAssets(c.kind === 'video' ? [c.src, c.preview] : [c.src])
    if (ok) setSaved(s => ({ ...s, [c.id]: true }))
    else setMsg(`Couldn’t save “${c.title}” — it isn’t reachable yet.`)
  }, [])
  const remove = useCallback(async (c: BgClip) => {
    await removeAssets([c.src, c.preview])
    setSaved(s => ({ ...s, [c.id]: false }))
  }, [])
  const download = useCallback(async (c: BgClip) => {
    setMsg('')
    const ext = c.src.split('.').pop() || (c.kind === 'video' ? 'mp4' : 'jpg')
    const ok = await downloadToDevice(c.src, `${c.id}.${ext}`)
    if (!ok) setMsg(`Couldn’t download “${c.title}” — it isn’t reachable yet.`)
  }, [])

  const use = useCallback((c: BgClip) => {
    if (onPick) onPick(c)
    else router.push(`/apps/musicvideo?bg=${c.id}`)
  }, [onPick, router])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {/* Category tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {BG_CATEGORIES.map(c => (
          <button key={c} type="button" onClick={() => setCat(c)}
            style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: cat === c ? 'var(--accent)' : 'var(--bg-card)', color: cat === c ? '#0e0d12' : 'var(--text-secondary)' }}>{c}</button>
        ))}
      </div>

      {msg && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{msg}</p>}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, overflowY: 'auto' }}>
        {clips.map(clip => (
          <Tile key={clip.id} clip={clip} saved={!!saved[clip.id]}
            onUse={() => use(clip)} onSave={() => save(clip)} onRemove={() => remove(clip)} onDownload={() => download(clip)}
            useLabel={onPick ? 'Use' : 'Open in Lightning Bug'} />
        ))}
      </div>
    </div>
  )
}

function Tile({ clip, saved, onUse, onSave, onRemove, onDownload, useLabel }: {
  clip: BgClip; saved: boolean; onUse: () => void; onSave: () => void; onRemove: () => void; onDownload: () => void; useLabel: string
}) {
  const vref = useRef<HTMLVideoElement | null>(null)
  const [hover, setHover] = useState(false)
  const stop = (e: React.MouseEvent, fn: () => void) => { e.stopPropagation(); fn() }

  return (
    <div
      onMouseEnter={() => { setHover(true); vref.current?.play?.().catch(() => {}) }}
      onMouseLeave={() => { setHover(false); const v = vref.current; if (v) { v.pause(); v.currentTime = 0 } }}
      onClick={onUse}
      title={`${clip.title} — click to ${useLabel.toLowerCase()}`}
      style={{ position: 'relative', aspectRatio: '16 / 10', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--border)', backgroundImage: clip.tint, backgroundSize: 'cover' }}>
      <img src={clip.preview} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
      {clip.kind === 'video' && (
        <video ref={vref} src={clip.src} poster={clip.preview} muted loop playsInline preload="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: hover ? 1 : 0, transition: 'opacity .25s ease' }}
          onError={e => { (e.currentTarget as HTMLVideoElement).style.display = 'none' }} />
      )}

      {/* Title + use hint */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 8px 6px', display: 'flex', alignItems: 'center', gap: 5, background: 'linear-gradient(0deg, rgba(0,0,0,0.72), transparent)' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.title}</span>
        {hover && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 800, color: 'var(--accent)' }}><Sparkles size={11} /> {useLabel}</span>}
      </div>

      {/* Actions (hover) */}
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 5, opacity: hover ? 1 : 0, transition: 'opacity .2s ease' }}>
        <button type="button" aria-label={saved ? 'Saved offline — remove' : 'Save offline'} onClick={e => stop(e, saved ? onRemove : onSave)}
          style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,0.55)', color: saved ? '#34d399' : '#fff' }}>
          {saved ? <Check size={14} /> : <DownloadCloud size={14} />}
        </button>
        <button type="button" aria-label="Download" onClick={e => stop(e, onDownload)}
          style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
          <Download size={14} />
        </button>
      </div>
    </div>
  )
}
