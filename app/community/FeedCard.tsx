'use client'

// One community item, rendered SoundCloud-style with inline listening.
// Shared between the feed (/community) and the public item page
// (/community/{id}) — the latter passes signedIn={false} so actions become
// sign-in prompts instead of failing.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowBigUp, Download, Trash2, Music, Piano, BookOpen, Disc3, Play, Pause, Loader2, Link2, Package, LayoutTemplate, ExternalLink, Flag, Palette, Drum, Grid3x3 } from 'lucide-react'
import { toggleReaction, type CommunityItem } from '@/lib/community'
import { renderSpecToBuffer } from '@/lib/default-samples'
import type { RenderSpec } from '@/lib/sound-library'
import { playMelodicNote } from '@/lib/instrument-synth'

export const KIND_META: Record<CommunityItem['kind'], { label: string; plural: string; color: string; icon: typeof Music; action: string }> = {
  song:    { label: 'Song',    plural: 'Songs',    color: '#22d3ee', icon: Disc3,          action: 'Download' },
  sample:  { label: 'Sample',  plural: 'Samples',  color: '#3b82f6', icon: Music,          action: 'Add to library' },
  preset:  { label: 'Preset',  plural: 'Presets',  color: '#a78bfa', icon: Piano,          action: 'Install' },
  recipe:  { label: 'Recipe',  plural: 'Recipes',  color: '#f59e0b', icon: BookOpen,       action: 'Save recipe' },
  pack:    { label: 'Pack',    plural: 'Packs',    color: '#34d399', icon: Package,        action: 'Install pack' },
  project: { label: 'Starter', plural: 'Starters', color: '#fb7185', icon: LayoutTemplate, action: 'Open in Studio' },
  theme:   { label: 'Theme',   plural: 'Themes',   color: '#e879f9', icon: Palette,        action: 'Apply theme' },
  kit:     { label: 'Kit',     plural: 'Kits',     color: '#f87171', icon: Drum,           action: 'Install kit' },
  pattern: { label: 'Pattern', plural: 'Patterns', color: '#fbbf24', icon: Grid3x3,        action: 'Add pattern' },
}

export const REACTION_EMOJI = ['🔥', '❤️', '🎧']

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
export function stopFeedPlayback() { stopCurrent?.() }

// Playlist behaviour: audio cards register in feed order; when one ends,
// the next starts.
const playQueue: Array<{ id: string; play: () => void }> = []
function registerPlayer(id: string, play: () => void) {
  playQueue.push({ id, play })
  return () => {
    const i = playQueue.findIndex(p => p.id === id)
    if (i >= 0) playQueue.splice(i, 1)
  }
}
function playNextAfter(id: string) {
  const i = playQueue.findIndex(p => p.id === id)
  if (i >= 0 && i + 1 < playQueue.length) playQueue[i + 1].play()
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function timeAgo(iso: string): string {
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

type ItemMeta = { bpm?: number; key?: string; durationSec?: number; peaks?: number[]; tags?: string[]; tempo?: number; tracks?: number; clips?: number }

// Early shares stored the key as a pitch-class number ("0 major") — translate
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function prettyKey(key: string): string {
  const m = key.match(/^(\d+)\s+(.*)$/)
  return m ? `${KEY_NAMES[parseInt(m[1], 10) % 12]} ${m[2]}` : key
}

function metaBadges(item: CommunityItem): string[] {
  const p = (item.payload ?? {}) as ItemMeta & { samples?: unknown[]; spec?: { durationBeats?: number; isDrumClip?: boolean } }
  const out: string[] = []
  if (item.kind === 'song') {
    if (p.bpm) out.push(`${p.bpm} BPM`)
    if (p.key) out.push(prettyKey(p.key))
    if (p.durationSec) out.push(fmtTime(p.durationSec))
  }
  if (item.kind === 'sample' && typeof (p as { duration?: number }).duration === 'number') out.push(`${((p as { duration?: number }).duration!).toFixed(1)}s`)
  if (item.kind === 'recipe' && p.spec?.durationBeats) out.push(`${p.spec.durationBeats} beats${p.spec.isDrumClip ? ' · drums' : ''}`)
  if (item.kind === 'pack' && p.samples) out.push(`${p.samples.length} samples`)
  if (item.kind === 'project') {
    if (p.tempo) out.push(`${p.tempo} BPM`)
    if (p.key) out.push(prettyKey(p.key))
    if (p.tracks) out.push(`${p.tracks} tracks`)
    if (p.clips) out.push(`${p.clips} clips`)
  }
  return out
}

// ── Card ───────────────────────────────────────────────────────────────────────

export function FeedCard({ item, busy, signedIn, onVote, onImport, onDelete, onAuthorClick, onTagClick, onToast }: {
  item: CommunityItem
  busy: boolean
  signedIn: boolean
  onVote: () => void
  onImport: () => void
  onDelete?: () => void
  onAuthorClick?: (author: string) => void
  onTagClick?: (tag: string) => void
  onToast: (msg: string) => void
}) {
  const meta = KIND_META[item.kind]
  const Icon = meta.icon
  const hue = avatarHue(item.authorName)
  const badges = metaBadges(item)
  const tags = ((item.payload ?? {}) as ItemMeta).tags ?? []
  const [reactions, setReactions] = useState(item.reactions)
  const [myReactions, setMyReactions] = useState(item.myReactions)

  function copyLink() {
    const url = `${window.location.origin}/community/${item.id}`
    navigator.clipboard.writeText(url).then(
      () => onToast('Link copied — anyone can listen, no account needed.'),
      () => onToast(url),
    )
  }

  async function react(emoji: string) {
    if (!signedIn) { window.location.assign('/sign-in'); return }
    const had = myReactions.includes(emoji)
    setMyReactions(m => had ? m.filter(e => e !== emoji) : [...m, emoji])
    setReactions(r => ({ ...r, [emoji]: Math.max(0, (r[emoji] ?? 0) + (had ? -1 : 1)) }))
    try { setReactions(await toggleReaction(item.id, emoji)) } catch { /* optimistic state stands */ }
  }

  const openInStudio = item.kind === 'sample' || item.kind === 'recipe' || item.kind === 'preset'

  return (
    <article aria-label={`${meta.label}: ${item.name} by ${item.authorName}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px 12px' }}>
      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div aria-hidden style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `hsl(${hue}, 45%, 26%)`, color: `hsl(${hue}, 70%, 78%)`, fontSize: 12, fontWeight: 800,
        }}>{item.authorName.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <button
            onClick={() => onAuthorClick?.(item.authorName)}
            title={`Everything shared by ${item.authorName}`}
            style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: onAuthorClick ? 'pointer' : 'default', textAlign: 'left' }}
          >{item.authorName}</button>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{timeAgo(item.createdAt)}</div>
        </div>
        <span style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          fontSize: 9.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}45`,
          borderRadius: 999, padding: '3px 10px',
        }}><Icon size={11} /> {meta.label}</span>
      </div>

      {/* Title + badges + description */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{item.name}</span>
        {badges.map(b => (
          <span key={b} style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', borderRadius: 5, padding: '2px 7px', fontVariantNumeric: 'tabular-nums' }}>{b}</span>
        ))}
      </div>
      {item.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: 1.45 }}>{item.description}</p>}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
          {tags.map(t => (
            <button key={t} onClick={() => onTagClick?.(t)} style={{
              fontSize: 9.5, fontWeight: 600, color: meta.color, background: 'transparent',
              border: `1px solid ${meta.color}35`, borderRadius: 999, padding: '2px 9px', cursor: onTagClick ? 'pointer' : 'default',
            }}>#{t}</button>
          ))}
        </div>
      )}

      {/* Inline preview */}
      <div style={{ marginTop: 10 }}>
        {(item.kind === 'song' || item.kind === 'sample') && <AudioPreview item={item} color={meta.color} />}
        {item.kind === 'recipe' && <RecipePreview item={item} color={meta.color} />}
        {item.kind === 'preset' && <PresetPreview item={item} color={meta.color} />}
        {item.kind === 'pack' && <PackPreview item={item} color={meta.color} />}
        {item.kind === 'project' && <ProjectPreview item={item} color={meta.color} />}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={signedIn ? onVote : () => { window.location.assign('/sign-in') }} title={item.votedByMe ? 'Remove vote' : 'Vote up'} aria-label={item.votedByMe ? `Remove your vote (${item.votes} votes)` : `Vote up (${item.votes} votes)`} style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700,
          background: item.votedByMe ? 'rgba(124,58,237,0.18)' : 'transparent',
          border: item.votedByMe ? '1px solid rgba(167,139,250,0.5)' : '1px solid var(--border)',
          color: item.votedByMe ? '#a78bfa' : 'var(--text-muted)',
        }}><ArrowBigUp size={14} /> {item.votes}</button>

        {REACTION_EMOJI.map(e => {
          const n = reactions[e] ?? 0
          const mine = myReactions.includes(e)
          return (
            <button key={e} onClick={() => react(e)} aria-label={`React ${e}`} style={{
              display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 999, cursor: 'pointer', fontSize: 11,
              background: mine ? `${KIND_META[item.kind].color}18` : 'transparent',
              border: mine ? `1px solid ${KIND_META[item.kind].color}55` : '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}>{e}{n > 0 && <span style={{ fontSize: 10, fontWeight: 700 }}>{n}</span>}</button>
          )
        })}

        <button onClick={copyLink} title="Copy public link" aria-label="Copy public link" style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 999, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
        }}><Link2 size={12} /></button>

        {!item.mine && (
          <button
            onClick={async () => {
              if (!signedIn) { window.location.assign('/sign-in'); return }
              const reason = window.prompt('Report this to the moderators?\n\nOptional: what\u2019s wrong with it (stolen sample, offensive, spam…)')
              if (reason === null) return
              try {
                await fetch(`/api/community/${item.id}`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'report', reason }),
                })
                onToast('Reported — a moderator will take a look.')
              } catch { onToast('Report failed') }
            }}
            title="Report to moderators" aria-label="Report to moderators"
            style={{
              display: 'flex', alignItems: 'center', padding: '5px 9px', borderRadius: 999, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
            }}
          ><Flag size={11} /></button>
        )}

        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {item.downloads} {item.kind === 'song' ? 'download' : 'import'}{item.downloads !== 1 ? 's' : ''}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {onDelete && (
            <button onClick={onDelete} title="Remove your item" aria-label={`Delete ${item.name}`} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
              <Trash2 size={14} />
            </button>
          )}
          {openInStudio && (
            <a href={`/new?communityItem=${item.id}`} target="_blank" rel="noreferrer" title="Open a new project with this ready to play" style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, textDecoration: 'none',
              padding: '7px 12px', borderRadius: 999, border: `1px solid ${meta.color}55`, color: meta.color, background: `${meta.color}10`,
            }}><ExternalLink size={12} /> Open in Studio</a>
          )}
          {item.kind === 'project' ? (
            <a href={signedIn ? `/new?starter=${item.id}` : '/sign-in'} target={signedIn ? '_blank' : undefined} rel="noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, textDecoration: 'none',
              padding: '7px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)',
            }}><ExternalLink size={13} /> {meta.action}</a>
          ) : (
            <button onClick={signedIn ? onImport : () => { window.location.assign('/sign-in') }} disabled={busy} style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
              padding: '7px 14px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', opacity: busy ? 0.5 : 1,
            }}><Download size={13} /> {busy ? 'Working…' : meta.action}</button>
          )}
        </div>
      </div>
    </article>
  )
}

// ── Song / sample player (public audio endpoint, instant peaks, auto-advance) ──

function AudioPreview({ item, color }: { item: CommunityItem; color: string }) {
  const prePeaks = ((item.payload ?? {}) as ItemMeta).peaks
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [playing, setPlaying] = useState(false)
  const [clock, setClock] = useState('0:00')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const peaksRef = useRef<number[] | null>(prePeaks ?? null)
  const durRef = useRef(((item.payload ?? {}) as ItemMeta).durationSec ?? 0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)
  const stopRef = useRef<() => void>(() => {})

  stopRef.current = () => {
    audioRef.current?.pause()
    setPlaying(false)
  }
  const stop = () => stopRef.current()

  useEffect(() => {
    const unregister = registerPlayer(item.id, () => { void toggle() })
    return () => {
      unregister()
      cancelAnimationFrame(rafRef.current)
      audioRef.current?.pause()
      releasePlayback(stop)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function paint() {
    const a = audioRef.current, c = canvasRef.current
    if (!c || !peaksRef.current) return
    const played = a && durRef.current ? a.currentTime / durRef.current : 0
    drawWave(c, peaksRef.current, played, color)
    if (a) setClock(`${fmtTime(a.currentTime)} / ${fmtTime(durRef.current)}`)
    if (a && !a.paused) rafRef.current = requestAnimationFrame(paint)
  }

  async function ensureLoaded(): Promise<HTMLAudioElement | null> {
    if (audioRef.current) return audioRef.current
    setState('loading')
    try {
      const blob = await (await fetch(`/api/community/${item.id}/audio`)).blob()
      const objUrl = URL.createObjectURL(blob)
      urlRef.current = objUrl
      // Only decode when the share didn't bring its own waveform — Safari
      // can't decodeAudioData WebM, but its <audio> element can still play it.
      if (!peaksRef.current || !durRef.current) {
        try {
          const decoded = await audioCtx().decodeAudioData(await blob.arrayBuffer())
          peaksRef.current = extractPeaks(decoded)
          durRef.current = decoded.duration
        } catch {
          peaksRef.current ??= Array.from({ length: 96 }, () => 0.5)  // flat bar — playable, just no shape
        }
      }
      const a = new Audio(objUrl)
      a.onloadedmetadata = () => {
        if (!durRef.current && isFinite(a.duration)) durRef.current = a.duration
      }
      a.onended = () => {
        setPlaying(false)
        releasePlayback(stop)
        requestAnimationFrame(paint)
        playNextAfter(item.id)   // playlist feel: keep the feed going
      }
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

  function seekTo(frac: number) {
    const a = audioRef.current
    if (!a || !durRef.current) return
    a.currentTime = Math.min(Math.max(0, frac) * durRef.current, durRef.current - 0.05)
    requestAnimationFrame(paint)
  }

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = canvasRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    seekTo((e.clientX - r.left) / r.width)
  }

  // Paint the resting waveform when peaks are available (pre-shared or decoded)
  useEffect(() => {
    if (peaksRef.current) requestAnimationFrame(paint)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const showWave = state === 'ready' || (prePeaks && state !== 'error')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
      <button onClick={toggle} disabled={state === 'loading'} aria-label={playing ? `Pause ${item.name}` : `Play ${item.name}`} style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', cursor: 'pointer', background: color, color: '#08090c',
      }}>
        {state === 'loading' ? <Loader2 size={15} className="animate-spin" /> : playing ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
      </button>
      {showWave ? (
        <>
          <canvas
            ref={canvasRef} onClick={seek} role="slider" aria-label="Seek" tabIndex={0}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={audioRef.current && durRef.current ? Math.round((audioRef.current.currentTime / durRef.current) * 100) : 0}
            onKeyDown={e => {
              const a = audioRef.current
              if (!a || !durRef.current) return
              if (e.key === 'ArrowRight') seekTo((a.currentTime + 5) / durRef.current)
              if (e.key === 'ArrowLeft') seekTo((a.currentTime - 5) / durRef.current)
              if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void toggle() }
            }}
            style={{ flex: 1, height: 44, cursor: 'pointer', display: 'block', outline: 'none' }}
          />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {state === 'ready' ? clock : durRef.current ? fmtTime(durRef.current) : ''}
          </span>
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
    const spb = 60 / 100
    const t0 = ctx.currentTime + 0.06
    const capBeats = 16
    let end = 0
    for (const n of notes) {
      if (n.startBeat >= capBeats) continue
      playMelodicNote(ctx, 'piano-grand', n.pitch, t0 + n.startBeat * spb, (n.velocity ?? 100) / 127, g)
      end = Math.max(end, Math.min(n.startBeat + n.durationBeats, capBeats) * spb)
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
        <button onClick={audition} aria-label={playing ? 'Stop audition' : `Audition recipe ${item.name}`} style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', cursor: 'pointer', background: color, color: '#08090c',
        }}>{playing ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}</button>
      )}
      <svg viewBox={`0 0 ${beats} ${range}`} preserveAspectRatio="none" style={{ flex: 1, height: 52, display: 'block' }} aria-hidden>
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
  const stopFnRef = useRef<() => void>(() => {})
  const payload = item.payload as { preset?: { loNote?: number; hiNote?: number }; entries?: Array<{ renderSpec?: RenderSpec }> } | null
  const entries = payload?.entries?.filter(e => e.renderSpec) ?? []

  useEffect(() => () => { stopFnRef.current() }, [])

  if (entries.length === 0) return null

  async function audition() {
    if (state === 'playing') { stopFnRef.current(); return }
    if (state === 'loading') return
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
      claimPlayback(stop)
      src.start()
      setState('playing')
    } catch {
      setState('idle')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
      <button onClick={audition} disabled={state === 'loading'} aria-label={state === 'playing' ? 'Stop audition' : `Audition preset ${item.name}`} style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', cursor: 'pointer', background: color, color: '#08090c',
      }}>
        {state === 'loading' ? <Loader2 size={15} className="animate-spin" /> : state === 'playing' ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
      </button>
      <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-muted)' }}>
        {state === 'playing' ? 'Playing a sample note…' : state === 'loading' ? 'Rendering…' : 'Hear a sample note'}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{entries.length} notes</span>
    </div>
  )
}

// ── Pack preview: sample chips, each playable ──────────────────────────────────

function PackPreview({ item, color }: { item: CommunityItem; color: string }) {
  const samples = ((item.payload ?? {}) as { samples?: Array<{ name: string }> }).samples ?? []
  const [playingIdx, setPlayingIdx] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Stable identity — claim/release compare the function itself
  const stop = useCallback(() => { audioRef.current?.pause(); setPlayingIdx(null) }, [])
  useEffect(() => () => { audioRef.current?.pause(); releasePlayback(stop) }, [stop])

  async function playSample(i: number) {
    if (playingIdx === i) { stop(); releasePlayback(stop); return }
    audioRef.current?.pause()
    claimPlayback(stop)
    const a = new Audio(`/api/community/${item.id}/audio?i=${i}`)
    a.onended = () => setPlayingIdx(null)
    audioRef.current = a
    setPlayingIdx(i)
    await a.play().catch(() => setPlayingIdx(null))
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px' }}>
      {samples.map((s, i) => (
        <button key={i} onClick={() => playSample(i)} aria-label={`Play ${s.name}`} style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600,
          padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
          background: playingIdx === i ? color : `${color}14`,
          border: `1px solid ${color}40`,
          color: playingIdx === i ? '#08090c' : color,
        }}>
          {playingIdx === i ? <Pause size={10} /> : <Play size={10} />} {s.name}
        </button>
      ))}
    </div>
  )
}

// ── Project starter preview: track map ─────────────────────────────────────────

function ProjectPreview({ item, color }: { item: CommunityItem; color: string }) {
  const p = (item.payload ?? {}) as { dawProject?: { tracks?: Array<{ name?: string; color?: string }>; arrangementClips?: Array<{ trackId?: string; startBeat?: number; durationBeats?: number }> } }
  const tracks = p.dawProject?.tracks ?? []
  const clips = p.dawProject?.arrangementClips ?? []
  if (tracks.length === 0) return null
  const trackIds = tracks.map((t, i) => (t as { id?: string }).id ?? String(i))
  const maxBeat = Math.max(16, ...clips.map(c => (c.startBeat ?? 0) + (c.durationBeats ?? 0)))
  return (
    <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px' }} aria-label={`${tracks.length} track arrangement preview`}>
      <svg viewBox={`0 0 ${maxBeat} ${tracks.length * 3}`} preserveAspectRatio="none" style={{ width: '100%', height: Math.min(72, tracks.length * 14), display: 'block' }}>
        {clips.map((c, i) => {
          const row = trackIds.indexOf((c as { trackId?: string }).trackId ?? '')
          if (row < 0) return null
          return <rect key={i} x={c.startBeat ?? 0} y={row * 3 + 0.4} width={Math.max(0.5, c.durationBeats ?? 1)} height={2.2} rx={0.3}
            fill={tracks[row]?.color ?? color} opacity={0.75} />
        })}
      </svg>
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {tracks.slice(0, 6).map((t, i) => (
          <span key={i} style={{ fontSize: 9.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: t.color ?? color, display: 'inline-block' }} />
            {t.name ?? `Track ${i + 1}`}
          </span>
        ))}
        {tracks.length > 6 && <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>+{tracks.length - 6} more</span>}
      </div>
    </div>
  )
}
