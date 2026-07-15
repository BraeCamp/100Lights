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
import { Play, Square, Dices, BookmarkPlus, Search } from 'lucide-react'
import { libraryGetAll, type LibraryEntry } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import { importRecipe } from '@/lib/practice-recipes'
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
export async function saveUserRecipe(clip: MidiClip, title: string, tagline: string, share: boolean): Promise<void> {
  importRecipe({
    id: `user-${crypto.randomUUID()}`,
    title,
    tagline: tagline || 'My recipe',
    annotation: [],
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
      await saveUserRecipe(clip, t, desc.trim(), share)
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
          background: '#161616', border: '1px solid #2e2e2e', borderRadius: 10,
          padding: '12px 14px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{ fontSize: 12, fontWeight: 800, color: '#eee', margin: 0 }}>Save as recipe</p>
          {clip.notes.length === 0 ? (
            <p style={{ fontSize: 10.5, color: '#888', margin: 0, lineHeight: 1.5 }}>
              Add some notes first — a recipe is the pattern you&apos;ve written here.
            </p>
          ) : (
            <>
              <input
                value={title} onChange={e => setTitle(e.target.value)} placeholder="Recipe name"
                style={{ fontSize: 11, padding: '6px 9px', borderRadius: 6, background: '#101010', border: '1px solid #2e2e2e', color: '#ddd', outline: 'none' }}
              />
              <input
                value={desc} onChange={e => setDesc(e.target.value)} placeholder="What makes it work? (optional)"
                style={{ fontSize: 11, padding: '6px 9px', borderRadius: 6, background: '#101010', border: '1px solid #2e2e2e', color: '#ddd', outline: 'none' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: '#aaa', cursor: 'pointer' }}>
                <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} style={{ accentColor: '#34d399' }} />
                Also share to the Community
              </label>
              <button
                onClick={() => void save()} disabled={busy}
                style={{ padding: '7px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: busy ? 'rgba(52,211,153,0.3)' : '#34d399', color: '#0c221a' }}
              >
                {busy ? 'Saving…' : 'Save recipe'}
              </button>
              <p style={{ fontSize: 9.5, color: '#666', margin: 0, lineHeight: 1.4 }}>
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

export function SynthDesigner({ onUse }: { onUse: (buf: AudioBuffer, suggestedName: string) => void }) {
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
          {busy ? 'Rendering…' : 'Use this sound →'}
        </button>
      </div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
        Next step adds trim, speed, fades, and reverse before saving to your library.
      </p>
    </div>
  )
}
