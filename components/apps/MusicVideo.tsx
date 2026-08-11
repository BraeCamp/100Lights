'use client'

// Music Video — put a transcription ON a video as visuals. Upload a video, its audio is
// transcribed (the hybrid confidence engine — free for clean lines, AI only for the hard bits),
// and the notes drive a visual overlay synced to playback: falling notes, flowing shapes, radial
// spectrum, and more, with colour/font controls. Reuses lib/song-video (the falling-notes engine,
// via o.media = the <video> so it follows the video's clock) + the transcription pipeline.
// v1 = live preview + controls; video EXPORT is the next pass. Non-AI editing is free/unlimited.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Play, Square, Mic, Radio, Maximize2, X, ChevronLeft, Save, Upload } from 'lucide-react'
import { analyzeBufferAsync, type FeatureFrame } from '@/lib/voice-backfill'
import { scoreNotes, lowConfidenceFraction } from '@/lib/transcribe-confidence'
import { buildSketchProject } from '@/lib/open-in-studio'
import type { MidiNote } from '@/lib/daw-types'
// song-video is authored as .mjs (pure, no React) — import the engine + data builder + formats.
import { mountSongVideo } from '@/lib/song-video/engine.mjs'
import { songVideoData } from '@/lib/song-video/from-project.mjs'
import { FORMATS } from '@/lib/song-video/formats.mjs'
import { BG_STYLES } from '@/lib/song-video/backgrounds.mjs'
import AppChrome from '@/components/apps/AppChrome'
import MusicVideoHome from '@/components/apps/MusicVideoHome'
import { BG_LIBRARY, BG_CATEGORIES, clipsByCategory, type BgClip, type BgCategory } from '@/lib/bg-library'
import { GENRE_LOOKS, type GenreLook } from '@/lib/music-looks'

type Controller = { play: () => void; pause: () => void; destroy: () => void; update: (p: Record<string, unknown>) => void; resize: () => void }
const FONTS = ['system-ui', 'Georgia, serif', 'ui-monospace, monospace', 'Impact, sans-serif']

export default function MusicVideo() {
  return (
    <AppChrome slug="musicvideo">
      <MusicVideoApp />
    </AppChrome>
  )
}

function MusicVideoApp() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [notes, setNotes] = useState<MidiNote[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [aiFraction, setAiFraction] = useState(0)
  const [format, setFormat] = useState('falling-notes')
  const [bgStyle, setBgStyle] = useState('video')   // 'video' = your uploaded video shows through; else a generated bg
  const [exporting, setExporting] = useState(false)
  const [bgImageUrls, setBgImageUrls] = useState<string[]>([])   // pooled AI backgrounds (R2): 1 = still, 2+ = keyframe video
  const [poolBgs, setPoolBgs] = useState<{ key: string; url: string; genre: string }[]>([])
  const [accent, setAccent] = useState('#a78bfa')
  const [font, setFont] = useState('system-ui')
  const [live, setLive] = useState(false)   // party mode: visualize live audio from the device

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctrlRef = useRef<Controller | null>(null)

  const song = useMemo(() => {
    if (!notes.length) return null
    const daw = buildSketchProject(notes, [], { tempo: 100, name: 'Transcription', voice: {} })
    const beats = Math.max(8, Math.ceil(Math.max(...notes.map(n => n.startBeat + n.durationBeats)) + 2))
    const s = songVideoData(daw, { beats }) as { notes: unknown[]; tempo?: number }
    s.tempo = s.tempo || daw.tempo
    return { data: s, beats }
  }, [notes])

  const handleFile = useCallback(async (file: File) => {
    setBusy(true); setError(null); setPlaying(false); setNotes([])
    try {
      const buf = await file.arrayBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: file.type || 'video/mp4' }))
      setVideoUrl(url)
      const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const audio = await ac.decodeAudioData(buf.slice(0))
      const samples = new Float32Array(audio.getChannelData(0))
      const a = await analyzeBufferAsync(samples, audio.sampleRate, { sensitivity: 0.5, minDuration: 0.08, segmenter: 'hmm' })
      ac.close()
      if (!a.notes.length) { setError('No clear melody detected in the video audio. Works best with a solo instrument or vocal line.'); return }
      const scores = scoreNotes(a.notes, (a.curve || []) as FeatureFrame[], samples, audio.sampleRate)
      setAiFraction(lowConfidenceFraction(scores))
      setNotes(a.notes.map(n => ({ id: crypto.randomUUID(), pitch: n.midi, startBeat: (n.startSec * 100) / 60, durationBeats: Math.max(0.0625, (n.durSec * 100) / 60), velocity: n.velocity <= 1 ? Math.max(1, Math.round(n.velocity * 127)) : Math.round(n.velocity) })))
    } catch (e) {
      setError(e instanceof Error ? `Couldn't read that video's audio: ${e.message}` : 'Could not read the video.')
    } finally { setBusy(false) }
  }, [])

  // Mount / remount the overlay when the song, video, or FORMAT changes (format needs a remount).
  useEffect(() => {
    ctrlRef.current?.destroy(); ctrlRef.current = null
    const cv = canvasRef.current, vid = videoRef.current
    if (!cv || !vid || !song) return
    ctrlRef.current = mountSongVideo(cv, song.data, {
      media: vid, synth: false, format, accent, font, bgStyle, loopBeats: song.beats, brand: '', meta: '',
    }) as Controller
    return () => { ctrlRef.current?.destroy(); ctrlRef.current = null }
  }, [song, videoUrl, format])

  // Live-update colour/font/background without a remount (the engine reads these each frame).
  useEffect(() => { ctrlRef.current?.update({ accent, font, bgStyle }) }, [accent, font, bgStyle])

  // The pooled AI backgrounds (generated once, cached in R2 → $0 per video).
  useEffect(() => { fetch('/api/bg-pool').then(r => (r.ok ? r.json() : null)).then(d => { if (d?.backgrounds) setPoolBgs(d.backgrounds) }).catch(() => {}) }, [])
  // Load the chosen pooled image(s): 1 → static bgImage, 2+ → keyframe "video" (bgImages). Re-apply
  // after a remount. All from cached R2 stills → $0 AI per video.
  useEffect(() => {
    if (!bgImageUrls.length) { ctrlRef.current?.update({ bgImage: null, bgImages: null }); return }
    let cancelled = false
    Promise.all(bgImageUrls.map(url => new Promise<HTMLImageElement | null>(res => {
      const img = new Image(); img.crossOrigin = 'anonymous'
      img.onload = () => res(img); img.onerror = () => res(null); img.src = url
    }))).then(imgs => {
      if (cancelled) return
      const loaded = imgs.filter((x): x is HTMLImageElement => !!x)
      if (loaded.length >= 2) ctrlRef.current?.update({ bgImages: loaded, bgImage: null })
      else if (loaded.length === 1) ctrlRef.current?.update({ bgImage: loaded[0], bgImages: null })
      else ctrlRef.current?.update({ bgImage: null, bgImages: null })
    })
    return () => { cancelled = true }
  }, [bgImageUrls, song, format])

  const togglePlay = useCallback(() => {
    const vid = videoRef.current; if (!vid) return
    if (playing) { vid.pause(); setPlaying(false) }
    else { vid.play().catch(() => {}); setPlaying(true) }
  }, [playing])

  // Export LOCALLY (no upload, no AI): composite the video frame + the note/background overlay onto an
  // export canvas each frame, capture it + the video's audio via MediaRecorder, play through once, download.
  const exportVideo = useCallback(async () => {
    const vid = videoRef.current, overlay = canvasRef.current
    if (!vid || !overlay || exporting) return
    setExporting(true)
    try {
      const W = 1280, H = 720
      const ex = document.createElement('canvas'); ex.width = W; ex.height = H
      const exCtx = ex.getContext('2d')
      if (!exCtx) throw new Error('canvas unavailable')
      const stream = ex.captureStream(30)
      const vidStream = (vid as unknown as { captureStream?: () => MediaStream }).captureStream?.()
      for (const t of vidStream?.getAudioTracks() ?? []) stream.addTrack(t)
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks: BlobPart[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const stopped = new Promise<void>(res => { rec.onstop = () => res() })
      let raf = 0
      const draw = () => {
        const iw = vid.videoWidth || W, ih = vid.videoHeight || H, ir = iw / ih, cr = W / H
        let dw: number, dh: number
        if (ir > cr) { dh = H; dw = H * ir } else { dw = W; dh = W / ir }
        exCtx.fillStyle = '#000'; exCtx.fillRect(0, 0, W, H)
        exCtx.drawImage(vid, (W - dw) / 2, (H - dh) / 2, dw, dh)  // the user's video (covered when a generated bg is chosen)
        exCtx.drawImage(overlay, 0, 0, W, H)                       // notes + optional background
        raf = requestAnimationFrame(draw)
      }
      vid.pause(); vid.currentTime = 0
      await new Promise(res => setTimeout(res, 120))
      rec.start(100); draw(); setPlaying(true)
      await vid.play().catch(() => {})
      await new Promise<void>(res => { const on = () => { vid.removeEventListener('ended', on); res() }; vid.addEventListener('ended', on) })
      cancelAnimationFrame(raf); rec.stop(); await stopped; setPlaying(false)
      const blob = new Blob(chunks, { type: 'video/webm' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'music-video.webm'
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e) { setError(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed') }
    finally { setExporting(false) }
  }, [exporting])

  // Bespoke home when nothing is chosen yet.
  if (!live && !videoUrl) return <MusicVideoHome busy={busy} onFile={handleFile} onLive={() => setLive(true)} />

  return (
    <main id="main" className="max-w-2xl mx-auto" style={{ padding: '20px 18px 40px' }}>
      <header style={{ marginBottom: 18 }}>
        <button type="button" onClick={() => { setLive(false); setVideoUrl(null); setNotes([]) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <ChevronLeft size={16} /> Home
        </button>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>{live ? 'Live visuals' : 'Music Video'}</h1>
      </header>

      {live ? (
        <LiveVisualizer onExit={() => setLive(false)} />
      ) : (
        <>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden', background: '#000', border: '1px solid var(--border)' }}>
            <video ref={videoRef} src={videoUrl ?? undefined} playsInline onEnded={() => setPlaying(false)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
            {busy && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.5)', color: '#fff', gap: 8 }}><Loader2 size={26} style={{ animation: 'spin 1s linear infinite' }} /><span style={{ fontSize: 14, fontWeight: 700 }}>Detecting the melody…</span></div>}
          </div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 4px' }}>
            <button type="button" onClick={togglePlay} disabled={!notes.length} aria-label={playing ? 'Pause' : 'Play'} style={{ display: 'grid', placeItems: 'center', width: 50, height: 50, borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#0e0d12', cursor: notes.length ? 'pointer' : 'not-allowed', flexShrink: 0 }}>
              {playing ? <Square size={19} fill="#0e0d12" /> : <Play size={21} fill="#0e0d12" style={{ marginLeft: 2 }} />}
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {notes.length ? `${notes.length} notes · overlay follows the video` : 'analyzing…'}
            </span>
            <button type="button" onClick={() => { setVideoUrl(null); setNotes([]) }} style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Change video</button>
          </div>
          {notes.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted, var(--text-secondary))', margin: '2px 2px 16px' }}>
              {aiFraction > 0 ? `${Math.round(aiFraction * 100)}% of notes were low-confidence (chords/unclear) — only those would use the paid AI pass.` : 'Transcribed with no AI.'}
            </p>
          )}

          <Section label="Visual style">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {Object.entries(FORMATS as Record<string, { name: string }>).map(([key, f]) => {
                const active = format === key
                return <button key={key} type="button" onClick={() => setFormat(key)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-card)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>{f.name}</button>
              })}
            </div>
          </Section>
          <Section label="Background">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {(['video', 'none', ...BG_STYLES] as string[]).map(key => {
                const active = !bgImageUrls.length && bgStyle === key
                const label = key === 'video' ? 'Your video' : key === 'none' ? 'Dark' : key[0].toUpperCase() + key.slice(1)
                return <button key={key} type="button" onClick={() => { setBgStyle(key); setBgImageUrls([]) }} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-card)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>{label}</button>
              })}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0' }}>Procedural styles are free + audio-reactive.</p>
            {poolBgs.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                  AI backgrounds — generated once, reused (no per-video cost). {bgImageUrls.length >= 2 ? <strong style={{ color: 'var(--accent-light, var(--accent))' }}>{bgImageUrls.length} selected → AI video (motion + crossfade)</strong> : 'Pick one for a still, or 2+ for a moving AI video.'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {poolBgs.slice(0, 12).map(bg => {
                    const sel = bgImageUrls.includes(bg.url)
                    return <button key={bg.key} type="button" onClick={() => setBgImageUrls(prev => prev.includes(bg.url) ? prev.filter(u => u !== bg.url) : [...prev, bg.url])} title={bg.genre}
                      style={{ width: 40, height: 64, borderRadius: 8, overflow: 'hidden', padding: 0, cursor: 'pointer', background: 'var(--bg-card)', border: sel ? '2px solid var(--accent)' : '1px solid var(--border)', opacity: sel ? 1 : 0.85 }}>
                      { /* eslint-disable-next-line @next/next/no-img-element */ }
                      <img src={bg.url} alt={bg.genre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  })}
                </div>
              </div>
            )}
          </Section>
          <Section label="Colour & font">
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>Accent
                <input type="color" value={accent} onChange={e => setAccent(e.target.value)} style={{ width: 56, height: 40, padding: 0, border: '1px solid var(--border)', borderRadius: 9, background: 'none', cursor: 'pointer' }} />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {FONTS.map(fn => <button key={fn} type="button" onClick={() => setFont(fn)} style={{ padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, fontFamily: fn, cursor: 'pointer', border: '1px solid var(--border)', background: font === fn ? 'var(--accent)' : 'var(--bg-card)', color: font === fn ? '#0e0d12' : 'var(--text-secondary)' }}>Aa</button>)}
              </div>
            </div>
          </Section>
          <button type="button" onClick={exportVideo} disabled={exporting}
            style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 11, border: 'none', fontSize: 14, fontWeight: 800, cursor: exporting ? 'default' : 'pointer', background: exporting ? 'var(--border)' : 'var(--accent)', color: exporting ? 'var(--text-secondary)' : '#0e0d12' }}>
            {exporting ? 'Recording… (plays through once)' : 'Export video'}
          </button>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted, var(--text-secondary))', marginTop: 8 }}>Exports on your device — no upload, no AI cost. It plays through once to record.</p>
        </>
      )}
      {error && <p style={{ color: '#f87171', fontSize: 13.5, marginTop: 14 }}>{error}</p>}
    </main>
  )
}

// ── Live party visualizer ────────────────────────────────────────────────────────
// Drives the canvas from live audio: the microphone (universal — point the phone at
// the speaker) or, on desktop, captured tab/system audio (getDisplayMedia). A sync
// delay buffers recent frames so visuals can be nudged to line up with sound that
// reaches the room late over Bluetooth to a TV/projector.
type LiveStyle = 'bars' | 'radial' | 'wave'
type ColorMode = 'solid' | 'spectrum' | 'random'
interface Plane { h0: number; h1: number; sat: number; light: number }   // a hue band selected off the colour map
interface LiveColor { paletteId: string | null; plane: Plane | null; mode: ColorMode }
interface LiveOpts { style: LiveStyle; colors: string[]; mode: ColorMode; seed: number; gain: number; mirror: boolean; glow: boolean; trail: boolean; bg: boolean }

// Curated multi-colour palettes the user can pick, or derive their own from the colour map.
const PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: 'aurora', name: 'Aurora', colors: ['#22d3ee', '#34d399', '#a78bfa'] },
  { id: 'sunset', name: 'Sunset', colors: ['#fde047', '#fb7185', '#a855f7'] },
  { id: 'ocean', name: 'Ocean', colors: ['#38bdf8', '#22d3ee', '#2563eb'] },
  { id: 'neon', name: 'Neon', colors: ['#f0abfc', '#22d3ee', '#a3e635'] },
  { id: 'fire', name: 'Fire', colors: ['#fde047', '#fb923c', '#ef4444'] },
  { id: 'ice', name: 'Ice', colors: ['#e0f2fe', '#7dd3fc', '#818cf8'] },
  { id: 'candy', name: 'Candy', colors: ['#f472b6', '#c084fc', '#60a5fa'] },
  { id: 'mono', name: 'Mono', colors: ['#f8fafc', '#c7c7d1'] },
]

// Built-in animated backgrounds (no assets needed). A curated video library (aerial,
// beach, animals, mountains) can be added here once the clips are hosted.
const AMBIENTS: { id: string; name: string; css: string }[] = [
  { id: 'aurora', name: 'Aurora', css: 'linear-gradient(120deg,#0ea5e9,#22d3ee,#34d399,#a78bfa)' },
  { id: 'sunset', name: 'Sunset', css: 'linear-gradient(120deg,#f59e0b,#f43f5e,#a855f7)' },
  { id: 'ocean', name: 'Ocean', css: 'linear-gradient(120deg,#082f49,#0ea5e9,#22d3ee)' },
  { id: 'nebula', name: 'Nebula', css: 'linear-gradient(120deg,#4c1d95,#db2777,#f472b6)' },
  { id: 'forest', name: 'Forest', css: 'linear-gradient(120deg,#064e3b,#10b981,#a3e635)' },
]

function hsl(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}
function toRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return [255, 255, 255]
  const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a), [br, bg, bb] = toRgb(b)
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${m(ar, br)}${m(ag, bg)}${m(ab, bb)}`
}
function lighten(hex: string, amt: number): string {
  const [r, g, b] = toRgb(hex); const L = (c: number) => Math.round(c + (255 - c) * amt)
  return `rgb(${L(r)}, ${L(g)}, ${L(b)})`
}
// Interpolate palette stops into an n-colour ramp.
function rampFrom(stops: string[], n: number): string[] {
  if (stops.length <= 1) return Array(n).fill(stops[0] || '#ffffff')
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (stops.length - 1), lo = Math.floor(p), hi = Math.min(stops.length - 1, lo + 1)
    out.push(lerpHex(stops[lo], stops[hi], p - lo))
  }
  return out
}
function resolveColors(c: LiveColor, n = 16): string[] {
  if (c.plane) {
    const { h0, h1, sat, light } = c.plane, out: string[] = []
    for (let i = 0; i < n; i++) { const h = h0 + (h1 - h0) * (i / (n - 1)); out.push(hsl(((h % 360) + 360) % 360, sat, light)) }
    return out
  }
  const p = PALETTES.find(x => x.id === c.paletteId) ?? PALETTES[0]
  return rampFrom(p.colors, n)
}

function fillRR(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0 || h <= 0) return
  const rad = Math.min(r, w / 2, h / 2)
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.fill() }
  else ctx.fillRect(x, y, w, h)
}

function drawLive(cv: HTMLCanvasElement, freq: Uint8Array, wave: Uint8Array, o: LiveOpts) {
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
  const w = cv.clientWidth, h = cv.clientHeight
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
  const ctx = cv.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1
  // Over a background layer, keep the canvas see-through; on its own, paint the dark base.
  // Trails leave a soft comet tail either way (a translucent wash instead of a hard clear).
  if (o.bg) {
    ctx.clearRect(0, 0, w, h)
    if (o.trail) { ctx.fillStyle = 'rgba(8,7,13,0.20)'; ctx.fillRect(0, 0, w, h) }
  } else {
    ctx.fillStyle = o.trail ? 'rgba(8,7,13,0.30)' : '#08070d'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowBlur = o.glow ? Math.max(6, Math.min(w, h) * 0.03) : 0

  const n = freq.length, g = o.gain
  const N = o.colors.length
  const mid = o.colors[Math.floor(N / 2)]
  ctx.shadowColor = mid
  const randColor = (i: number) => { const x = Math.sin((i + 1) * 97.13 + o.seed) * 43758.5453; return o.colors[Math.floor((x - Math.floor(x)) * N)] }
  const colorAt = (t: number, i: number) => o.mode === 'solid' ? mid : o.mode === 'spectrum' ? o.colors[Math.min(N - 1, Math.max(0, Math.floor(t * N)))] : randColor(i)

  // Perceptual frequency sampling — spreads bass/mid/treble evenly instead of bunching low.
  const samp = (t: number) => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(Math.pow(t, 1.7) * n * 0.85)))
    return Math.min(1, (freq[idx] / 255) * g)
  }
  let sum = 0; for (let i = 0; i < n; i++) sum += freq[i]
  const level = Math.min(1, (sum / (n * 255)) * g)

  if (o.style === 'bars') {
    const solidGrad = ctx.createLinearGradient(0, 0, 0, h)
    solidGrad.addColorStop(0, lighten(mid, 0.55)); solidGrad.addColorStop(1, mid)
    const paint = (i: number, t: number) => { ctx.fillStyle = o.mode === 'solid' ? solidGrad : colorAt(t, i) }
    if (o.mirror) {
      const half = 30, bw = (w / 2) / half
      for (let i = 0; i < half; i++) {
        const t = i / half, bh = Math.max(3, samp(t) * h * 0.92)
        paint(i, t)
        fillRR(ctx, w / 2 + i * bw + 1, h - bh, bw - 2, bh, bw / 2)
        fillRR(ctx, w / 2 - (i + 1) * bw + 1, h - bh, bw - 2, bh, bw / 2)
      }
    } else {
      const count = 60, bw = w / count
      for (let i = 0; i < count; i++) {
        const t = i / count, bh = Math.max(3, samp(t) * h * 0.92)
        paint(i, t)
        fillRR(ctx, i * bw + 1, h - bh, bw - 2, bh, bw / 2)
      }
    }
  } else if (o.style === 'radial') {
    const cx = w / 2, cy = h / 2
    const base = Math.min(w, h) * 0.16 * (1 + level * 0.7)
    const amp = Math.min(w, h) * 0.34
    const pts = 120
    ctx.beginPath()
    for (let i = 0; i <= pts; i++) {
      const t = i / pts
      const r = base + samp(t < 0.5 ? t * 2 : (1 - t) * 2) * amp   // symmetric around the circle
      const a = t * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.closePath()
    const rg = ctx.createRadialGradient(cx, cy, base * 0.5, cx, cy, base + amp)
    if (o.mode === 'solid') { rg.addColorStop(0, lighten(mid, 0.4)); rg.addColorStop(1, mid) }
    else { rg.addColorStop(0, o.colors[0]); rg.addColorStop(0.5, mid); rg.addColorStop(1, o.colors[N - 1]) }
    ctx.fillStyle = rg; ctx.globalAlpha = 0.32; ctx.fill()
    ctx.globalAlpha = 1; ctx.lineWidth = Math.max(2, Math.min(w, h) / 260); ctx.strokeStyle = lighten(mid, 0.35); ctx.stroke()
  } else {
    if (o.mode === 'spectrum') {
      const lg = ctx.createLinearGradient(0, 0, w, 0)
      for (let i = 0; i < N; i++) lg.addColorStop(i / (N - 1), o.colors[i])
      ctx.strokeStyle = lg
    } else ctx.strokeStyle = lighten(mid, 0.3)
    ctx.lineWidth = Math.max(2.5, Math.min(w, h) / 200)
    ctx.beginPath()
    for (let i = 0; i < wave.length; i++) {
      const x = (i / (wave.length - 1)) * w
      const y = h / 2 + ((wave[i] - 128) / 128) * g * h * 0.42
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.stroke()
    ctx.lineTo(w, h / 2); ctx.lineTo(0, h / 2); ctx.closePath()
    ctx.globalAlpha = 0.12; ctx.fillStyle = mid; ctx.fill(); ctx.globalAlpha = 1
  }
  ctx.shadowBlur = 0
}

// A colour map: drag a rectangle to select a hue band + lightness → a custom spectrum.
function ColorPlane({ onChange }: { onChange: (p: Plane) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const drag = useRef(false)
  const H = 116

  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    const w = c.clientWidth || 300, dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
    c.width = Math.round(w * dpr); c.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const hue = ctx.createLinearGradient(0, 0, w, 0)
    for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60}, 85%, 55%)`)
    ctx.fillStyle = hue; ctx.fillRect(0, 0, w, H)
    const lg = ctx.createLinearGradient(0, 0, 0, H)
    lg.addColorStop(0, 'rgba(255,255,255,0.8)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.8)')
    ctx.fillStyle = lg; ctx.fillRect(0, 0, w, H)
  }, [])

  const frac = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }
  }
  const commit = (s: { x0: number; y0: number; x1: number; y1: number }) => {
    const h0 = Math.min(s.x0, s.x1) * 360, h1 = Math.max(s.x0, s.x1) * 360
    const yc = (s.y0 + s.y1) / 2
    onChange({ h0, h1: Math.max(h1, h0 + 12), sat: 82, light: Math.max(22, Math.min(90, Math.round(90 - yc * 68))) })
  }
  const down = (e: React.PointerEvent) => { drag.current = true; const p = frac(e); setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); (e.currentTarget as Element).setPointerCapture?.(e.pointerId) }
  const move = (e: React.PointerEvent) => { if (!drag.current) return; const p = frac(e); setSel(s => (s ? { ...s, x1: p.x, y1: p.y } : s)) }
  const up = () => { drag.current = false; if (sel) commit(sel) }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: '100%', height: H, borderRadius: 10, border: '1px solid var(--border)', cursor: 'crosshair', touchAction: 'none', display: 'block' }} />
      {sel && (
        <div style={{ position: 'absolute', left: `${Math.min(sel.x0, sel.x1) * 100}%`, top: `${Math.min(sel.y0, sel.y1) * 100}%`, width: `${Math.abs(sel.x1 - sel.x0) * 100}%`, height: `${Math.abs(sel.y1 - sel.y0) * 100}%`, border: '2px solid #fff', borderRadius: 4, boxShadow: '0 0 0 1px rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
      )}
    </div>
  )
}

function LiveVisualizer({ onExit }: { onExit: () => void }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [running, setRunning] = useState(false)
  const [source, setSource] = useState<'mic' | 'device' | null>(null)
  const [style, setStyle] = useState<LiveStyle>('bars')
  const [delayMs, setDelayMs] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [fs, setFs] = useState(false)
  // Customization — colour config (palette OR a plane off the colour map) + how it maps.
  const [colorCfg, setColorCfg] = useState<LiveColor>({ paletteId: 'aurora', plane: null, mode: 'spectrum' })
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6))
  const colors = useMemo(() => resolveColors(colorCfg), [colorCfg])
  const [presets, setPresets] = useState<{ id: string; name: string; cfg: LiveColor }[]>([])
  const [gain, setGain] = useState(1.3)
  const [smoothing, setSmoothing] = useState(0.82)
  const [mirror, setMirror] = useState(false)
  const [glow, setGlow] = useState(true)
  const [trail, setTrail] = useState(true)
  // Background layer + filters + "no audio" ambient mode
  const [bgKind, setBgKind] = useState<'none' | 'media' | 'library' | string>('none')   // 'none' | ambient id | 'media' | 'library'
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  const [bgVideo, setBgVideo] = useState(false)
  const [bgClip, setBgClip] = useState<BgClip | null>(null)
  const [bgCat, setBgCat] = useState<BgCategory>(BG_CATEGORIES[0])
  const [reactive, setReactive] = useState(true)
  const [matchVisuals, setMatchVisuals] = useState(true)   // tint the background with the palette
  const [eqFilters, setEqFilters] = useState(false)        // make the filters react to the audio
  const [blur, setBlur] = useState(0)
  const [brightness, setBrightness] = useState(1)
  const [saturate, setSaturate] = useState(1)
  const [hueRot, setHueRot] = useState(0)
  const bgInputRef = useRef<HTMLInputElement | null>(null)
  const bgFilterRef = useRef<HTMLDivElement | null>(null)  // filters applied here; EQ mode drives it per frame
  const ambient = AMBIENTS.find(a => a.id === bgKind)
  const hasBg = bgKind === 'media' ? !!bgUrl : bgKind === 'library' ? !!bgClip : !!ambient
  const bgFilter = `blur(${blur}px) brightness(${brightness}) saturate(${saturate}) hue-rotate(${hueRot}deg)`
  const pickBgFile = useCallback((f: File) => {
    setBgUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
    setBgVideo(f.type.startsWith('video/')); setBgKind('media')
  }, [])
  useEffect(() => () => { if (bgUrl) URL.revokeObjectURL(bgUrl) }, [bgUrl])
  // EQ-filter driver: the draw loop reads this; when off (or no audio), the static filter applies.
  const eqRef = useRef({ on: false, blur, brightness, saturate, hueRot })
  useEffect(() => { eqRef.current = { on: eqFilters && reactive, blur, brightness, saturate, hueRot } }, [eqFilters, reactive, blur, brightness, saturate, hueRot])
  // Restore the static filter whenever EQ mode is off (the loop may have left an imperative value).
  useEffect(() => { if ((!eqFilters || !reactive) && bgFilterRef.current) bgFilterRef.current.style.filter = bgFilter }, [eqFilters, reactive, bgFilter])

  // Genre "Looks" — apply a whole scene, with a random genre-appropriate background.
  const [activeLook, setActiveLook] = useState<GenreLook | null>(null)
  const shuffleTo = useCallback((look: GenreLook) => {
    const clips = look.bg.categories.flatMap(c => clipsByCategory(c))
    const pool: Array<{ a: string } | { c: BgClip }> = [...look.bg.ambients.map(id => ({ a: id })), ...clips.map(c => ({ c }))]
    if (!pool.length) return
    const pick = pool[Math.floor(Math.random() * pool.length)]
    if ('a' in pick) { setBgKind(pick.a); setBgClip(null) } else { setBgClip(pick.c); setBgKind('library') }
  }, [])
  const applyLook = useCallback((look: GenreLook) => {
    setStyle(look.style)
    setColorCfg({ paletteId: look.palette, plane: null, mode: look.mode })
    setGain(look.gain); setSmoothing(look.smoothing)
    setMirror(look.mirror); setGlow(look.glow); setTrail(look.trail)
    setMatchVisuals(look.match); setEqFilters(look.eq)
    setBlur(look.filters.blur); setBrightness(look.filters.brightness); setSaturate(look.filters.saturate); setHueRot(look.filters.hue)
    setBgCat(look.bg.categories[0]); setActiveLook(look); shuffleTo(look)
  }, [shuffleTo])

  useEffect(() => { try { const r = localStorage.getItem('musicvideo-colorpresets'); if (r) setPresets(JSON.parse(r)) } catch { /* off */ } }, [])
  const savePreset = useCallback(() => {
    const name = (typeof prompt === 'function' ? prompt('Name this colour preset') : '')?.trim()
    if (!name) return
    setPresets(prev => {
      const next = [...prev.filter(p => p.name !== name), { id: `${Date.now()}`, name, cfg: colorCfg }].slice(-24)
      try { localStorage.setItem('musicvideo-colorpresets', JSON.stringify(next)) } catch { /* off */ }
      return next
    })
  }, [colorCfg])
  const removePreset = useCallback((id: string) => setPresets(prev => { const next = prev.filter(p => p.id !== id); try { localStorage.setItem('musicvideo-colorpresets', JSON.stringify(next)) } catch { /* off */ } return next }), [])

  const audioRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)
  const bufRef = useRef<Array<{ t: number; freq: Uint8Array; wave: Uint8Array }>>([])
  const optsRef = useRef<LiveOpts>({ style, colors, mode: colorCfg.mode, seed, gain, mirror, glow, trail, bg: hasBg })
  useEffect(() => { optsRef.current = { style, colors, mode: colorCfg.mode, seed, gain, mirror, glow, trail, bg: hasBg } }, [style, colors, colorCfg.mode, seed, gain, mirror, glow, trail, hasBg])
  const delayRef = useRef(delayMs); useEffect(() => { delayRef.current = delayMs }, [delayMs])
  const smoothingRef = useRef(smoothing)
  useEffect(() => { smoothingRef.current = smoothing; if (analyserRef.current) analyserRef.current.smoothingTimeConstant = smoothing }, [smoothing])

  const wake = useCallback(async () => {
    try { wakeRef.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* unsupported */ }
  }, [])

  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    void audioRef.current?.close().catch(() => {}); audioRef.current = null
    void wakeRef.current?.release().catch(() => {}); wakeRef.current = null
    analyserRef.current = null; bufRef.current = []
    setRunning(false); setSource(null)
  }, [])

  const start = useCallback(async (src: 'mic' | 'device') => {
    setErr(null)
    try {
      const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: unknown) => Promise<MediaStream> }
      let stream: MediaStream
      if (src === 'device') {
        // The browser has no API to grab internal audio silently — capturing another tab/app's
        // sound is only possible through the screen-share prompt (a platform security rule). We
        // keep ONLY the audio and drop the video track immediately, so nothing is recorded.
        if (!md.getDisplayMedia) throw new Error('Capturing another app’s sound needs a desktop browser. On a phone, use the microphone and point it at the speaker.')
        // Must request video too (Chrome only offers "Share tab audio" alongside a tab/screen),
        // but we KEEP the whole stream alive — stopping the video track ends the share and kills
        // the audio with it. We simply never render the video.
        stream = await md.getDisplayMedia({ video: true, audio: true })
        if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); throw new Error('No audio was shared. In the picker, pick a browser tab (not a window) and turn on “Share tab audio”.') }
      } else {
        stream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      }
      streamRef.current = stream
      stream.getTracks().forEach(t => t.addEventListener('ended', () => stop()))   // user hit "Stop sharing"
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC(); audioRef.current = ctx
      await ctx.resume().catch(() => {})
      const node = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = smoothingRef.current
      node.connect(an); analyserRef.current = an
      setSource(src); setRunning(true)
      void wake()
      const draw = () => {
        const a = analyserRef.current, cv = canvasRef.current
        if (a && cv) {
          const freq = new Uint8Array(a.frequencyBinCount); a.getByteFrequencyData(freq)
          const wave = new Uint8Array(a.fftSize); a.getByteTimeDomainData(wave)
          const now = performance.now()
          const buf = bufRef.current
          buf.push({ t: now, freq, wave })
          while (buf.length && now - buf[0].t > 1300) buf.shift()
          const target = now - delayRef.current
          let f = buf[buf.length - 1]
          for (let i = buf.length - 1; i >= 0; i--) { if (buf[i].t <= target) { f = buf[i]; break } }
          drawLive(cv, f.freq, f.wave, optsRef.current)
          // Filters interacting with the EQ — pulse brightness/saturation, sharpen on energy.
          const eq = eqRef.current
          if (eq.on && bgFilterRef.current) {
            let s = 0; for (let i = 0; i < f.freq.length; i++) s += f.freq[i]
            const level = Math.min(1, (s / (f.freq.length * 255)) * optsRef.current.gain)
            bgFilterRef.current.style.filter = `blur(${(eq.blur * (1 - level * 0.4)).toFixed(1)}px) brightness(${(eq.brightness * (0.7 + level * 0.75)).toFixed(2)}) saturate(${(eq.saturate * (0.85 + level * 0.7)).toFixed(2)}) hue-rotate(${Math.round(eq.hueRot + level * 55)}deg)`
          }
        }
        rafRef.current = requestAnimationFrame(draw)
      }
      rafRef.current = requestAnimationFrame(draw)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not access audio.')
      stop()
    }
  }, [stop])

  const toggleFs = useCallback(() => {
    const el = wrapRef.current; if (!el) return
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {})
    else document.exitFullscreen?.().catch(() => {})
  }, [])
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  // Wake locks drop when the tab hides — re-acquire when it comes back so the screen stays on.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && streamRef.current && !wakeRef.current) void wake() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [wake])
  useEffect(() => () => stop(), [stop])

  return (
    <div>
      <style>{`@keyframes mv-amb{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}} .mv-ambient{animation:mv-amb 16s ease-in-out infinite}`}</style>
      <div ref={wrapRef} style={{ position: 'relative', width: '100%', aspectRatio: fs ? undefined : '16 / 9', height: fs ? '100dvh' : undefined, borderRadius: fs ? 0 : 14, overflow: 'hidden', background: '#08070d', border: fs ? 'none' : '1px solid var(--border)' }}>
        {/* Background layer — ambient gradient, library clip (streamed), or your own upload; filtered here */}
        {hasBg && (
          <div ref={bgFilterRef} style={{ position: 'absolute', inset: 0, filter: bgFilter }}>
            {bgKind === 'media' ? (
              bgVideo
                ? <video src={bgUrl ?? undefined} autoPlay loop muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={bgUrl ?? undefined} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : bgKind === 'library' && bgClip ? (
              <>
                {/* poster/tint shows offline or until the clip streams in */}
                <div style={{ position: 'absolute', inset: 0, backgroundImage: bgClip.tint, backgroundSize: 'cover' }} />
                <img src={bgClip.preview} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                <video key={bgClip.id} src={bgClip.src} poster={bgClip.preview} autoPlay loop muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLVideoElement).style.display = 'none' }} />
              </>
            ) : (
              <div className="mv-ambient" style={{ position: 'absolute', inset: 0, backgroundImage: ambient?.css, backgroundSize: '240% 240%' }} />
            )}
            {/* Palette match — tint the background toward the visualizer colours */}
            {matchVisuals && <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(120deg, ${colors.join(', ')})`, mixBlendMode: 'overlay', opacity: 0.5, pointerEvents: 'none' }} />}
          </div>
        )}

        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: reactive ? 'block' : 'none' }} />

        {reactive && !running && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', gap: 14, padding: 24, textAlign: 'center', background: hasBg ? 'rgba(6,5,10,0.45)' : 'transparent' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Visualize the music in the room</p>
            <button type="button" onClick={() => start('mic')} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 22px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 15, fontWeight: 850, cursor: 'pointer' }}><Mic size={18} /> Use microphone</button>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, maxWidth: 320, lineHeight: 1.5 }}>Point your device at the speaker — no prompts, nothing recorded.</p>
            <button type="button" onClick={() => start('device')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}><Radio size={14} /> Or capture a tab’s sound (desktop)</button>
          </div>
        )}
        {!reactive && (
          <div style={{ position: 'absolute', left: 12, bottom: 12, padding: '5px 10px', borderRadius: 999, background: 'rgba(0,0,0,0.4)', color: '#fff', fontSize: 12, fontWeight: 700 }}>Background only</div>
        )}
        {(running || !reactive) && (
          <button type="button" onClick={toggleFs} aria-label="Fullscreen" style={{ position: 'absolute', top: 10, right: 10, display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}><Maximize2 size={17} /></button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 4px', flexWrap: 'wrap' }}>
        {running
          ? <button type="button" onClick={stop} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><Square size={15} /> Stop</button>
          : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not listening</span>}
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{source === 'device' ? 'Capturing device audio' : source === 'mic' ? 'Listening to the room' : ''}</span>
        <button type="button" onClick={() => { stop(); onExit() }} style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Exit live</button>
      </div>

      <Section label="Genre look">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {GENRE_LOOKS.map(l => (
            <button key={l.id} type="button" onClick={() => applyLook(l)} title={l.desc}
              style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: activeLook?.id === l.id ? 'var(--accent)' : 'var(--bg-card)', color: activeLook?.id === l.id ? '#0e0d12' : 'var(--text-secondary)' }}>{l.name}</button>
          ))}
        </div>
        {activeLook && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '9px 0 0' }}>
            {activeLook.desc} · a random {activeLook.bg.categories.join(' / ')} background.{' '}
            <button type="button" onClick={() => shuffleTo(activeLook)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Shuffle background</button>
          </p>
        )}
      </Section>

      <Section label="Visual style">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {(['bars', 'radial', 'wave'] as LiveStyle[]).map(s => (
            <button key={s} type="button" onClick={() => setStyle(s)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: style === s ? 'var(--accent)' : 'var(--bg-card)', color: style === s ? '#0e0d12' : 'var(--text-secondary)' }}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
      </Section>
      <Section label="Colour">
        {/* Palettes */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {PALETTES.map(p => {
            const active = colorCfg.paletteId === p.id
            return (
              <button key={p.id} type="button" title={p.name} aria-label={p.name}
                onClick={() => setColorCfg(c => ({ ...c, paletteId: p.id, plane: null }))}
                style={{ width: 54, height: 26, borderRadius: 8, background: `linear-gradient(90deg, ${p.colors.join(', ')})`, border: active ? '2px solid #fff' : '2px solid var(--border)', cursor: 'pointer', padding: 0 }} />
            )
          })}
        </div>

        {/* Colour map — drag a rectangle to pick a hue band + lightness */}
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 7px' }}>Or drag a spectrum off the colour map:</p>
        <ColorPlane onChange={p => setColorCfg(c => ({ ...c, plane: p, paletteId: null }))} />
        {colorCfg.plane && <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0' }}>Custom spectrum · hue {Math.round(colorCfg.plane.h0)}–{Math.round(colorCfg.plane.h1)}°</p>}

        {/* Live spectrum preview */}
        <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', margin: '12px 0 0', border: '1px solid var(--border)' }}>
          {colors.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
        </div>

        {/* Pattern */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', margin: '14px 0 0' }}>
          {(['solid', 'spectrum', 'random'] as ColorMode[]).map(m => (
            <button key={m} type="button" onClick={() => setColorCfg(c => ({ ...c, mode: m }))}
              style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: colorCfg.mode === m ? 'var(--accent)' : 'var(--bg-card)', color: colorCfg.mode === m ? '#0e0d12' : 'var(--text-secondary)' }}>{m[0].toUpperCase() + m.slice(1)}</button>
          ))}
          {colorCfg.mode === 'random' && (
            <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 1e6))} style={{ padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>Shuffle</button>
          )}
        </div>

        {/* Saved colour presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '14px 0 0' }}>
          <button type="button" onClick={savePreset} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}><Save size={13} /> Save colours</button>
          {presets.map(p => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 4px 4px 11px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-base)', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
              <button type="button" onClick={() => setColorCfg(p.cfg)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 700 }}>{p.name}</button>
              <button type="button" onClick={() => removePreset(p.id)} aria-label="Delete preset" style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 999, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={12} /></button>
            </span>
          ))}
        </div>
      </Section>

      <Section label="Feel">
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" onClick={() => setMirror(v => !v)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: mirror ? 'var(--accent)' : 'var(--bg-card)', color: mirror ? '#0e0d12' : 'var(--text-secondary)' }}>Mirror</button>
          <button type="button" onClick={() => setGlow(v => !v)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: glow ? 'var(--accent)' : 'var(--bg-card)', color: glow ? '#0e0d12' : 'var(--text-secondary)' }}>Glow</button>
          <button type="button" onClick={() => setTrail(v => !v)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: trail ? 'var(--accent)' : 'var(--bg-card)', color: trail ? '#0e0d12' : 'var(--text-secondary)' }}>Trails</button>
        </div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>Sensitivity</label>
        <input type="range" min={0.5} max={2.6} step={0.1} value={gain} onChange={e => setGain(parseFloat(e.target.value))} style={{ width: '100%', maxWidth: 320 }} />
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 5px' }}>Smoothness</label>
        <input type="range" min={0} max={0.95} step={0.01} value={smoothing} onChange={e => setSmoothing(parseFloat(e.target.value))} style={{ width: '100%', maxWidth: 320 }} />
      </Section>

      <Section label="Background">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 6 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={reactive} onChange={e => setReactive(e.target.checked)} /> Audio-reactive visuals
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={matchVisuals} onChange={e => setMatchVisuals(e.target.checked)} /> Match my palette
          </label>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>Reactive off = play a background with filters, no audio. Match tints the background toward your visualizer colours.</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={() => setBgKind('none')} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: bgKind === 'none' ? 'var(--accent)' : 'var(--bg-card)', color: bgKind === 'none' ? '#0e0d12' : 'var(--text-secondary)' }}>None</button>
          {AMBIENTS.map(a => (
            <button key={a.id} type="button" onClick={() => setBgKind(a.id)} title={a.name} aria-label={a.name}
              style={{ width: 54, height: 26, borderRadius: 8, backgroundImage: a.css, backgroundSize: '160% 160%', border: bgKind === a.id ? '2px solid #fff' : '2px solid var(--border)', cursor: 'pointer', padding: 0 }} />
          ))}
          <button type="button" onClick={() => bgInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: bgKind === 'media' ? 'var(--accent)' : 'var(--bg-card)', color: bgKind === 'media' ? '#0e0d12' : 'var(--text-secondary)' }}><Upload size={13} /> Upload</button>
          <input ref={bgInputRef} type="file" accept="video/*,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) pickBgFile(f); e.currentTarget.value = '' }} />
        </div>

        {/* Streamed video library */}
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '16px 0 8px' }}>Library — streams online, low-res preview offline:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {BG_CATEGORIES.map(cat => (
            <button key={cat} type="button" onClick={() => setBgCat(cat)} style={{ padding: '6px 11px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: bgCat === cat ? 'var(--accent)' : 'var(--bg-card)', color: bgCat === cat ? '#0e0d12' : 'var(--text-secondary)' }}>{cat}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
          {clipsByCategory(bgCat).map(clip => {
            const active = bgKind === 'library' && bgClip?.id === clip.id
            return (
              <button key={clip.id} type="button" onClick={() => { setBgClip(clip); setBgKind('library') }} title={clip.title}
                style={{ position: 'relative', aspectRatio: '16 / 10', borderRadius: 9, overflow: 'hidden', padding: 0, cursor: 'pointer', border: active ? '2px solid var(--accent)' : '1px solid var(--border)', backgroundImage: clip.tint, backgroundSize: 'cover' }}>
                <img src={clip.preview} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '3px 5px', fontSize: 9.5, fontWeight: 700, color: '#fff', background: 'linear-gradient(0deg, rgba(0,0,0,0.65), transparent)', textAlign: 'left' }}>{clip.title}</span>
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0' }}>Library clips stream from the cloud; a low-res preview is cached for offline. Or upload your own.</p>
      </Section>

      {hasBg && (
        <Section label="Background filters">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', cursor: reactive ? 'pointer' : 'not-allowed', opacity: reactive ? 1 : 0.5, marginBottom: 12 }}>
            <input type="checkbox" checked={eqFilters} onChange={e => setEqFilters(e.target.checked)} disabled={!reactive} /> React to the audio (EQ)
          </label>
          {eqFilters && reactive && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '-6px 0 12px' }}>Brightness &amp; saturation pulse with the music; the sliders set the baseline.</p>}
          {!reactive && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '-6px 0 12px' }}>Turn on audio-reactive visuals to make filters react.</p>}
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Blur — {blur}px</label>
          <input type="range" min={0} max={24} step={1} value={blur} onChange={e => setBlur(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 4px' }}>Brightness</label>
          <input type="range" min={0.3} max={1.6} step={0.05} value={brightness} onChange={e => setBrightness(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 4px' }}>Saturation</label>
          <input type="range" min={0} max={2.2} step={0.05} value={saturate} onChange={e => setSaturate(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 4px' }}>Hue shift — {hueRot}°</label>
          <input type="range" min={0} max={360} step={5} value={hueRot} onChange={e => setHueRot(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <button type="button" onClick={() => { setBlur(0); setBrightness(1); setSaturate(1); setHueRot(0) }} style={{ marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reset filters</button>
        </Section>
      )}

      <Section label={`Sync delay — ${delayMs} ms`}>
        <input type="range" min={0} max={600} step={10} value={delayMs} onChange={e => setDelayMs(parseInt(e.target.value, 10))} style={{ width: '100%', maxWidth: 320 }} />
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0' }}>Nudge the visuals later to match sound that reaches the room a beat behind — e.g. streaming to a TV or Bluetooth speaker.</p>
      </Section>
      {err && <p style={{ color: '#f87171', fontSize: 13.5, marginTop: 8 }}>{err}</p>}
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Party setup:</strong> tap fullscreen and drag this window onto your TV or projector — it keeps running while its window stays visible, so you can use other apps beside it. The mic is the reliable way to visualize the room: point your device at the speaker. Grabbing another app’s audio directly (Spotify, Apple Music) isn’t possible on iPhone and is limited on Android — a phone can’t silently tap another app’s sound — so the mic stays the go-to; on a computer you can also capture a browser tab’s sound.
      </p>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, var(--text-secondary))', margin: '0 0 9px' }}>{label}</p>
      {children}
    </section>
  )
}
