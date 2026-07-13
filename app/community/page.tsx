'use client'

// Community feed — a social stream (SoundCloud × marketplace, no payments).
// Everything shared is listenable in place: songs/samples get waveform players,
// recipes get a note-map + piano audition, presets get a one-click audition.

import { useEffect, useRef, useState } from 'react'
import { ArrowBigUp, Download, Upload, Trash2, Music, Piano, BookOpen, Disc3, Play, Pause, Search, X, Loader2 } from 'lucide-react'
import { listCommunity, toggleVote, importItem, shareSample, sharePreset, type CommunityItem } from '@/lib/community'
import { getPresets, noteRangeLabel, type MidiPreset } from '@/lib/midi-presets'
import { libraryGetAll, initLibrary, type LibraryEntry, type RenderSpec } from '@/lib/sound-library'
import { renderSpecToBuffer } from '@/lib/default-samples'
import { playMelodicNote } from '@/lib/instrument-synth'
import { useUser } from '@clerk/nextjs'

type Kind = 'all' | 'song' | 'sample' | 'preset' | 'recipe'

const KIND_META: Record<Exclude<Kind, 'all'>, { label: string; plural: string; color: string; icon: typeof Music; action: string }> = {
  song:   { label: 'Song',   plural: 'Songs',   color: '#22d3ee', icon: Disc3,    action: 'Download' },
  sample: { label: 'Sample', plural: 'Samples', color: '#3b82f6', icon: Music,    action: 'Add to library' },
  preset: { label: 'Preset', plural: 'Presets', color: '#a78bfa', icon: Piano,    action: 'Install' },
  recipe: { label: 'Recipe', plural: 'Recipes', color: '#f59e0b', icon: BookOpen, action: 'Save recipe' },
}

// ── Shared playback: one thing plays at a time, like a feed should ────────────

let sharedCtx: AudioContext | null = null
function audioCtx(): AudioContext {
  sharedCtx ??= new AudioContext()
  if (sharedCtx.state === 'suspended') void sharedCtx.resume()
  return sharedCtx
}

let stopCurrent: (() => void) | null = null
function claimPlayback(stop: () => void) {
  if (stopCurrent && stopCurrent !== stop) stopCurrent()
  stopCurrent = stop
}
function releasePlayback(stop: () => void) {
  if (stopCurrent === stop) stopCurrent = null
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

function avatarHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function fmtTime(sec: number): string {
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function extractPeaks(buf: AudioBuffer, bars = 120): number[] {
  const ch = buf.getChannelData(0)
  const per = Math.max(1, Math.floor(ch.length / bars))
  const peaks: number[] = []
  for (let i = 0; i < bars; i++) {
    let m = 0
    const start = i * per
    for (let j = start; j < Math.min(start + per, ch.length); j += 8) {
      const v = Math.abs(ch[j])
      if (v > m) m = v
    }
    peaks.push(m)
  }
  const max = Math.max(...peaks, 0.01)
  return peaks.map(p => p / max)
}

function drawWave(canvas: HTMLCanvasElement, peaks: number[], played: number, color: string) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const n = peaks.length
  const barW = w / n
  for (let i = 0; i < n; i++) {
    const bh = Math.max(2, peaks[i] * (h - 4))
    g.fillStyle = i / n <= played ? color : 'rgba(255,255,255,0.18)'
    g.fillRect(i * barW + barW * 0.15, (h - bh) / 2, barW * 0.7, bh)
  }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CommunityPage() {
  const { user, isLoaded } = useUser()
  const [items, setItems] = useState<CommunityItem[] | null>(null)
  const [kind, setKind] = useState<Kind>('all')  // ?kind= adopted client-side to avoid a hydration mismatch
  const [sort, setSort] = useState<'top' | 'new'>('top')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (isLoaded) initLibrary(user?.id ?? null) }, [isLoaded, user?.id])
  useEffect(() => () => { stopCurrent?.() }, [])

  async function load() {
    try {
      setItems(await listCommunity(kind === 'all' ? undefined : kind, sort))
      setError(null)
    } catch {
      setError('Could not load the community feed.')
    }
  }
  const urlKindAdopted = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => {  // async boundary — no sync setState in the effect
      if (!urlKindAdopted.current) {
        urlKindAdopted.current = true
        const k = new URLSearchParams(window.location.search).get('kind')
        if ((k === 'song' || k === 'sample' || k === 'preset' || k === 'recipe') && k !== kind) {
          setKind(k)  // effect re-runs with the new kind and loads then
          return
        }
      }
      void load()
    }, 0)
    return () => clearTimeout(t)
  }, [kind, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  function pickKind(k: Kind) {
    setKind(k)
    const url = k === 'all' ? '/community' : `/community?kind=${k}`
    window.history.replaceState(null, '', url)
  }

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  async function handleVote(item: CommunityItem) {
    try {
      const r = await toggleVote(item.id)
      setItems(prev => prev?.map(i => i.id === item.id ? { ...i, votes: r.votes, votedByMe: r.votedByMe } : i) ?? prev)
    } catch { flash('Vote failed') }
  }

  async function handleImport(item: CommunityItem) {
    setBusy(item.id)
    try {
      flash(await importItem(item))
      setItems(prev => prev?.map(i => i.id === item.id ? { ...i, downloads: i.downloads + 1 } : i) ?? prev)
    } catch (e) { flash(e instanceof Error ? e.message : 'Import failed') }
    finally { setBusy(null) }
  }

  async function handleDelete(item: CommunityItem) {
    if (!confirm(`Remove "${item.name}" from the community?`)) return
    await fetch(`/api/community/${item.id}`, { method: 'DELETE' }).catch(() => {})
    void load()
  }

  const q = query.trim().toLowerCase()
  const visible = items?.filter(i =>
    !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.authorName.toLowerCase().includes(q)
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '26px 18px 80px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>Community</h1>
          <button onClick={() => setShowUpload(true)} style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
            padding: '8px 15px', borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
          }}><Upload size={13} /> Share something</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
          Songs, samples, presets, and recipes from other producers. Listen right here, vote up what sounds good, pull anything into your studio.
        </p>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the feed…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', fontSize: 13,
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {(['all', 'song', 'sample', 'preset', 'recipe'] as Kind[]).map(k => {
            const active = kind === k
            const color = k === 'all' ? 'var(--text-primary)' : KIND_META[k].color
            return (
              <button key={k} onClick={() => pickKind(k)} style={{
                fontSize: 11.5, fontWeight: 700, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                background: active ? `color-mix(in srgb, ${k === 'all' ? '#8b5cf6' : KIND_META[k].color} 16%, transparent)` : 'transparent',
                border: active ? `1px solid ${k === 'all' ? 'rgba(167,139,250,0.5)' : KIND_META[k].color + '80'}` : '1px solid var(--border)',
                color: active ? color : 'var(--text-muted)',
              }}>{k === 'all' ? 'All' : KIND_META[k].plural}</button>
            )
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {(['top', 'new'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)} style={{
                fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', textTransform: 'capitalize',
                background: sort === s ? 'var(--bg-card)' : 'transparent',
                border: sort === s ? '1px solid var(--border)' : '1px solid transparent',
                color: sort === s ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>{s}</button>
            ))}
          </div>
        </div>

        {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}
        {items === null && !error && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
        {visible?.length === 0 && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {q ? 'Nothing matches your search.' : <>Nothing here yet — be the first to share {kind === 'all' ? 'something' : `a ${kind}`}.</>}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {visible?.map(item => (
            <FeedCard
              key={item.id} item={item} busy={busy === item.id}
              onVote={() => handleVote(item)} onImport={() => handleImport(item)}
              onDelete={item.mine ? () => handleDelete(item) : undefined}
            />
          ))}
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
          background: '#1e1e1e', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 18px',
          fontSize: 12.5, color: 'var(--text-primary)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', maxWidth: '80vw',
        }}>{toast}</div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onShared={() => { setShowUpload(false); flash('Shared!'); void load() }} />}
    </div>
  )
}

// ── Feed card ──────────────────────────────────────────────────────────────────

function FeedCard({ item, busy, onVote, onImport, onDelete }: {
  item: CommunityItem; busy: boolean
  onVote: () => void; onImport: () => void; onDelete?: () => void
}) {
  const meta = KIND_META[item.kind]
  const Icon = meta.icon
  const hue = avatarHue(item.authorName)

  return (
    <article style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px 12px' }}>
      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `hsl(${hue}, 45%, 26%)`, color: `hsl(${hue}, 70%, 78%)`, fontSize: 12, fontWeight: 800,
        }}>{item.authorName.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.authorName}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{timeAgo(item.createdAt)}</div>
        </div>
        <span style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          fontSize: 9.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}45`,
          borderRadius: 999, padding: '3px 10px',
        }}><Icon size={11} /> {meta.label}</span>
      </div>

      {/* Title + description */}
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{item.name}</div>
      {item.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: 1.45 }}>{item.description}</p>}

      {/* Inline preview */}
      <div style={{ marginTop: 10 }}>
        {(item.kind === 'song' || item.kind === 'sample') && <AudioPreview item={item} color={meta.color} />}
        {item.kind === 'recipe' && <RecipePreview item={item} color={meta.color} />}
        {item.kind === 'preset' && <PresetPreview item={item} color={meta.color} />}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <button onClick={onVote} title={item.votedByMe ? 'Remove vote' : 'Vote up'} style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700,
          background: item.votedByMe ? 'rgba(124,58,237,0.18)' : 'transparent',
          border: item.votedByMe ? '1px solid rgba(167,139,250,0.5)' : '1px solid var(--border)',
          color: item.votedByMe ? '#a78bfa' : 'var(--text-muted)',
        }}><ArrowBigUp size={14} /> {item.votes}</button>

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {item.downloads} {item.kind === 'song' ? 'download' : 'import'}{item.downloads !== 1 ? 's' : ''}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {onDelete && (
            <button onClick={onDelete} title="Remove your item" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onImport} disabled={busy} style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
            padding: '7px 14px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)',
            background: 'var(--bg-surface)', color: 'var(--text-primary)', opacity: busy ? 0.5 : 1,
          }}><Download size={13} /> {busy ? 'Working…' : meta.action}</button>
        </div>
      </div>
    </article>
  )
}

// ── Song / sample player (waveform + click-to-seek) ────────────────────────────

function AudioPreview({ item, color }: { item: CommunityItem; color: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [playing, setPlaying] = useState(false)
  const [clock, setClock] = useState('0:00')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const peaksRef = useRef<number[] | null>(null)
  const durRef = useRef(0)  // from the decoded buffer — MediaRecorder WebM reports Infinity on the element
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)
  const stopRef = useRef<() => void>(() => {})

  stopRef.current = () => {
    audioRef.current?.pause()
    setPlaying(false)
  }
  const stop = () => stopRef.current()

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    audioRef.current?.pause()
    releasePlayback(stop)
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])  

  function paint() {
    const a = audioRef.current, c = canvasRef.current
    if (!a || !c || !peaksRef.current) return
    const played = durRef.current ? a.currentTime / durRef.current : 0
    drawWave(c, peaksRef.current, played, color)
    setClock(`${fmtTime(a.currentTime)} / ${fmtTime(durRef.current)}`)
    if (!a.paused) rafRef.current = requestAnimationFrame(paint)
  }

  async function ensureLoaded(): Promise<HTMLAudioElement | null> {
    if (audioRef.current) return audioRef.current
    if (!item.r2Key) { setState('error'); return null }
    setState('loading')
    try {
      const signed = await fetch(`/api/media/signed-url?key=${encodeURIComponent(item.r2Key)}`)
      if (!signed.ok) throw new Error()
      const { url } = await signed.json() as { url: string }
      const blob = await (await fetch(url)).blob()
      const objUrl = URL.createObjectURL(blob)
      urlRef.current = objUrl
      const decoded = await audioCtx().decodeAudioData(await blob.arrayBuffer())
      peaksRef.current = extractPeaks(decoded)
      durRef.current = decoded.duration
      const a = new Audio(objUrl)
      a.onended = () => { setPlaying(false); releasePlayback(stop); requestAnimationFrame(paint) }
      audioRef.current = a
      setState('ready')
      return a
    } catch {
      setState('error')
      return null
    }
  }

  async function toggle() {
    const a = await ensureLoaded()
    if (!a) return
    if (a.paused) {
      claimPlayback(stop)
      await a.play().catch(() => {})
      setPlaying(true)
      rafRef.current = requestAnimationFrame(paint)
    } else {
      stop()
      releasePlayback(stop)
    }
  }

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const a = audioRef.current, c = canvasRef.current
    if (!a || !c || !durRef.current) return
    const r = c.getBoundingClientRect()
    a.currentTime = Math.min(((e.clientX - r.left) / r.width) * durRef.current, durRef.current - 0.05)
    requestAnimationFrame(paint)
  }

  // Paint the resting waveform once loaded
  useEffect(() => {
    if (state === 'ready') requestAnimationFrame(paint)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
      <button onClick={toggle} disabled={state === 'loading'} aria-label={playing ? 'Pause' : 'Play'} style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', cursor: 'pointer', background: color, color: '#08090c',
      }}>
        {state === 'loading' ? <Loader2 size={15} className="animate-spin" /> : playing ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
      </button>
      {state === 'ready' ? (
        <>
          <canvas ref={canvasRef} onClick={seek} style={{ flex: 1, height: 44, cursor: 'pointer', display: 'block' }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{clock}</span>
        </>
      ) : (
        <span style={{ flex: 1, fontSize: 11.5, color: state === 'error' ? '#ef4444' : 'var(--text-muted)' }}>
          {state === 'error' ? 'Could not load audio.' : state === 'loading' ? 'Loading audio…' : 'Press play to listen'}
        </span>
      )}
    </div>
  )
}

// ── Recipe preview (note map + piano audition) ─────────────────────────────────

type RecipeNotes = { notes: Array<{ pitch: number; startBeat: number; durationBeats: number; velocity: number }>; durationBeats: number; isDrumClip?: boolean }

function RecipePreview({ item, color }: { item: CommunityItem; color: string }) {
  const [playing, setPlaying] = useState(false)
  const stopFnRef = useRef<() => void>(() => {})
  const spec = (item.payload as { spec?: RecipeNotes } | null)?.spec

  useEffect(() => () => { stopFnRef.current() }, [])

  if (!spec?.notes?.length) return null
  const { notes, durationBeats } = spec
  const lo = Math.min(...notes.map(n => n.pitch)), hi = Math.max(...notes.map(n => n.pitch))
  const range = Math.max(hi - lo + 1, 8)
  const beats = Math.max(durationBeats, ...notes.map(n => n.startBeat + n.durationBeats))

  function audition() {
    if (playing) { stopFnRef.current(); return }
    const ctx = audioCtx()
    const g = ctx.createGain()
    g.gain.value = 0.7  // headroom — stacked chord voices can sum past full scale
    g.connect(ctx.destination)
    const spb = 60 / 100  // audition at 100 bpm
    const t0 = ctx.currentTime + 0.06
    const capBeats = 16
    let end = 0
    for (const n of notes) {
      if (n.startBeat >= capBeats) continue
      playMelodicNote(ctx, 'piano-grand', n.pitch, t0 + n.startBeat * spb, (n.velocity ?? 100) / 127, g)
      end = Math.max(end, (Math.min(n.startBeat + n.durationBeats, capBeats)) * spb)
    }
    const timer = setTimeout(() => stopFnRef.current(), (end + 1.2) * 1000)
    const stop = () => {
      clearTimeout(timer)
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
      setTimeout(() => g.disconnect(), 300)
      setPlaying(false)
      releasePlayback(stop)
    }
    stopFnRef.current = stop
    claimPlayback(stop)
    setPlaying(true)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
      {!spec.isDrumClip && (
        <button onClick={audition} aria-label={playing ? 'Stop audition' : 'Audition recipe'} style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', cursor: 'pointer', background: color, color: '#08090c',
        }}>{playing ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}</button>
      )}
      <svg viewBox={`0 0 ${beats} ${range}`} preserveAspectRatio="none" style={{ flex: 1, height: 52, display: 'block' }}>
        {Array.from({ length: Math.floor(beats / 4) }, (_, i) => (
          <line key={i} x1={(i + 1) * 4} y1={0} x2={(i + 1) * 4} y2={range} stroke="rgba(255,255,255,0.08)" strokeWidth={0.06} />
        ))}
        {notes.map((n, i) => (
          <rect key={i} x={n.startBeat} y={hi - n.pitch + (range - (hi - lo + 1)) / 2} width={Math.max(n.durationBeats - 0.08, 0.15)} height={0.82}
            rx={0.12} fill={color} opacity={0.45 + 0.55 * ((n.velocity ?? 100) / 127)} />
        ))}
      </svg>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{beats} beats{spec.isDrumClip ? ' · drums' : ''}</span>
    </div>
  )
}

// ── Preset audition ────────────────────────────────────────────────────────────

function PresetPreview({ item, color }: { item: CommunityItem; color: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const stopFnRef = useRef<() => void>(() => {})
  const payload = item.payload as { preset?: { loNote?: number; hiNote?: number }; entries?: Array<{ renderSpec?: RenderSpec }> } | null
  const entries = payload?.entries?.filter(e => e.renderSpec) ?? []

  useEffect(() => () => { stopFnRef.current() }, [])

  const rangeLabel = payload?.preset?.loNote != null && payload?.preset?.hiNote != null
    ? `${entries.length} notes` : `${entries.length} sounds`

  if (entries.length === 0) return null

  async function audition() {
    if (state === 'playing') { stopFnRef.current(); return }
    if (state === 'loading') return
    // Audition the entry nearest middle C — most representative of the preset
    const pick = entries.reduce((best, e) =>
      Math.abs((e.renderSpec!.midiNote ?? 60) - 60) < Math.abs((best.renderSpec!.midiNote ?? 60) - 60) ? e : best)
    setState('loading')
    try {
      const buf = await renderSpecToBuffer(pick.renderSpec!)
      const ctx = audioCtx()
      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      src.connect(g); g.connect(ctx.destination)
      const stop = () => {
        try { src.stop() } catch { /* already stopped */ }
        g.disconnect()
        setState('idle')
        releasePlayback(stop)
      }
      src.onended = () => stopFnRef.current()
      stopFnRef.current = stop
      srcRef.current = src
      claimPlayback(stop)
      src.start()
      setState('playing')
    } catch {
      setState('idle')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
      <button onClick={audition} disabled={state === 'loading'} aria-label={state === 'playing' ? 'Stop audition' : 'Audition preset'} style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', cursor: 'pointer', background: color, color: '#08090c',
      }}>
        {state === 'loading' ? <Loader2 size={15} className="animate-spin" /> : state === 'playing' ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
      </button>
      <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-muted)' }}>
        {state === 'playing' ? 'Playing a sample note…' : state === 'loading' ? 'Rendering…' : 'Hear a sample note'}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{rangeLabel}</span>
    </div>
  )
}

// ── Upload modal ───────────────────────────────────────────────────────────────

function UploadModal({ onClose, onShared }: { onClose: () => void; onShared: () => void }) {
  const [mode, setMode] = useState<'sample' | 'preset'>('sample')
  const [description, setDescription] = useState('')
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [presets] = useState<MidiPreset[]>(() => typeof window === 'undefined' ? [] : getPresets().filter(p => !p.builtIn))
  const [pickedEntry, setPickedEntry] = useState('')
  const [pickedPreset, setPickedPreset] = useState('')

  useEffect(() => {
    // Own recordings/imports only — sharing the built-in library back would be noise
    libraryGetAll().then(all => setEntries(all.filter(e => !e.id.startsWith('seed:') && !e.id.startsWith('community:')))).catch(() => {})
  }, [])

  async function submit() {
    setWorking(true); setErr('')
    try {
      if (mode === 'sample') {
        const entry = entries.find(e => e.id === pickedEntry)
        if (!entry) throw new Error('Pick a sample from your library')
        await shareSample(entry, description)
      } else {
        const preset = presets.find(p => p.id === pickedPreset)
        if (!preset) throw new Error('Pick one of your custom presets')
        await sharePreset(preset, description)
      }
      onShared()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Share failed')
      setWorking(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: 'calc(100vw - 40px)', background: '#161616', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Share to the community</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['sample', 'preset'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', textTransform: 'capitalize',
              background: mode === m ? 'var(--bg-card)' : 'transparent',
              border: mode === m ? '1px solid var(--border)' : '1px solid transparent',
              color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{m}</button>
          ))}
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
          Songs are shared from the editor’s Export dialog · recipes by right-clicking a MIDI clip.
        </p>

        {mode === 'sample' ? (
          <select value={pickedEntry} onChange={e => setPickedEntry(e.target.value)} style={selStyle}>
            <option value="">Pick a sample from your library…</option>
            {entries.map(e => <option key={e.id} value={e.id}>{e.name}{e.folder ? ` (${e.folder})` : ''}</option>)}
          </select>
        ) : (
          <select value={pickedPreset} onChange={e => setPickedPreset(e.target.value)} style={selStyle}>
            <option value="">Pick one of your custom presets…</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name} — {noteRangeLabel(p)}</option>)}
          </select>
        )}
        {mode === 'preset' && presets.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No custom presets yet — create one from the piano roll’s sound menu (+ New Preset).</p>
        )}
        {mode === 'sample' && entries.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No shareable samples yet — record or import something first (built-ins are excluded).</p>
        )}

        <textarea
          value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (what is it, how to use it)…"
          style={{ width: '100%', marginTop: 12, height: 64, resize: 'none', background: '#101010', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', boxSizing: 'border-box', outline: 'none' }}
        />

        {err && <p style={{ color: '#ef4444', fontSize: 11.5, margin: '8px 0 0' }}>{err}</p>}

        <button onClick={submit} disabled={working} style={{
          marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, opacity: working ? 0.6 : 1,
        }}>{working ? 'Sharing…' : 'Share'}</button>
      </div>
    </div>
  )
}

const selStyle: React.CSSProperties = {
  width: '100%', background: '#101010', border: '1px solid var(--border)', borderRadius: 7,
  color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', outline: 'none',
}
