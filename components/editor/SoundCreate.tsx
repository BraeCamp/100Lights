'use client'

// Creating sounds from the library:
// - SynthDesigner: build a sample from scratch (two oscillators + noise, ADSR,
//   filter, drive) — feeds the Add-to-Library edit stage as an AudioBuffer.
// - LibrarySourcePicker: start from an existing library sample instead.
// - SaveRecipeButton: piano-roll toolbar button that saves the open clip as a
//   personal recipe (and optionally shares it to the Community).
// - requestCreateRecipe: library-side entry point that opens a fresh piano
//   roll in the studio (in-editor via event, elsewhere via navigation).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, Square, Dices, BookmarkPlus, Search, Plus, X, Globe2 } from 'lucide-react'
import { libraryGetAll, type LibraryEntry } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import { importRecipe, RECIPE_GENRE_ORDER } from '@/lib/practice-recipes'
import { shareRecipe } from '@/lib/community'
import type { MidiClip } from '@/lib/daw-types'

export const RECIPES_CHANGED_EVENT = '100lights-recipes-changed'
export const CREATE_RECIPE_EVENT = '100lights-create-recipe'
const CREATE_RECIPE_FLAG = '100lights-create-recipe'

/** Opens a fresh piano roll for recipe writing. Inside the studio the editor
 *  handles the event directly; anywhere else we stash a flag and navigate. */
export function requestCreateRecipe() {
  const ev = new CustomEvent(CREATE_RECIPE_EVENT, { cancelable: true })
  const unhandled = window.dispatchEvent(ev)
  if (unhandled) {
    sessionStorage.setItem(CREATE_RECIPE_FLAG, '1')
    window.location.assign('/new?modules=audio&audioMode=music')
  }
}

/** Editor-side: consume a pending create-recipe request (returns true if one was pending). */
export function consumeCreateRecipeFlag(): boolean {
  if (sessionStorage.getItem(CREATE_RECIPE_FLAG) !== '1') return false
  sessionStorage.removeItem(CREATE_RECIPE_FLAG)
  return true
}

/** Persists the clip as a personal recipe; optionally shares to the Community. */
export async function saveUserRecipe(clip: MidiClip, title: string, tagline: string, share: boolean, genre?: string): Promise<void> {
  importRecipe({
    id: `user-${crypto.randomUUID()}`,
    title,
    tagline: tagline || 'My recipe',
    annotation: [],
    genre,
    spec: {
      trackName: title,
      instrument: { type: 'none', params: {} },
      isDrumClip: clip.isDrumClip,
      durationBeats: clip.durationBeats,
      usePreset: !clip.isDrumClip,
      notes: clip.notes.map(n => ({ pitch: n.pitch, startBeat: n.startBeat, durationBeats: n.durationBeats, velocity: n.velocity })),
    },
  })
  window.dispatchEvent(new Event(RECIPES_CHANGED_EVENT))
  if (share) await shareRecipe(clip, title, tagline)
}

// ── Save-recipe button (piano roll toolbar) ───────────────────────────────────

export function SaveRecipeButton({ clip }: { clip: MidiClip }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [share, setShare] = useState(false)
  const [genre, setGenre] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pos) return
    function onDown(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setPos(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPos(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [pos])

  async function save() {
    const t = title.trim() || clip.name
    setBusy(true); setMsg('')
    try {
      await saveUserRecipe(clip, t, desc.trim(), share, genre || undefined)
      setMsg(share ? 'Saved to your library and shared ✓' : 'Saved to your library ✓')
      setTimeout(() => setPos(null), 1200)
    } catch {
      setMsg('Saved locally — sharing failed')
    } finally { setBusy(false) }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (pos) { setPos(null); return }
          const r = btnRef.current!.getBoundingClientRect()
          setTitle(clip.name)
          setDesc('')
          setGenre('')
          setShare(false)
          setMsg('')
          setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
        }}
        title="Save this pattern as a recipe in your library"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
          padding: '2px 7px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
          border: pos ? '1px solid rgba(52,211,153,0.5)' : '1px solid #333',
          background: pos ? 'rgba(52,211,153,0.12)' : '#222',
          color: pos ? '#34d399' : '#aaa', flexShrink: 0,
        }}
      >
        <BookmarkPlus size={10} /> Recipe
      </button>

      {pos && typeof document !== 'undefined' && createPortal(
        <div ref={panelRef} style={{
          position: 'fixed', top: pos.top, right: pos.right, width: 260, zIndex: 9999,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '12px 14px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Save as recipe</p>
          {clip.notes.length === 0 ? (
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Add some notes first — a recipe is the pattern you&apos;ve written here.
            </p>
          ) : (
            <>
              <input
                value={title} onChange={e => setTitle(e.target.value)} placeholder="Recipe name"
                style={{ fontSize: 11, padding: '6px 9px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
              />
              <input
                value={desc} onChange={e => setDesc(e.target.value)} placeholder="What makes it work? (optional)"
                style={{ fontSize: 11, padding: '6px 9px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
              />
              <select
                value={genre} onChange={e => setGenre(e.target.value)}
                style={{ fontSize: 11, padding: '6px 7px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: genre ? 'var(--text-primary)' : '#777', outline: 'none' }}
              >
                <option value="">Genre (optional)</option>
                {RECIPE_GENRE_ORDER.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} style={{ accentColor: '#34d399' }} />
                Also share to the Community
              </label>
              <button
                onClick={() => void save()} disabled={busy}
                style={{ padding: '7px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: busy ? 'rgba(52,211,153,0.3)' : '#34d399', color: 'var(--text-muted)' }}
              >
                {busy ? 'Saving…' : 'Save recipe'}
              </button>
              <p style={{ fontSize: 9.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                It appears under Your Recipes in the sound library — drag it onto any track.
              </p>
            </>
          )}
          {msg && <p style={{ fontSize: 10, color: msg.includes('failed') ? '#f59e0b' : '#34d399', margin: 0 }}>{msg}</p>}
        </div>,
        document.body,
      )}
    </>
  )
}

// ── Library source picker (Add-to-Library "From library" mode) ───────────────

export function LibrarySourcePicker({ onPick, onError }: {
  onPick: (buf: AudioBuffer, entry: LibraryEntry) => void
  onError: (msg: string) => void
}) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    libraryGetAll().then(all => { if (alive) setEntries(all) }).catch(() => { if (alive) setEntries([]) })
    return () => { alive = false }
  }, [])

  async function pick(entry: LibraryEntry) {
    setLoadingId(entry.id)
    try {
      const fulfilled = entry.audioBlob ? entry : await libraryFulfill(entry.id)
      if (!fulfilled?.audioBlob) { onError('Could not load that sample'); return }
      const ctx = new AudioContext()
      const buf = await ctx.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
      void ctx.close()
      onPick(buf, entry)
    } catch {
      onError('Could not decode that sample')
    } finally { setLoadingId(null) }
  }

  const needle = q.trim().toLowerCase()
  const shown = (entries ?? [])
    .filter(e => !needle || e.name.toLowerCase().includes(needle) || e.category.includes(needle))
    .slice(0, 60)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderRadius: 7, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search your library…"
          style={{ flex: 1, fontSize: 12, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)' }}
        />
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {entries === null && <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: 12, margin: 0 }}>Loading…</p>}
        {entries !== null && shown.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: 12, margin: 0 }}>No matches.</p>}
        {shown.map(e => (
          <button
            key={e.id}
            onClick={() => void pick(e)}
            disabled={loadingId !== null}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
              padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--border)',
              background: loadingId === e.id ? 'rgba(139,92,246,0.12)' : 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11,
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{e.name}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{e.category}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{e.duration.toFixed(1)}s</span>
            {loadingId === e.id && <span style={{ fontSize: 9, color: 'var(--accent-light)' }}>loading…</span>}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
        Pick a starting point — you&apos;ll get the full editor (trim, speed, reverse, fades) and save a new copy.
      </p>
    </div>
  )
}

// ── Synth designer (Add-to-Library "Synthesize" mode) ─────────────────────────

type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square'
const WAVES: Wave[] = ['sine', 'triangle', 'sawtooth', 'square']
const WAVE_LABEL: Record<Wave, string> = { sine: 'Sine', triangle: 'Triangle', sawtooth: 'Saw', square: 'Square' }
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

interface SynthParams {
  wave1: Wave; wave2: Wave; interval: number; osc2Level: number; noise: number
  attack: number; decay: number; sustain: number; release: number
  cutoff: number; drive: number; note: number; duration: number
}

const SYNTH_DEFAULTS: SynthParams = {
  wave1: 'sawtooth', wave2: 'sine', interval: 12, osc2Level: 0.35, noise: 0,
  attack: 0.01, decay: 0.25, sustain: 0.6, release: 0.5,
  cutoff: 4500, drive: 0, note: 57, duration: 2,
}

async function renderSynth(p: SynthParams): Promise<AudioBuffer> {
  const SR = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * p.duration), SR)
  const freq = 440 * Math.pow(2, (p.note - 69) / 12)

  // signal path: sources → lowpass → (drive) → ADSR env → destination
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = p.cutoff; lp.Q.value = 0.7
  let tail: AudioNode = lp
  if (p.drive > 0.01) {
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    const k = 1 + p.drive * 6
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(k * x) }
    shaper.curve = curve
    lp.connect(shaper); tail = shaper
  }
  const env = ctx.createGain()
  const gate = Math.max(p.attack + 0.02, p.duration - p.release)
  env.gain.setValueAtTime(0, 0)
  env.gain.linearRampToValueAtTime(1, p.attack)
  env.gain.linearRampToValueAtTime(Math.max(0.001, p.sustain), Math.min(gate, p.attack + p.decay))
  env.gain.setValueAtTime(Math.max(0.001, p.sustain), gate)
  env.gain.linearRampToValueAtTime(0, p.duration)
  tail.connect(env); env.connect(ctx.destination)

  const o1 = ctx.createOscillator(); o1.type = p.wave1; o1.frequency.value = freq
  const g1 = ctx.createGain(); g1.gain.value = 0.5
  o1.connect(g1); g1.connect(lp); o1.start(0)

  if (p.osc2Level > 0.01) {
    const o2 = ctx.createOscillator(); o2.type = p.wave2
    o2.frequency.value = freq * Math.pow(2, p.interval / 12)
    o2.detune.value = 4 // slight beat against osc1
    const g2 = ctx.createGain(); g2.gain.value = 0.5 * p.osc2Level
    o2.connect(g2); g2.connect(lp); o2.start(0)
  }
  if (p.noise > 0.01) {
    const nb = ctx.createBuffer(1, Math.ceil(SR * p.duration), SR)
    const d = nb.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const n = ctx.createBufferSource(); n.buffer = nb
    const gn = ctx.createGain(); gn.gain.value = 0.35 * p.noise
    n.connect(gn); gn.connect(lp); n.start(0)
  }

  const buf = await ctx.startRendering()
  // normalize to a healthy level; the edit stage has its own gain control
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
  }
  if (peak > 1e-6) {
    const g = 0.85 / peak
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < d.length; i++) d[i] *= g
    }
  }
  return buf
}

function synthName(p: SynthParams): string {
  const octave = Math.floor(p.note / 12) - 1
  return `${WAVE_LABEL[p.wave1]} ${NOTE_NAMES_SHARP[p.note % 12]}${octave}`
}

export function SynthDesigner({ onUse, applyLabel = 'Use this sound \u2192' }: { onUse: (buf: AudioBuffer, suggestedName: string) => void; applyLabel?: string }) {
  const [p, setP] = useState<SynthParams>(SYNTH_DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const previewRef = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)

  const set = <K extends keyof SynthParams>(k: K, v: SynthParams[K]) => setP(prev => ({ ...prev, [k]: v }))

  function stopPreview() {
    if (previewRef.current) {
      try { previewRef.current.src.stop() } catch { /* ok */ }
      void previewRef.current.ctx.close()
      previewRef.current = null
    }
    setPreviewing(false)
  }
  useEffect(() => () => stopPreview(), [])

  async function preview() {
    if (previewing) { stopPreview(); return }
    setBusy(true)
    try {
      const buf = await renderSynth(p)
      const ctx = new AudioContext()
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.onended = () => { previewRef.current = null; setPreviewing(false); void ctx.close() }
      src.start()
      previewRef.current = { src, ctx }
      setPreviewing(true)
    } catch { /* preview is best-effort */ }
    finally { setBusy(false) }
  }

  function randomize() {
    stopPreview()
    const r = (a: number, b: number) => a + Math.random() * (b - a)
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
    setP({
      wave1: pick(WAVES), wave2: pick(WAVES),
      interval: pick([-12, -5, 0, 3, 4, 7, 12, 19]),
      osc2Level: r(0, 0.8), noise: Math.random() < 0.4 ? r(0, 0.5) : 0,
      attack: r(0.002, 0.8), decay: r(0.05, 0.8), sustain: r(0.1, 0.9), release: r(0.05, 1.5),
      cutoff: Math.round(r(300, 9000)), drive: Math.random() < 0.4 ? r(0, 0.8) : 0,
      note: 36 + Math.floor(Math.random() * 37), duration: pick([1, 1.5, 2, 3, 4]),
    })
  }

  async function applySound() {
    stopPreview()
    setBusy(true)
    try { onUse(await renderSynth(p), synthName(p)) }
    finally { setBusy(false) }
  }

  const slider = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, k: keyof SynthParams) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 56, flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => set(k, Number(e.target.value) as SynthParams[typeof k])}
        style={{ flex: 1, accentColor: 'var(--accent)' }} />
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</span>
    </div>
  )

  const waveSelect = (label: string, value: Wave, k: 'wave1' | 'wave2') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 56, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {WAVES.map(w => (
          <button key={w} onClick={() => set(k, w)} style={{
            flex: 1, fontSize: 10, padding: '4px 0', borderRadius: 5, cursor: 'pointer',
            border: value === w ? '1px solid rgba(139,92,246,0.6)' : '1px solid var(--border)',
            background: value === w ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)',
            color: value === w ? 'var(--accent-light)' : 'var(--text-muted)', fontWeight: value === w ? 700 : 400,
          }}>{WAVE_LABEL[w]}</button>
        ))}
      </div>
    </div>
  )

  const octave = Math.floor(p.note / 12) - 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
        {waveSelect('Osc 1', p.wave1, 'wave1')}
        {waveSelect('Osc 2', p.wave2, 'wave2')}
        {slider('Osc 2 mix', p.osc2Level, 0, 1, 0.01, v => `${Math.round(v * 100)}%`, 'osc2Level')}
        {slider('Interval', p.interval, -24, 24, 1, v => `${v > 0 ? '+' : ''}${v} st`, 'interval')}
        {slider('Noise', p.noise, 0, 1, 0.01, v => `${Math.round(v * 100)}%`, 'noise')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
        {slider('Attack', p.attack, 0.002, 1.5, 0.002, v => `${(v * 1000).toFixed(0)}ms`, 'attack')}
        {slider('Decay', p.decay, 0.02, 1.5, 0.01, v => `${(v * 1000).toFixed(0)}ms`, 'decay')}
        {slider('Sustain', p.sustain, 0, 1, 0.01, v => `${Math.round(v * 100)}%`, 'sustain')}
        {slider('Release', p.release, 0.02, 2.5, 0.01, v => `${v.toFixed(2)}s`, 'release')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
        {slider('Filter', p.cutoff, 200, 12000, 10, v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}Hz`, 'cutoff')}
        {slider('Drive', p.drive, 0, 1, 0.01, v => `${Math.round(v * 100)}%`, 'drive')}
        {slider('Note', p.note, 24, 84, 1, () => `${NOTE_NAMES_SHARP[p.note % 12]}${octave}`, 'note')}
        {slider('Length', p.duration, 0.5, 8, 0.5, v => `${v.toFixed(1)}s`, 'duration')}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => void preview()} disabled={busy && !previewing}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: `1px solid ${previewing ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`, background: previewing ? 'rgba(139,92,246,0.12)' : 'var(--bg-card)', color: previewing ? 'var(--accent-light)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
          {previewing ? <><Square size={10} fill="currentColor" /> Stop</> : <><Play size={10} fill="currentColor" style={{ marginLeft: 1 }} /> Listen</>}
        </button>
        <button onClick={randomize}
          title="Roll the dice — random patch"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
          <Dices size={13} /> Surprise me
        </button>
        <button onClick={() => void applySound()} disabled={busy}
          style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: busy ? 'rgba(139,92,246,0.3)' : 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          {busy ? 'Rendering…' : applyLabel}
        </button>
      </div>
    </div>
  )
}

// ── Layered sample building ───────────────────────────────────────────────────
// One sound = a stack of layers (each its own source, offset, and shaping)
// mixed through motion effects whose parameters travel between two values
// over the sound's length — a pocket version of the editor's FX lane.

/** Trim/speed/gain/fade/reverse shaping for one buffer. Speed is tape-style:
 *  resampled by linear interpolation, so pitch follows. */
export function applyEdits(
  src: AudioBuffer,
  trimStart: number,
  trimEnd: number,
  gain: number,
  fadeInFrac: number,
  fadeOutFrac: number,
  reversed: boolean,
  speed = 1,
): AudioBuffer {
  const startSamp = Math.floor(trimStart * src.length)
  const endSamp   = Math.floor(trimEnd   * src.length)
  const len       = Math.max(1, endSamp - startSamp)
  const outLen    = Math.max(1, Math.round(len / speed))

  const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length: outLen, sampleRate: src.sampleRate })

  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const src_ = src.getChannelData(ch)
    const dst  = out.getChannelData(ch)
    for (let i = 0; i < outLen; i++) {
      const pos = startSamp + i * speed
      const i0 = Math.floor(pos), frac = pos - i0
      const a = src_[i0] ?? 0, b = src_[i0 + 1] ?? a
      dst[i] = (a + (b - a) * frac) * gain
    }
    const fi = Math.floor(fadeInFrac * outLen)
    for (let i = 0; i < fi; i++) dst[i] *= i / fi
    const fo = Math.floor(fadeOutFrac * outLen)
    for (let i = 0; i < fo; i++) dst[outLen - 1 - i] *= i / fo
    if (reversed) dst.reverse()
  }
  return out
}

export interface SoundLayer {
  id: string
  name: string
  buf: AudioBuffer
  offset: number      // seconds into the composite
  gain: number
  speed: number
  reversed: boolean
  trimStart: number   // 0..1
  trimEnd: number     // 0..1
  fadeIn: number      // 0..0.5 fraction
  fadeOut: number
  pan: number         // -1..1
}

export function makeLayer(buf: AudioBuffer, name: string): SoundLayer {
  return { id: crypto.randomUUID(), name, buf, offset: 0, gain: 1, speed: 1, reversed: false, trimStart: 0, trimEnd: 1, fadeIn: 0, fadeOut: 0, pan: 0 }
}

/** Audible length of a layer after trim and speed. */
export function layerSpan(l: SoundLayer): number {
  return Math.max(0.01, (l.trimEnd - l.trimStart) * l.buf.duration / l.speed)
}

export function compositeDuration(layers: SoundLayer[]): number {
  return Math.max(0.1, ...layers.map(l => l.offset + layerSpan(l)))
}

export type MotionFxType = 'filter' | 'volume' | 'pan' | 'drive' | 'echo'
export interface MotionFx { id: string; type: MotionFxType; from: number; to: number }

export const MOTION_FX_DEFS: Record<MotionFxType, {
  label: string; min: number; max: number; step: number
  defaults: [number, number]; fmt: (v: number) => string
}> = {
  filter: { label: 'Filter sweep', min: 200, max: 12000, step: 10, defaults: [500, 8000], fmt: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz` },
  volume: { label: 'Volume ride', min: 0, max: 1.5, step: 0.01, defaults: [0.2, 1], fmt: v => `${Math.round(v * 100)}%` },
  pan:    { label: 'Pan sweep', min: -1, max: 1, step: 0.01, defaults: [-0.8, 0.8], fmt: v => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}` },
  drive:  { label: 'Drive ramp', min: 0, max: 1, step: 0.01, defaults: [0, 0.6], fmt: v => `${Math.round(v * 100)}%` },
  echo:   { label: 'Echo rise', min: 0, max: 0.8, step: 0.01, defaults: [0, 0.45], fmt: v => `${Math.round(v * 100)}%` },
}

export function makeMotionFx(type: MotionFxType): MotionFx {
  const [from, to] = MOTION_FX_DEFS[type].defaults
  return { id: crypto.randomUUID(), type, from, to }
}

/** Mixes the layer stack and runs it through the motion-FX chain. */
export async function renderComposite(layers: SoundLayer[], fxs: MotionFx[]): Promise<AudioBuffer> {
  const SR = 44100
  const contentDur = compositeDuration(layers)
  const tail = fxs.some(f => f.type === 'echo' && Math.max(f.from, f.to) > 0.02) ? 1.2 : 0.05
  const total = contentDur + tail
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * total), SR)

  const bus = ctx.createGain()
  for (const l of layers) {
    const edited = applyEdits(l.buf, l.trimStart, l.trimEnd, l.gain, l.fadeIn, l.fadeOut, l.reversed, l.speed)
    const src = ctx.createBufferSource(); src.buffer = edited
    const pan = ctx.createStereoPanner(); pan.pan.value = l.pan
    src.connect(pan); pan.connect(bus)
    src.start(l.offset)
  }

  // chain: drive → filter → echo → pan → volume; each ramps over the content
  let node: AudioNode = bus
  for (const fx of fxs) {
    if (fx.type === 'drive') {
      const pre = ctx.createGain()
      pre.gain.setValueAtTime(1 + fx.from * 6, 0)
      pre.gain.linearRampToValueAtTime(1 + fx.to * 6, contentDur)
      const shaper = ctx.createWaveShaper()
      const curve = new Float32Array(1024)
      for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x) }
      shaper.curve = curve
      const post = ctx.createGain(); post.gain.value = 0.8
      node.connect(pre); pre.connect(shaper); shaper.connect(post); node = post
    } else if (fx.type === 'filter') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7
      lp.frequency.setValueAtTime(Math.max(40, fx.from), 0)
      lp.frequency.exponentialRampToValueAtTime(Math.max(40, fx.to), contentDur)
      node.connect(lp); node = lp
    } else if (fx.type === 'echo') {
      const dly = ctx.createDelay(1); dly.delayTime.value = 0.25
      const fb = ctx.createGain(); fb.gain.value = 0.45
      const wet = ctx.createGain()
      wet.gain.setValueAtTime(fx.from, 0)
      wet.gain.linearRampToValueAtTime(fx.to, contentDur)
      const sum = ctx.createGain()
      dly.connect(fb); fb.connect(dly)
      node.connect(sum)
      node.connect(dly); dly.connect(wet); wet.connect(sum)
      node = sum
    } else if (fx.type === 'pan') {
      const p = ctx.createStereoPanner()
      p.pan.setValueAtTime(fx.from, 0)
      p.pan.linearRampToValueAtTime(fx.to, contentDur)
      node.connect(p); node = p
    } else {
      const g = ctx.createGain()
      g.gain.setValueAtTime(fx.from, 0)
      g.gain.linearRampToValueAtTime(fx.to, contentDur)
      node.connect(g); node = g
    }
  }
  node.connect(ctx.destination)

  const buf = await ctx.startRendering()
  // clipping guard only — never boost, so deliberate quiet stays quiet
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
  }
  if (peak > 0.99) {
    const g = 0.95 / peak
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < d.length; i++) d[i] *= g
    }
  }
  return buf
}

// ── Layer rail (mini timeline) ────────────────────────────────────────────────

function LayerBar({ layer, totalDur, selected, onSelect, onOffsetChange }: {
  layer: SoundLayer; totalDur: number; selected: boolean
  onSelect: () => void; onOffsetChange: (offset: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null)

  const span = layerSpan(layer)
  const leftPct = (layer.offset / totalDur) * 100
  const widthPct = Math.max(3, (span / totalDur) * 100)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = selected ? 'rgba(196,181,253,0.9)' : 'rgba(139,92,246,0.55)'
    const d = layer.buf.getChannelData(0)
    const s0 = Math.floor(layer.trimStart * d.length)
    const s1 = Math.floor(layer.trimEnd * d.length)
    const step = Math.max(1, Math.floor((s1 - s0) / W))
    for (let x = 0; x < W; x++) {
      let m = 0
      const base = s0 + x * step
      for (let i = 0; i < step; i += 8) m = Math.max(m, Math.abs(d[base + i] ?? 0))
      const h = Math.max(1, m * H)
      ctx.fillRect(x, (H - h) / 2, 1, h)
    }
  }, [layer.buf, layer.trimStart, layer.trimEnd, selected])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current
      const row = rowRef.current
      if (!drag || !row) return
      const pxPerSec = row.getBoundingClientRect().width / totalDur
      onOffsetChange(Math.max(0, drag.startOffset + (e.clientX - drag.startX) / pxPerSec))
    }
    function onUp() { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [totalDur, onOffsetChange])

  return (
    <div ref={rowRef} style={{ position: 'relative', height: 30, background: 'rgba(255,255,255,0.02)', borderRadius: 5 }}>
      <div
        onMouseDown={e => { onSelect(); dragRef.current = { startX: e.clientX, startOffset: layer.offset }; e.preventDefault() }}
        title={`${layer.name} — drag to move in time`}
        style={{
          position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: 2, bottom: 2,
          borderRadius: 4, cursor: 'grab', overflow: 'hidden',
          border: selected ? '1px solid rgba(196,181,253,0.9)' : '1px solid rgba(139,92,246,0.35)',
          background: selected ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.1)',
        }}
      >
        <canvas ref={canvasRef} width={200} height={24} style={{ width: '100%', height: '100%', display: 'block' }} />
        <span style={{ position: 'absolute', left: 4, top: 1, fontSize: 8, color: selected ? '#e9e4ff' : 'var(--text-muted)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {layer.name}
        </span>
      </div>
    </div>
  )
}

export function LayerRail({ layers, selectedId, totalDur, onSelect, onOffsetChange, onRemove, onAddLayer }: {
  layers: SoundLayer[]
  selectedId: string | null
  totalDur: number
  onSelect: (id: string) => void
  onOffsetChange: (id: string, offset: number) => void
  onRemove: (id: string) => void
  onAddLayer: () => void
}) {
  const ticks: number[] = []
  const tickStep = totalDur > 6 ? 2 : totalDur > 3 ? 1 : 0.5
  for (let t = 0; t <= totalDur; t += tickStep) ticks.push(t)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Layers</span>
        <button onClick={onAddLayer} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 5, border: '1px dashed rgba(139,92,246,0.5)', background: 'rgba(139,92,246,0.08)', color: 'var(--accent-light)', cursor: 'pointer' }}>
          <Plus size={10} /> Overlay a sound
        </button>
      </div>
      {/* ruler */}
      <div style={{ position: 'relative', height: 12 }}>
        {ticks.map(t => (
          <span key={t} style={{ position: 'absolute', left: `${(t / totalDur) * 100}%`, fontSize: 8, color: 'var(--text-muted)', transform: 'translateX(-50%)', fontVariantNumeric: 'tabular-nums' }}>
            {t.toFixed(tickStep < 1 ? 1 : 0)}s
          </span>
        ))}
      </div>
      {layers.map(l => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <LayerBar
              layer={l} totalDur={totalDur} selected={l.id === selectedId}
              onSelect={() => onSelect(l.id)}
              onOffsetChange={o => onOffsetChange(l.id, o)}
            />
          </div>
          <button
            onClick={() => onRemove(l.id)} disabled={layers.length <= 1}
            aria-label={`Remove layer ${l.name}`}
            style={{ background: 'none', border: 'none', cursor: layers.length > 1 ? 'pointer' : 'default', color: layers.length > 1 ? 'var(--text-muted)' : 'transparent', display: 'flex', padding: 2, flexShrink: 0 }}
          ><X size={11} /></button>
        </div>
      ))}
    </div>
  )
}

// ── Motion FX panel ───────────────────────────────────────────────────────────

export function MotionFxPanel({ fxs, onChange }: { fxs: MotionFx[]; onChange: (fxs: MotionFx[]) => void }) {
  const patch = (id: string, p: Partial<MotionFx>) => onChange(fxs.map(f => f.id === id ? { ...f, ...p } : f))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Motion FX — start → end</span>
        <button
          onClick={() => onChange([...fxs, makeMotionFx('filter')])}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 5, border: '1px dashed rgba(52,211,153,0.5)', background: 'rgba(52,211,153,0.07)', color: '#34d399', cursor: 'pointer' }}
        ><Plus size={10} /> Add effect</button>
      </div>
      {fxs.length === 0 && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          Effects that travel across the sound — a filter opening up, volume swelling in, echo rising at the end.
        </p>
      )}
      {fxs.map(fx => {
        const def = MOTION_FX_DEFS[fx.type]
        return (
          <div key={fx.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={fx.type}
              onChange={e => {
                const type = e.target.value as MotionFxType
                const [from, to] = MOTION_FX_DEFS[type].defaults
                patch(fx.id, { type, from, to })
              }}
              style={{ fontSize: 10, padding: '3px 5px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', width: 96, flexShrink: 0 }}
            >
              {(Object.keys(MOTION_FX_DEFS) as MotionFxType[]).map(t => <option key={t} value={t}>{MOTION_FX_DEFS[t].label}</option>)}
            </select>
            <input type="range" min={def.min} max={def.max} step={def.step} value={fx.from}
              onChange={e => patch(fx.id, { from: Number(e.target.value) })}
              title="Value at the start" style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{def.fmt(fx.from)}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>→</span>
            <input type="range" min={def.min} max={def.max} step={def.step} value={fx.to}
              onChange={e => patch(fx.id, { to: Number(e.target.value) })}
              title="Value at the end" style={{ flex: 1, accentColor: '#34d399' }} />
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{def.fmt(fx.to)}</span>
            <button onClick={() => onChange(fxs.filter(f => f.id !== fx.id))} aria-label="Remove effect"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}>
              <X size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Share-to-Community dialog ─────────────────────────────────────────────────
// In-app replacement for the old window.prompt share flow — prompts don't
// exist in the desktop shell, and this also says plainly what kind the share
// becomes (the kind is decided by what you're sharing, never a choice).

const SHARE_KIND_INFO: Record<'sample' | 'recipe', { label: string; color: string; blurb: string }> = {
  sample: { label: 'Sample', color: '#60a5fa', blurb: 'the audio itself — others stream it and can link it into their library' },
  recipe: { label: 'Recipe', color: '#a78bfa', blurb: 'the note pattern — others drop it on a track and edit every note' },
}

export function ShareCommunityDialog({ kind, defaultName, onShare, onClose }: {
  kind: 'sample' | 'recipe'
  defaultName: string
  onShare: (name: string, description: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(defaultName)
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const info = SHARE_KIND_INFO[kind]

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function share() {
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    try {
      await onShare(name.trim(), desc.trim())
      setDone(true)
      setTimeout(onClose, 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed')
    } finally { setBusy(false) }
  }

  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: 'min(380px,92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Share to the Community</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={15} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: `${info.color}14`, border: `1px solid ${info.color}40` }}>
          <Globe2 size={13} style={{ color: info.color, flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 10.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            Shares as a <b style={{ color: info.color }}>{info.label}</b> — {info.blurb}. Anyone with the link can listen, no account needed.
          </p>
        </div>

        {done ? (
          <p style={{ fontSize: 12, color: '#34d399', margin: '4px 0', fontWeight: 700, textAlign: 'center' }}>
            Shared! It&apos;s live on the Community page ✓
          </p>
        ) : (
          <>
            <input
              autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void share() }}
              placeholder="Name"
              style={{ fontSize: 12, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <textarea
              value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Description — what is it, how would you use it? (optional)"
              rows={3}
              style={{ fontSize: 12, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
                Cancel
              </button>
              <button onClick={() => void share()} disabled={busy || !name.trim()}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', borderRadius: 8, border: 'none', background: busy ? 'rgba(139,92,246,0.3)' : 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                <Globe2 size={12} /> {busy ? 'Sharing…' : 'Share'}
              </button>
            </div>
            {error && <p style={{ fontSize: 11, color: '#ef4444', margin: 0, textAlign: 'center' }}>{error}</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
