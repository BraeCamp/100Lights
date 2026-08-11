'use client'

// Music Video — put a transcription ON a video as visuals. Upload a video, its audio is
// transcribed (the hybrid confidence engine — free for clean lines, AI only for the hard bits),
// and the notes drive a visual overlay synced to playback: falling notes, flowing shapes, radial
// spectrum, and more, with colour/font controls. Reuses lib/song-video (the falling-notes engine,
// via o.media = the <video> so it follows the video's clock) + the transcription pipeline.
// v1 = live preview + controls; video EXPORT is the next pass. Non-AI editing is free/unlimited.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Play, Square, Mic, Radio, Maximize2, X, ChevronLeft } from 'lucide-react'
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
        <LiveVisualizer accent={accent} onExit={() => setLive(false)} />
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
interface LiveOpts { style: LiveStyle; color: string; gain: number; mirror: boolean; glow: boolean; trail: boolean }

// Nudge a hex colour toward white (for gradient tops / highlights).
function lighten(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const L = (c: number) => Math.round(c + (255 - c) * amt)
  return `rgb(${L(r)}, ${L(g)}, ${L(b)})`
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
  // Trails: paint a translucent wash instead of clearing, so motion leaves a soft comet tail.
  ctx.fillStyle = o.trail ? 'rgba(8,7,13,0.30)' : '#08070d'
  ctx.fillRect(0, 0, w, h)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowBlur = o.glow ? Math.max(6, Math.min(w, h) * 0.03) : 0
  ctx.shadowColor = o.color

  const n = freq.length, g = o.gain
  // Perceptual frequency sampling — spreads bass/mid/treble evenly instead of bunching low.
  const samp = (t: number) => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(Math.pow(t, 1.7) * n * 0.85)))
    return Math.min(1, (freq[idx] / 255) * g)
  }
  let sum = 0; for (let i = 0; i < n; i++) sum += freq[i]
  const level = Math.min(1, (sum / (n * 255)) * g)

  if (o.style === 'bars') {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, lighten(o.color, 0.55)); grad.addColorStop(1, o.color)
    ctx.fillStyle = grad
    if (o.mirror) {
      const half = 30, bw = (w / 2) / half
      for (let i = 0; i < half; i++) {
        const bh = Math.max(3, samp(i / half) * h * 0.92)
        fillRR(ctx, w / 2 + i * bw + 1, h - bh, bw - 2, bh, bw / 2)
        fillRR(ctx, w / 2 - (i + 1) * bw + 1, h - bh, bw - 2, bh, bw / 2)
      }
    } else {
      const count = 60, bw = w / count
      for (let i = 0; i < count; i++) {
        const bh = Math.max(3, samp(i / count) * h * 0.92)
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
    rg.addColorStop(0, lighten(o.color, 0.4)); rg.addColorStop(1, o.color)
    ctx.fillStyle = rg; ctx.globalAlpha = 0.3; ctx.fill()
    ctx.globalAlpha = 1; ctx.lineWidth = Math.max(2, Math.min(w, h) / 260); ctx.strokeStyle = lighten(o.color, 0.35); ctx.stroke()
  } else {
    ctx.lineWidth = Math.max(2.5, Math.min(w, h) / 200)
    ctx.strokeStyle = lighten(o.color, 0.3)
    ctx.beginPath()
    for (let i = 0; i < wave.length; i++) {
      const x = (i / (wave.length - 1)) * w
      const y = h / 2 + ((wave[i] - 128) / 128) * g * h * 0.42
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.stroke()
    ctx.lineTo(w, h / 2); ctx.lineTo(0, h / 2); ctx.closePath()
    ctx.globalAlpha = 0.12; ctx.fillStyle = o.color; ctx.fill(); ctx.globalAlpha = 1
  }
  ctx.shadowBlur = 0
}

function LiveVisualizer({ accent, onExit }: { accent: string; onExit: () => void }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [running, setRunning] = useState(false)
  const [source, setSource] = useState<'mic' | 'device' | null>(null)
  const [style, setStyle] = useState<LiveStyle>('bars')
  const [delayMs, setDelayMs] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [fs, setFs] = useState(false)
  // Customization
  const [color, setColor] = useState(accent)
  const [gain, setGain] = useState(1.3)
  const [smoothing, setSmoothing] = useState(0.82)
  const [mirror, setMirror] = useState(false)
  const [glow, setGlow] = useState(true)
  const [trail, setTrail] = useState(true)

  const audioRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)
  const bufRef = useRef<Array<{ t: number; freq: Uint8Array; wave: Uint8Array }>>([])
  const optsRef = useRef<LiveOpts>({ style, color, gain, mirror, glow, trail })
  useEffect(() => { optsRef.current = { style, color, gain, mirror, glow, trail } }, [style, color, gain, mirror, glow, trail])
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
      <div ref={wrapRef} style={{ position: 'relative', width: '100%', aspectRatio: fs ? undefined : '16 / 9', height: fs ? '100dvh' : undefined, borderRadius: fs ? 0 : 14, overflow: 'hidden', background: '#08070d', border: fs ? 'none' : '1px solid var(--border)' }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        {!running && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Visualize the music in the room</p>
            <button type="button" onClick={() => start('mic')} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 22px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 15, fontWeight: 850, cursor: 'pointer' }}><Mic size={18} /> Use microphone</button>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, maxWidth: 320, lineHeight: 1.5 }}>Point your device at the speaker — no prompts, nothing recorded.</p>
            <button type="button" onClick={() => start('device')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}><Radio size={14} /> Or capture a tab’s sound (desktop)</button>
          </div>
        )}
        {running && (
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

      <Section label="Visual style">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {(['bars', 'radial', 'wave'] as LiveStyle[]).map(s => (
            <button key={s} type="button" onClick={() => setStyle(s)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: style === s ? 'var(--accent)' : 'var(--bg-card)', color: style === s ? '#0e0d12' : 'var(--text-secondary)' }}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
      </Section>
      <Section label="Colour">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          {['#a78bfa', '#22d3ee', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#f43f5e', '#ffffff'].map(c => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={c}
              style={{ width: 26, height: 26, borderRadius: 999, background: c, border: color.toLowerCase() === c ? '2px solid #fff' : '2px solid var(--border)', cursor: 'pointer', padding: 0 }} />
          ))}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            Custom
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#a78bfa'} onChange={e => setColor(e.target.value)} style={{ width: 34, height: 26, padding: 0, border: '1px solid var(--border)', borderRadius: 7, background: 'none', cursor: 'pointer' }} />
          </label>
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

      <Section label={`Sync delay — ${delayMs} ms`}>
        <input type="range" min={0} max={600} step={10} value={delayMs} onChange={e => setDelayMs(parseInt(e.target.value, 10))} style={{ width: '100%', maxWidth: 320 }} />
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0' }}>Nudge the visuals later to match sound that reaches the room a beat behind — e.g. streaming to a TV or Bluetooth speaker.</p>
      </Section>
      {err && <p style={{ color: '#f87171', fontSize: 13.5, marginTop: 8 }}>{err}</p>}
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Party setup:</strong> tap fullscreen and drag this window onto your TV or projector — it keeps running while its window stays visible, so you can use other apps beside it. Browsers can’t grab a device’s internal audio silently (a security rule), so the mic is the no-setup path; capturing another tab’s sound needs the browser’s share prompt. The 100Lights app will add true internal-audio capture and background playback.
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
