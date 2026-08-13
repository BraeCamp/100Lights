'use client'

// Lightning Bug — put a transcription ON a video as visuals. Upload a video, its audio is
// transcribed (the hybrid confidence engine — free for clean lines, AI only for the hard bits),
// and the notes drive a visual overlay synced to playback: falling notes, flowing shapes, radial
// spectrum, and more, with colour/font controls. Reuses lib/song-video (the falling-notes engine,
// via o.media = the <video> so it follows the video's clock) + the transcription pipeline.
// v1 = live preview + controls; video EXPORT is the next pass. Non-AI editing is free/unlimited.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Loader2, Play, Square, Mic, Radio, Maximize2, X, ChevronLeft, Save, Upload, Download, DownloadCloud, Check, Shuffle, SkipForward, Activity, Sparkles, Star, Pencil, Link2, Moon, Sun, Circle, Turtle, Rabbit, Gauge, Coffee, Palette, Film, SlidersHorizontal, Menu, Search, Scan, Crosshair, type LucideIcon } from 'lucide-react'
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
import LightningBugHome from '@/components/apps/LightningBugHome'
import { BG_CATEGORIES, BG_LIBRARY, clipById, clipEnergy, clipBrightness, BRIGHTNESS_LABEL, clipSpeed, SPEED_LABEL, TRANSITION_CLIPS, type BgClip, type BgCategory, type Energy, type Brightness, type Speed } from '@/lib/bg-library'
import type { BroadcastTrack, StationScene } from '@/lib/stations'
import { detectMediaKind } from '@/lib/media-import'
import { useMediaDrop } from '@/lib/use-media-drop'
import { GENRE_LOOKS, type GenreLook } from '@/lib/music-looks'
import { classifyFamily } from '@/lib/classify-core'
import { tagsToFamily, type Family } from '@/lib/genre-map'
import { MotionDetector, lerpBox, loadObjectDetector, detectObjects, type Box } from '@/lib/vision'
import { saveAssets, removeAssets, localUrl, hasAsset, downloadToDevice } from '@/lib/offline-media'

type Controller = { play: () => void; pause: () => void; destroy: () => void; update: (p: Record<string, unknown>) => void; resize: () => void }
const FONTS = ['system-ui', 'Georgia, serif', 'ui-monospace, monospace', 'Impact, sans-serif']

export default function LightningBug() {
  return (
    <AppChrome slug="lightningbug">
      <LightningBugApp />
    </AppChrome>
  )
}

function LightningBugApp() {
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
  const [initialBg, setInitialBg] = useState<string | null>(null)   // deep-link: /apps/lightningbug?bg=<clipId>
  const [broadcastStation, setBroadcastStation] = useState<string | null>(null)   // ?station=<slug>&broadcast=1
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const bg = q.get('bg')
    if (bg && clipById(bg)) { setInitialBg(bg); setLive(true) }
    if (q.get('scene')) setLive(true)   // a shared scene link opens straight into live mode
    const st = q.get('station')
    if (st && q.get('broadcast')) { setBroadcastStation(st); setLive(true) }   // 24/7 radio-with-visuals mode
  }, [])

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

  // Broadcast / radio mode: a bare, chrome-less full-frame view for streaming (OBS browser source
  // → YouTube/Twitch). See STREAMING.md.
  if (broadcastStation) return <LiveVisualizer broadcast={broadcastStation} onExit={() => { setBroadcastStation(null); setLive(false) }} />

  // Bespoke home when nothing is chosen yet.
  if (!live && !videoUrl) return <LightningBugHome busy={busy} onFile={handleFile} onLive={() => setLive(true)} />

  return (
    <main id="main" className={`${live ? 'max-w-6xl' : 'max-w-2xl'} mx-auto`} style={{ padding: '20px 18px 40px' }}>
      <header style={{ marginBottom: 18 }}>
        <button type="button" onClick={() => { setLive(false); setVideoUrl(null); setNotes([]) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <ChevronLeft size={16} /> Home
        </button>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>{live ? 'Live visuals' : 'Lightning Bug'}</h1>
      </header>

      {live ? (
        <LiveVisualizer onExit={() => setLive(false)} initialBg={initialBg} />
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
type LiveStyle = 'none' | 'bars' | 'area' | 'rings' | 'dots' | 'radial' | 'wave'
type ColorMode = 'solid' | 'spectrum' | 'random'
interface Plane { h0: number; h1: number; sat: number; light: number }   // a hue band selected off the colour map
interface LiveColor { paletteId: string | null; plane: Plane | null; mode: ColorMode }
interface LiveOpts { style: LiveStyle; colors: string[]; mode: ColorMode; seed: number; gain: number; mirror: boolean; glow: boolean; trail: boolean; bg: boolean; beatColor?: boolean; beatShift?: number; density?: number }

// A saved "scene" — the whole Lightning Bug setup (look, filters, reactivity + video set).
// Calm, low-movement clips for idle mode (measured — see scripts/tag-bg-clips.mjs), intersected
// with whatever is actually in the library.
const TRANSITION_SET = new Set(TRANSITION_CLIPS.filter(id => BG_LIBRARY.some(c => c.id === id && c.kind === 'video')))

// AudD song naming (billed per call). Set AUDD_API_TOKEN to use it; the Song ID toggle appears
// only when enabled.
const AUDD_ENABLED = true

// On-device "sounds like" classifier — pure DSP, no AI, no API. Maps measured acoustic character
// (tempo, energy, bass/brightness balance, busyness, beatiness) to a COARSE family. Honest limits:
// it's reliable for clear-cut cases and a guess for ambiguous ones — fine genre isn't separable
// from audio alone (that's what AudD/Song ID is for). All inputs are 0–1 except bpm.
// Genre read for a moment of audio. The scoring lives in lib/classify-core (shared with the offline
// calibrator so what we tune is what runs); here we add the human-readable profile string. `prior`
// is a known genre (from song recognition / a broadcast track's tags) that biases the result.
function classifySonic(o: { bpm: number; energy: number; bass: number; bright: number; density: number; beaty: number }, prior?: Family | null): { family: Family; profile: string; confidence: number } {
  const { bpm, energy, bass, bright, density, beaty } = o
  const { family, confidence } = classifyFamily(o, prior)
  const profile = [
    bpm > 0 ? `${bpm} BPM` : 'no clear beat',
    energy > 0.6 ? 'high energy' : energy > 0.35 ? 'medium energy' : 'calm',
    bass > 0.32 ? 'bass-heavy' : bright > 0.3 ? 'bright' : 'warm',
    density > 0.55 ? 'busy' : density > 0.25 ? 'flowing' : 'sparse',
  ].join(' · ')
  return { family, profile, confidence }
}

// Genre → filters (mode + look) + colours (palette). Auto applies these on each video change.
// Arrays give variety within a genre. Falls back to ENERGY_LOOK when the genre read is unsure.
const GENRE_LOOK: Record<string, { modes: string[]; looks: string[]; palettes: string[] }> = {
  'Ambient': { modes: ['living', 'ink', 'none'], looks: ['dream', 'cool'], palettes: ['ice', 'aurora', 'ocean'] },
  'Lofi / Chill': { modes: ['none', 'living', 'oil', 'super8'], looks: ['warm', 'dream', 'film'], palettes: ['sunset', 'candy', 'aurora'] },
  'Hip-hop': { modes: ['vhs', 'cartoon', 'glitch'], looks: ['noir', 'film', 'blockbuster', 'lean', 'spotlight'], palettes: ['fire', 'neon', 'mono'] },
  'Electronic': { modes: ['neonedge', 'glitch', 'infrared', 'datamosh', 'fisheye'], looks: ['neonnoir', 'synthgrid', 'halo', 'dream', 'cool'], palettes: ['neon', 'aurora', 'candy'] },
  'Rock / Band': { modes: ['comic', 'vhs', 'anime', 'datamosh'], looks: ['noir', 'film', 'bleach'], palettes: ['fire', 'mono', 'sunset'] },
  'Pop': { modes: ['cartoon', 'anime', 'comic', 'chroma', 'fisheye'], looks: ['warm', 'dream', 'blockbuster', 'giallo', 'neonnoir', 'synthgrid', 'halo'], palettes: ['candy', 'sunset', 'neon'] },
  'Orchestral': { modes: ['ink', 'oil', 'none'], looks: ['noir', 'film', 'dream', 'blockbuster', 'spotlight'], palettes: ['ice', 'ocean', 'mono'] },
}
const ENERGY_LOOK: Record<'calm' | 'mid' | 'hot', { modes: string[]; looks: string[]; palettes: string[] }> = {
  calm: { modes: ['none', 'living', 'ink'], looks: ['dream', 'warm'], palettes: ['aurora', 'ice', 'sunset'] },
  mid: { modes: ['none', 'anime', 'comic', 'oil'], looks: ['film', 'dream'], palettes: ['aurora', 'ocean', 'candy'] },
  hot: { modes: ['neonedge', 'glitch', 'vhs', 'cartoon'], looks: ['noir', 'cool'], palettes: ['neon', 'fire', 'candy'] },
}

// ── EDITS ─────────────────────────────────────────────────────────────────────
// Region-TARGETED effects driven by on-device vision (lib/vision): they change only the thing the
// program detects — the moving subject, or a labelled person/car/animal — not the whole frame.
// 'motion' edits use frame-diff (free, instant); 'object' edits use COCO-SSD (loads a small model).
const EDITS: { id: string; name: string; kind: 'off' | 'motion' | 'object' | 'visual'; desc: string }[] = [
  { id: 'none', name: 'Off', kind: 'off', desc: '' },
  { id: 'spotlight', name: 'Motion spotlight', kind: 'motion', desc: 'Glow whatever is moving; dim the rest.' },
  { id: 'trails', name: 'Motion trails', kind: 'motion', desc: 'The moving subject leaves a fading echo; the still background stays clean.' },
  { id: 'freeze', name: 'Motion freeze', kind: 'motion', desc: 'Trail, ramp to a freeze on the beat, then highlight the mover.' },
  { id: 'kaleido', name: 'Kaleidoscope', kind: 'visual', desc: 'Mirror the frame into 4-fold symmetry.' },
  { id: 'track', name: 'Detect & tag', kind: 'object', desc: 'Box + label people, cars, animals as they move.' },
  { id: 'ramp', name: 'Slow-mo entrance', kind: 'object', desc: 'When a person/car enters, ramp the video to slow-mo, then back — a cinematic reveal.' },
  { id: 'invert', name: 'Invert subject', kind: 'object', desc: 'Invert the colours of just the main detected subject.' },
  { id: 'isolate', name: 'Colour-isolate', kind: 'object', desc: 'Keep the subject in colour; drain the rest to grey.' },
]

// Quick tag filters for the catalog search — the most common, useful tags across the ~15k clips.
const POPULAR_TAGS = ['neon', 'city', 'nature', 'ocean', 'forest', 'night', 'rain', 'sunset', 'abstract', 'smoke', 'clouds', 'water', 'lights', 'timelapse', 'mountains', 'beach', 'aerial', 'underwater', 'ink', 'vhs']

// Map the displayed video (object-fit: cover) so region boxes land on the right pixels despite the crop.
function coverMap(W: number, H: number, vw: number, vh: number) {
  const s = Math.max(W / vw, H / vh); const dw = vw * s, dh = vh * s
  return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh }
}
const boxToStage = (b: Box, m: { ox: number; oy: number; dw: number; dh: number }) =>
  ({ x: m.ox + b.x * m.dw, y: m.oy + b.y * m.dh, w: b.w * m.dw, h: b.h * m.dh })

// Kaleidoscope — mirror the top-left quadrant into all four for 4-fold symmetry.
function drawKaleido(ctx: CanvasRenderingContext2D, W: number, H: number, video: HTMLVideoElement) {
  ctx.clearRect(0, 0, W, H)
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9, m = coverMap(W, H, vw, vh)
  const hw = W / 2, hh = H / 2
  const quad = (fx: boolean, fy: boolean) => {
    ctx.save()
    ctx.translate(fx ? W : 0, fy ? H : 0); ctx.scale(fx ? -1 : 1, fy ? -1 : 1)
    ctx.beginPath(); ctx.rect(0, 0, hw, hh); ctx.clip()
    try { ctx.drawImage(video, m.ox, m.oy, m.dw, m.dh) } catch {}
    ctx.restore()
  }
  quad(false, false); quad(true, false); quad(false, true); quad(true, true)
}

// Paint the continuous edits (freeze is handled in the loop — it manages canvas persistence + playback).
function drawEditFx(ctx: CanvasRenderingContext2D, W: number, H: number, edit: string, video: HTMLVideoElement, box: Box | null, boxes: Box[]) {
  ctx.clearRect(0, 0, W, H)
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9
  const m = coverMap(W, H, vw, vh)
  if (edit === 'spotlight') {
    if (!box) return
    const b = boxToStage(box, m), cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const rx = Math.max(46, b.w * 0.72), ry = Math.max(46, b.h * 0.72)
    ctx.fillStyle = 'rgba(4,4,10,0.5)'; ctx.fillRect(0, 0, W, H)
    const g = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.35, cx, cy, Math.max(rx, ry))
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = g
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(147,197,255,0.85)'; ctx.lineWidth = 2; ctx.shadowColor = '#93c5ff'; ctx.shadowBlur = 18
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.stroke(); ctx.shadowBlur = 0
  } else if (edit === 'track') {
    ctx.lineWidth = 2; ctx.font = '700 13px system-ui, sans-serif'
    for (const bx of boxes) {
      const b = boxToStage(bx, m)
      ctx.strokeStyle = 'rgba(52,211,153,0.95)'; ctx.shadowColor = '#34d399'; ctx.shadowBlur = 10
      ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.shadowBlur = 0
      const label = `${bx.label ?? ''} ${Math.round((bx.score ?? 0) * 100)}%`
      const tw = ctx.measureText(label).width + 10
      ctx.fillStyle = 'rgba(6,20,14,0.85)'; ctx.fillRect(b.x, Math.max(0, b.y - 18), tw, 18)
      ctx.fillStyle = '#34d399'; ctx.fillText(label, b.x + 5, Math.max(13, b.y - 5))
    }
  } else if (edit === 'invert') {
    if (!box) return
    const b = boxToStage(box, m)
    ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip()
    try { ctx.drawImage(video, m.ox, m.oy, m.dw, m.dh) } catch { ctx.restore(); return }
    ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(b.x, b.y, b.w, b.h)
    ctx.restore(); ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x, b.y, b.w, b.h)
  } else if (edit === 'isolate') {
    ctx.filter = 'grayscale(1) brightness(0.82)'
    try { ctx.drawImage(video, m.ox, m.oy, m.dw, m.dh) } catch { ctx.filter = 'none'; return }
    ctx.filter = 'none'
    if (box) {
      const b = boxToStage(box, m), cx = b.x + b.w / 2, cy = b.y + b.h / 2
      const r = ctx.createRadialGradient(cx, cy, Math.min(b.w, b.h) * 0.3, cx, cy, Math.max(b.w, b.h) * 0.72)
      r.addColorStop(0, '#000'); r.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = r
      ctx.fillRect(b.x - b.w, b.y - b.h, b.w * 3, b.h * 3); ctx.globalCompositeOperation = 'source-over'
    }
  }
}

// The control groups, shown as icon tabs that expand to their name on hover (or via the mobile
// collapse toggle). The selected one renders below with a title header.
const SECTIONS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'look', label: 'Genre look', Icon: Palette },
  { id: 'visualizer', label: 'Visualizer', Icon: Activity },
  { id: 'edits', label: 'Edits', Icon: Scan },
  { id: 'bg', label: 'Background', Icon: Film },
  { id: 'sync', label: 'Sync', Icon: SlidersHorizontal },
]

interface Scene {
  id: string; name: string
  style: LiveStyle; colorCfg: LiveColor; seed: number; videoMode: string; videoLook: string
  mirror: boolean; glow: boolean; trail: boolean; gain: number; smoothing: number
  blur: number; brightness: number; saturate: number; hueRot: number
  beatColor: boolean; punchAmt: number
  reactive: boolean; matchVisuals: boolean; matchEnergy: boolean; autoShuffle: boolean
  videoSet: BgCategory[]; brightnessSet?: Brightness[]; speedSet?: Speed[]; idleTransition?: boolean; switchChance: number
  bgCat: BgCategory; bgKind: string; bgClipId: string | null
  isDefault?: boolean   // auto-loads when Lightning Bug opens
}

// Encode/decode a scene to a URL-safe string for sharing (unicode-safe).
const sceneEncode = (s: object) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sceneDecode = (b: string): Scene | null => {
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))) } catch { return null }
}

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

// Snapchat-style "looks" for the background video/image — a stackable recipe of a CSS
// filter, an SVG filter (posterize/aberration/bloom/ripple, defined once in LookSvgDefs),
// and overlay layers (vignette/grain/scanlines/duotone). Pure CSS+SVG — cheap, no WebGL,
// works over video and stills alike, and composes on top of the user's blur/hue sliders.
type Overlay = 'vignette' | 'grain' | 'scanlines' | 'duotone' | 'halftone' | 'grid' | 'spotlight' | 'flicker'
interface VideoLook { id: string; name: string; css?: string; svg?: string; overlays?: Overlay[] }

// LOOK = a subtle grade/atmosphere you leave on. Composes UNDER a Mode.
const VIDEO_LOOKS: VideoLook[] = [
  { id: 'none', name: 'None' },
  { id: 'vignette', name: 'Vignette', overlays: ['vignette'] },
  { id: 'film', name: 'Film', css: 'contrast(1.05) saturate(1.05) sepia(0.12)', overlays: ['grain', 'vignette'] },
  { id: 'dream', name: 'Dream', svg: 'mv-dream', css: 'brightness(1.05) saturate(1.1)', overlays: ['vignette'] },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.32) brightness(1.02)', overlays: ['vignette', 'grain'] },
  { id: 'warm', name: 'Warm', css: 'sepia(0.25) saturate(1.3) contrast(1.05) brightness(1.03)' },
  { id: 'cool', name: 'Cool', css: 'saturate(1.15) hue-rotate(-12deg) brightness(1.02)' },
  // New cinematic grades (from the look-book research). Grade-only — no footage needed.
  { id: 'blockbuster', name: 'Blockbuster', svg: 'mv-tealorange', css: 'contrast(1.1) saturate(1.12) brightness(1.02)' },   // teal-orange
  { id: 'neonnoir', name: 'Neon-noir', css: 'saturate(1.5) contrast(1.32) brightness(0.9)', overlays: ['vignette'] },        // crushed blacks, neon pops (Blinding Lights)
  { id: 'bleach', name: 'Bleach', css: 'saturate(0.42) contrast(1.4) brightness(1.05)', overlays: ['grain', 'vignette'] },   // desaturated grit (grunge/rock)
  { id: 'giallo', name: 'Giallo', css: 'saturate(1.65) contrast(1.16) hue-rotate(-6deg) brightness(1.02)', overlays: ['vignette'] },  // lurid technicolor reds
  { id: 'lean', name: 'Lean', css: 'sepia(0.5) hue-rotate(215deg) saturate(1.5) contrast(1.05)', overlays: ['scanlines', 'grain'] },  // purple phonk wash
  { id: 'synthgrid', name: 'Synth grid', css: 'saturate(1.3) contrast(1.1) brightness(1.02)', overlays: ['grid'] },        // neon perspective grid (synthwave)
  { id: 'spotlight', name: 'Spotlight', css: 'contrast(1.32) brightness(0.97) saturate(1.05)', overlays: ['spotlight'] },  // chiaroscuro performance-in-void
  { id: 'halo', name: 'Halo', svg: 'mv-halo' },  // region-based: neon-glow only the bright shapes on screen
]

// MODE = a dramatic, live full-frame transform — the "change the whole look" layer, more
// overlay than tweak. Built from SVG filters (edge-detect + posterize for the cel/ink looks,
// colour-ramp palettes for thermal/infrared, displacement for glitch). Real neural anime
// style-transfer would need an ML model; these are stylised approximations to iterate on.
const VIDEO_MODES: VideoLook[] = [
  { id: 'none', name: 'None' },
  { id: 'anime', name: 'Anime', svg: 'mv-anime', css: 'saturate(1.5) contrast(1.08)' },
  { id: 'comic', name: 'Comic', svg: 'mv-comic', css: 'saturate(1.4) contrast(1.15)', overlays: ['halftone'] },
  { id: 'ink', name: 'Ink', svg: 'mv-ink' },
  { id: 'oil', name: 'Oil paint', svg: 'mv-oil', css: 'saturate(1.35) contrast(1.08)' },
  { id: 'cartoon', name: 'Cartoon', svg: 'mv-cartoon', css: 'saturate(1.55) contrast(1.12)' },
  { id: 'neonedge', name: 'Neon edge', svg: 'mv-neonedge' },
  { id: 'thermal', name: 'Thermal', svg: 'mv-thermal' },
  { id: 'infrared', name: 'Infrared', svg: 'mv-infrared' },
  { id: 'vhs', name: 'VHS', svg: 'mv-vhs', css: 'saturate(1.2) contrast(1.05)', overlays: ['scanlines', 'grain'] },
  { id: 'glitch', name: 'Glitch', svg: 'mv-glitch', overlays: ['scanlines'] },
  { id: 'living', name: 'Living', svg: 'mv-living' },
  { id: 'super8', name: 'Super-8', svg: 'mv-super8', css: 'contrast(0.92) brightness(1.04) saturate(1.12)', overlays: ['grain', 'vignette', 'flicker'] },  // warm home-movie: weave + flicker + grain
  { id: 'chroma', name: 'Chroma', svg: 'mv-chroma', css: 'saturate(1.12)' },   // clean RGB fringe (aberration)
  { id: 'datamosh', name: 'Datamosh', svg: 'mv-datamosh', css: 'saturate(1.2) contrast(1.05)' },   // melting-pixel glitch
  { id: 'fisheye', name: 'Warp', svg: 'mv-fisheye' },   // barrel/fisheye bulge (tiny-planet cousin)
]
// Tileable film-grain noise (feTurbulence baked into a data-URI so it needs no network).
const GRAIN_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='140' height='140' filter='url(#n)'/></svg>")

// Displacement map for the Warp/fisheye filter: R encodes horizontal position (0→1 left→right),
// G encodes vertical — so feDisplacementMap bends coordinates radially into a barrel/lens bulge.
const WARP_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><defs>" +
  "<linearGradient id='x' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#000'/><stop offset='1' stop-color='#f00'/></linearGradient>" +
  "<linearGradient id='y' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#000'/><stop offset='1' stop-color='#0f0'/></linearGradient>" +
  "</defs><rect width='100' height='100' fill='url(#x)'/><rect width='100' height='100' fill='url(#y)' style='mix-blend-mode:screen'/></svg>")

// Overlay layers for a look — absolutely-positioned, non-interactive, blended over the media.
function LookOverlays({ keys }: { keys: Overlay[] }) {
  const base: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }
  return (
    <>
      {keys.map(k => {
        if (k === 'vignette') return <div key={k} style={{ ...base, background: 'radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.72) 100%)' }} />
        if (k === 'scanlines') return <div key={k} style={{ ...base, backgroundImage: 'repeating-linear-gradient(to bottom, rgba(0,0,0,0.28) 0 1px, transparent 1px 3px)', mixBlendMode: 'multiply' }} />
        if (k === 'grain') return <div key={k} className="mv-grain" style={{ ...base, backgroundImage: `url("${GRAIN_URI}")`, backgroundSize: '160px 160px', opacity: 0.16, mixBlendMode: 'overlay' }} />
        if (k === 'duotone') return <div key={k} style={{ ...base, backgroundImage: 'linear-gradient(125deg,#12b3ff,#ff2fd0)', mixBlendMode: 'color', opacity: 0.4 }} />
        if (k === 'halftone') return <div key={k} style={{ ...base, backgroundImage: 'radial-gradient(circle at center, rgba(0,0,0,0.55) 30%, transparent 32%)', backgroundSize: '6px 6px', mixBlendMode: 'multiply', opacity: 0.55 }} />
        // Synth grid — a neon perspective floor receding to a horizon, scrolling toward the viewer.
        if (k === 'grid') return <div key={k} style={{ ...base, top: 'auto', overflow: 'hidden', height: '58%', maskImage: 'linear-gradient(to top, #000 8%, transparent 78%)', WebkitMaskImage: 'linear-gradient(to top, #000 8%, transparent 78%)' }}>
          <div className="mv-grid" style={{ position: 'absolute', left: '-60%', right: '-60%', bottom: 0, height: '260%', transform: 'perspective(340px) rotateX(76deg)', transformOrigin: 'bottom center', backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 39px, #ff2e97 39px 40px), repeating-linear-gradient(0deg, transparent 0 39px, #22d3ee 39px 40px)', backgroundSize: '40px 40px', mixBlendMode: 'screen', opacity: 0.55 }} />
        </div>
        // Spotlight void — a tight radial that sinks everything but the centre into near-black.
        if (k === 'spotlight') return <div key={k} style={{ ...base, background: 'radial-gradient(ellipse 58% 54% at 50% 46%, transparent 26%, rgba(0,0,0,0.93) 82%)' }} />
        // Projector flicker — a black multiply layer whose opacity stutters like old film.
        if (k === 'flicker') return <div key={k} className="mv-flicker" style={{ ...base, background: '#000', mixBlendMode: 'multiply' }} />
        return null
      })}
    </>
  )
}

// SVG filter definitions referenced by the looks above (posterize, chromatic aberration,
// bloom, animated ripple). Rendered once, hidden; url(#id) points the CSS filter at them.
function LookSvgDefs() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <filter id="mv-cartoon">
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0 0.22 0.45 0.7 1" />
            <feFuncG type="discrete" tableValues="0 0.22 0.45 0.7 1" />
            <feFuncB type="discrete" tableValues="0 0.22 0.45 0.7 1" />
          </feComponentTransfer>
        </filter>
        {/* Teal-orange split-tone (the "blockbuster" grade): shadows keep blue → teal, highlights
            drop blue + gain red → orange. A true complementary split CSS filters can't do. */}
        <filter id="mv-tealorange">
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.00 0.42 0.85 1.00" />
            <feFuncG type="table" tableValues="0.04 0.40 0.70 0.92" />
            <feFuncB type="table" tableValues="0.14 0.46 0.42 0.28" />
          </feComponentTransfer>
        </filter>
        {/* Super-8: warm cast + lifted blacks, plus a subtle animated displacement = gate weave. */}
        <filter id="mv-super8">
          <feComponentTransfer result="warm">
            <feFuncR type="linear" slope="1.06" intercept="0.03" />
            <feFuncG type="linear" slope="1.00" intercept="0.02" />
            <feFuncB type="linear" slope="0.86" intercept="0.015" />
          </feComponentTransfer>
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.03" numOctaves="1" seed="4" result="n">
            <animate attributeName="baseFrequency" dur="0.45s" values="0.02 0.03;0.026 0.028;0.02 0.031;0.02 0.03" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="warm" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* Chroma-split: gentle RGB fringe (aberration) with no scanlines/tracking — cleaner than VHS. */}
        <filter id="mv-chroma" x="-3%" width="106%">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx="2.5" dy="0" result="ro" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb" />
          <feOffset in="gb" dx="-2.5" dy="0" result="gbo" />
          <feBlend in="ro" in2="gbo" mode="screen" />
        </filter>
        {/* Datamosh: big animated turbulence displacement (pixels smear/melt) + RGB bleed. A stylized
            approximation of true codec datamoshing — no codec hacking, all live. */}
        <filter id="mv-datamosh">
          <feTurbulence type="turbulence" baseFrequency="0.008 0.014" numOctaves="2" seed="8" result="n">
            <animate attributeName="baseFrequency" dur="0.8s" values="0.008 0.014;0.02 0.006;0.006 0.02;0.008 0.014" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="40" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feColorMatrix in="d" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx="6" dy="-2" result="ro" />
          <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb" />
          <feOffset in="gb" dx="-5" dy="2" result="gbo" />
          <feBlend in="ro" in2="gbo" mode="screen" />
        </filter>
        {/* Warp: barrel/fisheye bulge (the no-WebGL cousin of a tiny-planet). */}
        <filter id="mv-fisheye">
          <feImage href={WARP_URI} preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="-120" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* Halo: REGION-BASED bloom — a luminance key finds the bright shapes on screen (lights, faces
            in light, speculars) and neon-glows only those, not the whole frame. First step toward
            Snapchat-style detect-a-region-and-restyle-it effects (faces/segmentation are the roadmap). */}
        <filter id="mv-halo">
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.3 0.6 0.1 0 -0.58" result="lum" />
          <feComponentTransfer in="lum" result="mask"><feFuncA type="linear" slope="7" /></feComponentTransfer>
          <feGaussianBlur in="mask" stdDeviation="9" result="glow" />
          <feFlood floodColor="#93c5ff" result="col" />
          <feComposite in="col" in2="glow" operator="in" result="tint" />
          <feBlend in="SourceGraphic" in2="tint" mode="screen" />
        </filter>
        <filter id="mv-vhs" x="-6%" y="-2%" width="112%" height="104%">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx="3" dy="0" result="ro" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb" />
          <feOffset in="gb" dx="-3" dy="0" result="gbo" />
          <feBlend in="ro" in2="gbo" mode="screen" />
        </filter>
        <filter id="mv-dream">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b" />
          <feComponentTransfer in="b" result="bb"><feFuncA type="linear" slope="0.85" /></feComponentTransfer>
          <feBlend in="SourceGraphic" in2="bb" mode="screen" />
        </filter>
        <filter id="mv-living">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.01" numOctaves="2" seed="7" result="n">
            <animate attributeName="baseFrequency" dur="18s" values="0.006 0.01;0.011 0.007;0.006 0.01" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="20" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* Anime cel — posterized fills + dark ink outlines from a Laplacian edge pass. */}
        <filter id="mv-anime">
          <feComponentTransfer result="post">
            <feFuncR type="discrete" tableValues="0.1 0.4 0.65 0.85 1" />
            <feFuncG type="discrete" tableValues="0.1 0.4 0.65 0.85 1" />
            <feFuncB type="discrete" tableValues="0.12 0.42 0.67 0.87 1" />
          </feComponentTransfer>
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.34 0.33 0 0" result="lum" />
          <feConvolveMatrix in="lum" order="3" preserveAlpha="false" kernelMatrix="1 1 1 1 -8 1 1 1 1" result="edge" />
          <feComponentTransfer in="edge" result="ea"><feFuncA type="table" tableValues="0 0 0.9 1" /></feComponentTransfer>
          <feFlood floodColor="#1a1420" result="ink" />
          <feComposite in="ink" in2="ea" operator="in" result="lines" />
          <feMerge><feMergeNode in="post" /><feMergeNode in="lines" /></feMerge>
        </filter>
        {/* Comic — 3-level posterize + hard black outlines (halftone dots via overlay). */}
        <filter id="mv-comic">
          <feComponentTransfer result="post">
            <feFuncR type="discrete" tableValues="0 0.5 1" />
            <feFuncG type="discrete" tableValues="0 0.5 1" />
            <feFuncB type="discrete" tableValues="0 0.5 1" />
          </feComponentTransfer>
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.34 0.33 0 0" result="lum" />
          <feConvolveMatrix in="lum" order="3" preserveAlpha="false" kernelMatrix="1 1 1 1 -8 1 1 1 1" result="edge" />
          <feComponentTransfer in="edge" result="ea"><feFuncA type="table" tableValues="0 0 1 1" /></feComponentTransfer>
          <feFlood floodColor="#000" result="ink" />
          <feComposite in="ink" in2="ea" operator="in" result="lines" />
          <feMerge><feMergeNode in="post" /><feMergeNode in="lines" /></feMerge>
        </filter>
        {/* Ink / woodcut — threshold to two tones on cream paper. */}
        <filter id="mv-ink">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.34 0.33 0 0" result="lum" />
          <feComponentTransfer in="lum" result="th"><feFuncA type="discrete" tableValues="1 1 0" /></feComponentTransfer>
          <feFlood floodColor="#15110c" result="ink" />
          <feComposite in="ink" in2="th" operator="in" result="dark" />
          <feFlood floodColor="#efe9da" result="paper" />
          <feMerge><feMergeNode in="paper" /><feMergeNode in="dark" /></feMerge>
        </filter>
        {/* Oil paint — dilate + soften into blobs. */}
        <filter id="mv-oil">
          <feMorphology operator="dilate" radius="2" result="d" />
          <feGaussianBlur in="d" stdDeviation="1.1" />
        </filter>
        {/* Neon edge — bright glowing outlines on near-black. */}
        <filter id="mv-neonedge">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.34 0.33 0 0" result="lum" />
          <feConvolveMatrix in="lum" order="3" preserveAlpha="false" kernelMatrix="1 1 1 1 -8 1 1 1 1" result="edge" />
          <feComponentTransfer in="edge" result="ea"><feFuncA type="linear" slope="3" /></feComponentTransfer>
          <feFlood floodColor="#26e6ff" result="glow" />
          <feComposite in="glow" in2="ea" operator="in" result="lines" />
          <feGaussianBlur in="lines" stdDeviation="1.4" result="lg" />
          <feFlood floodColor="#05060a" result="bg" />
          <feMerge><feMergeNode in="bg" /><feMergeNode in="lg" /><feMergeNode in="lines" /></feMerge>
        </filter>
        {/* Thermal — map luminance to a heat palette. */}
        <filter id="mv-thermal">
          <feColorMatrix type="matrix" values="0.33 0.34 0.33 0 0  0.33 0.34 0.33 0 0  0.33 0.34 0.33 0 0  0 0 0 1 0" result="g" />
          <feComponentTransfer in="g">
            <feFuncR type="table" tableValues="0 0.1 0.4 0.85 1 1" />
            <feFuncG type="table" tableValues="0 0 0.15 0.6 0.95 1" />
            <feFuncB type="table" tableValues="0.25 0.55 0.35 0.1 0.2 1" />
          </feComponentTransfer>
        </filter>
        {/* Infrared — false-colour foliage (pink/magenta highlights). */}
        <filter id="mv-infrared">
          <feColorMatrix type="matrix" values="0.33 0.34 0.33 0 0  0.33 0.34 0.33 0 0  0.33 0.34 0.33 0 0  0 0 0 1 0" result="g" />
          <feComponentTransfer in="g">
            <feFuncR type="table" tableValues="0.2 0.5 0.8 1 1" />
            <feFuncG type="table" tableValues="0 0.1 0.3 0.6 1" />
            <feFuncB type="table" tableValues="0.3 0.4 0.6 0.8 1" />
          </feComponentTransfer>
        </filter>
        {/* Glitch — horizontal jitter slices + chromatic split, animated. */}
        <filter id="mv-glitch" x="-6%" width="112%">
          <feTurbulence type="turbulence" baseFrequency="0 0.6" numOctaves="1" seed="3" result="n">
            <animate attributeName="baseFrequency" dur="0.7s" values="0 0.6;0 0.9;0 0.5;0 0.6" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="A" result="disp" />
          <feColorMatrix in="disp" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx="4" result="ro" />
          <feColorMatrix in="disp" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb" />
          <feOffset in="gb" dx="-4" result="gbo" />
          <feBlend in="ro" in2="gbo" mode="screen" />
        </filter>
      </defs>
    </svg>
  )
}

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

// Auto background selection: which categories fit the current energy.
function autoCategories(band: Energy): BgCategory[] {
  if (band === 'hot') return ['Neon', 'Night', 'City', 'Streets', 'Light']
  if (band === 'calm') return ['Cozy', 'Nature', 'Beach', 'Film', 'Light']
  return ['Abstract', 'Streets', 'Aerial', 'City', 'Light']
}

function drawLive(cv: HTMLCanvasElement, freq: Uint8Array, wave: Uint8Array, o: LiveOpts) {
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
  const w = cv.clientWidth, h = cv.clientHeight
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
  const ctx = cv.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1
  // 'none' — no visualizer shapes, just the background. The audio loop keeps running so the
  // EQ filters + palette coloration can still react to the music (see the EQ toggle).
  if (o.style === 'none') {
    if (o.bg) ctx.clearRect(0, 0, w, h)
    else { ctx.fillStyle = '#08070d'; ctx.fillRect(0, 0, w, h) }
    return
  }
  // Over a background layer, keep the canvas see-through; on its own, paint the dark base.
  // Trails leave a soft comet tail either way (a translucent wash instead of a hard clear).
  // Trail length adapts to density: busy songs clear faster (short trails, legible), sparse
  // songs leave a longer dreamy tail.
  const wash = 0.12 + (o.density ?? 0) * 0.4
  if (o.bg) {
    ctx.clearRect(0, 0, w, h)
    if (o.trail) { ctx.fillStyle = `rgba(8,7,13,${wash.toFixed(2)})`; ctx.fillRect(0, 0, w, h) }
  } else {
    if (o.trail) { ctx.fillStyle = `rgba(8,7,13,${(wash + 0.06).toFixed(2)})` } else ctx.fillStyle = '#08070d'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowBlur = o.glow ? Math.max(6, Math.min(w, h) * 0.03) : 0

  const n = freq.length, g = o.gain
  const N = o.colors.length
  // Beat-synced colour: rotate the palette by one step on each detected beat.
  const sh = o.beatColor ? (((o.beatShift ?? 0) % N) + N) % N : 0
  const cols = sh ? o.colors.map((_, i) => o.colors[(i + sh) % N]) : o.colors
  const mid = cols[Math.floor(N / 2)]
  ctx.shadowColor = mid
  const randColor = (i: number) => { const x = Math.sin((i + 1) * 97.13 + o.seed) * 43758.5453; return cols[Math.floor((x - Math.floor(x)) * N)] }
  const colorAt = (t: number, i: number) => o.mode === 'solid' ? mid : o.mode === 'spectrum' ? cols[Math.min(N - 1, Math.max(0, Math.floor(t * N)))] : randColor(i)

  // Perceptual frequency sampling — spreads bass/mid/treble evenly instead of bunching low.
  // Music is naturally bass-heavy, so apply a gentle linear spectral tilt: leave the low
  // (left) end alone and lift the high (right) end slightly, ~1× → 1.5× across the range,
  // so the bars aren't always tall on the deep side.
  const samp = (t: number) => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(Math.pow(t, 1.7) * n * 0.85)))
    const tilt = 1 + 0.5 * t
    return Math.min(1, (freq[idx] / 255) * g * tilt)
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
      // Mirror on → symmetric ring; off → full spectrum sweeps once around (asymmetric).
      const fr = o.mirror ? (t < 0.5 ? t * 2 : (1 - t) * 2) : t
      const r = base + samp(fr) * amp
      const a = t * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.closePath()
    const rg = ctx.createRadialGradient(cx, cy, base * 0.5, cx, cy, base + amp)
    if (o.mode === 'solid') { rg.addColorStop(0, lighten(mid, 0.4)); rg.addColorStop(1, mid) }
    else { rg.addColorStop(0, cols[0]); rg.addColorStop(0.5, mid); rg.addColorStop(1, cols[N - 1]) }
    ctx.fillStyle = rg; ctx.globalAlpha = 0.32; ctx.fill()
    ctx.globalAlpha = 1; ctx.lineWidth = Math.max(2, Math.min(w, h) / 260); ctx.strokeStyle = lighten(mid, 0.35); ctx.stroke()
  } else if (o.style === 'area') {
    ctx.beginPath(); ctx.moveTo(0, h)
    const steps = 72
    for (let i = 0; i <= steps; i++) { const t = i / steps; ctx.lineTo(t * w, h - Math.max(2, samp(t) * h * 0.9)) }
    ctx.lineTo(w, h); ctx.closePath()
    const lg = ctx.createLinearGradient(0, 0, w, 0)
    if (o.mode === 'solid') { lg.addColorStop(0, lighten(mid, 0.5)); lg.addColorStop(1, mid) }
    else for (let i = 0; i < N; i++) lg.addColorStop(i / (N - 1), cols[i])
    ctx.fillStyle = lg; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1
    ctx.strokeStyle = lighten(mid, 0.4); ctx.lineWidth = Math.max(2, Math.min(w, h) / 220); ctx.stroke()
  } else if (o.style === 'rings') {
    const cx = w / 2, cy = h / 2, maxR = Math.min(w, h) * 0.46, rings = 20
    for (let i = 0; i < rings; i++) {
      const t = i / rings, amp = samp(t)
      ctx.beginPath(); ctx.arc(cx, cy, maxR * (0.12 + t * 0.88), 0, Math.PI * 2)
      ctx.lineWidth = Math.max(1, amp * maxR * 0.09)
      ctx.strokeStyle = colorAt(t, i); ctx.globalAlpha = 0.22 + amp * 0.72; ctx.stroke()
    }
    ctx.globalAlpha = 1
  } else if (o.style === 'dots') {
    const count = 44, gap = w / count, midY = h / 2
    for (let i = 0; i < count; i++) {
      const t = i / count, amp = samp(t)
      const x = gap * i + gap / 2, r = Math.max(1.5, amp * Math.min(w, h) * 0.09), off = amp * h * 0.32
      ctx.fillStyle = colorAt(t, i); ctx.globalAlpha = 0.5 + amp * 0.5
      ctx.beginPath(); ctx.arc(x, midY - off, r, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(x, midY + off, r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  } else {
    if (o.mode === 'spectrum') {
      const lg = ctx.createLinearGradient(0, 0, w, 0)
      for (let i = 0; i < N; i++) lg.addColorStop(i / (N - 1), cols[i])
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

function LiveVisualizer({ onExit, initialBg, broadcast }: { onExit: () => void; initialBg?: string | null; broadcast?: string | null }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [running, setRunning] = useState(false)
  const [source, setSource] = useState<'mic' | 'device' | 'file' | 'broadcast' | null>(null)
  const [style, setStyle] = useState<LiveStyle>('none')   // audio spectrum viz OFF by default — video/look is the star; pick a style to add bars/waves
  const [beatColor, setBeatColor] = useState(false)         // cycle colours on each detected beat
  const [bpm, setBpm] = useState(0)                         // detected tempo (0 = not locked yet)
  const beatColorRef = useRef(false); beatColorRef.current = beatColor
  // Cut on the beat — switch the background clip on musical phrases (a hard cut, like a real edit,
  // not a random per-bar chance). Pros cut on downbeats, not every beat, so we cut every N kicks.
  const [cutOnBeat, setCutOnBeat] = useState(false)
  const cutOnBeatRef = useRef(false); cutOnBeatRef.current = cutOnBeat
  const [cutEvery, setCutEvery] = useState(8)               // kicks per cut (8 ≈ two bars of 4/4)
  const cutEveryRef = useRef(8); cutEveryRef.current = cutEvery
  const beatCutCountRef = useRef(0)
  // EDITS — region-targeted effects from on-device vision (lib/vision). See EDITS registry above.
  const [edit, setEdit] = useState('none')
  const editRef = useRef('none'); editRef.current = edit
  // Detector — a DIAGNOSTIC toggle: draws labelled boxes on detected people/cars/animals AND shows the
  // live on-device genre/tone read, so you can see what the program thinks it's looking at + hearing.
  const [detector, setDetector] = useState(false)
  const detectorRef = useRef(false); detectorRef.current = detector
  const [sonicView, setSonicView] = useState<{ family: string; profile: string; confidence: number } | null>(null)
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null)   // overlay the edit effects paint on
  const motionRef = useRef<MotionDetector | null>(null)
  const boxRef = useRef<Box | null>(null)                      // smoothed primary region of interest
  const boxesRef = useRef<Box[]>([])                           // all detected object boxes (Detect & tag)
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const freezeRef = useRef<{ t0: number; frozen: boolean; box: Box | null } | null>(null)
  const freezeArmedRef = useRef(false)                         // Trigger sets this; the next beat fires the freeze
  const rampRef = useRef<{ t0: number } | null>(null)          // slow-mo-entrance state
  const prevCountRef = useRef(0)                               // detected-subject count last frame (entrance = count up)
  const rampCooldownRef = useRef(0)
  const bassAvgRef = useRef(0)                              // running bass energy, for onset detection
  const lastBeatRef = useRef(0)                            // debounce beats
  const prevBeatRef = useRef(0)                            // for the inter-beat interval → BPM
  const beatShiftRef = useRef(0)                            // colour rotation, bumped each beat
  const bpmEmaRef = useRef(0)
  const beatIvBufRef = useRef<number[]>([])                 // recent beat intervals → median BPM (adapts fast)
  const lastBpmUiRef = useRef(0)
  const punchEnvRef = useRef(0)                             // sub/bass transient envelope (drum "punch")
  const beatFlashRef = useRef(0)                            // decaying flash intensity (0..1)
  const beatFlashColorRef = useRef('#ffffff')
  const beatFlashDivRef = useRef<HTMLDivElement | null>(null)   // full-frame colour flash overlay
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
  const [openPanel, setOpenPanel] = useState<string | null>('look')   // which control group's section is open
  const [tabsOpen, setTabsOpen] = useState(false)                     // mobile: expand all tab labels into words
  const [advOpen, setAdvOpen] = useState(false)                       // reveal the manual mode/grade/filter controls
  // Background layer + filters + "no audio" ambient mode
  const [bgKind, setBgKind] = useState<'none' | 'media' | 'library' | string>('none')   // 'none' | ambient id | 'media' | 'library'
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  const [bgVideo, setBgVideo] = useState(false)
  const [bgClip, setBgClip] = useState<BgClip | null>(null)
  const [bgCat, setBgCat] = useState<BgCategory>(BG_CATEGORIES[0])
  const [reactive, setReactive] = useState(true)
  const [matchVisuals, setMatchVisuals] = useState(true)   // tint the background with the palette
  const [blur, setBlur] = useState(0)
  const [brightness, setBrightness] = useState(1)
  const [saturate, setSaturate] = useState(1)
  const [hueRot, setHueRot] = useState(0)
  const [videoMode, setVideoMode] = useState('none')       // dramatic full-frame transform (anime, ink, glitch…)
  const [videoLook, setVideoLook] = useState('none')       // subtle grade layered under the mode
  const lookFilterRef = useRef('')                          // mode+look svg/css prefix, kept for the per-frame EQ update
  const [autoShuffle, setAutoShuffle] = useState(false)     // play a clip, then move to the next one
  const [videoSet, setVideoSet] = useState<BgCategory[]>([])   // categories the shuffle draws from ([] = all)
  const videoSetRef = useRef<BgCategory[]>([]); videoSetRef.current = videoSet
  const [brightnessSet, setBrightnessSet] = useState<Brightness[]>([])   // brightness filter ([] = all); e.g. ['dark'] for a dark room
  const brightnessSetRef = useRef<Brightness[]>([]); brightnessSetRef.current = brightnessSet
  const [speedSet, setSpeedSet] = useState<Speed[]>([])   // motion filter ([] = all): Slow / Standard / Fast
  const speedSetRef = useRef<Speed[]>([]); speedSetRef.current = speedSet
  // Catalogue pool — a random batch from the ~15k tagged Pexels catalogue (lib/pexels-bg), converted
  // to clips so Auto-shuffle + the browse grid draw from the WHOLE catalogue, not just the bundled set.
  const pexToClip = (r: { id: string; title: string; mp4: string; poster: string; category: string; brightness: Brightness; speed?: Speed }): BgClip =>
    ({ id: r.id, category: r.category as BgCategory, title: r.title, kind: 'video', preview: r.poster, src: r.mp4, tint: 'linear-gradient(135deg,#1e1b4b,#0b1020)', brightness: r.brightness, speed: r.speed })
  const [catalogPool, setCatalogPool] = useState<BgClip[]>([])
  const catalogPoolRef = useRef<BgClip[]>([]); catalogPoolRef.current = catalogPool
  useEffect(() => {
    // Pull a fresh random batch from the catalogue (respect a single-brightness pick for dark-room safety).
    const bp = brightnessSet.length === 1 ? `&brightness=${brightnessSet[0]}` : ''
    fetch(`/api/pexels-bg?order=random&limit=400${bp}`).then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.results) setCatalogPool(d.results.map(pexToClip)) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brightnessSet])
  // Search the tagged Pexels catalog (streams from Pexels' CDN; nothing downloaded).
  const [pexQuery, setPexQuery] = useState('')
  const [pexResults, setPexResults] = useState<{ id: string; title: string; mp4: string; poster: string; category: string; brightness: Brightness; author: string }[]>([])
  const [pexLoading, setPexLoading] = useState(false)
  const [pexSearched, setPexSearched] = useState(false)
  const [pexMore, setPexMore] = useState(false)          // a full page came back → more to load
  const [pexHover, setPexHover] = useState<string | null>(null)   // tile being hover-previewed (video loads only then)
  const PEX_PAGE = 36
  // Search the tagged catalog. append=true pages in more (offset = current count) for infinite-ish browsing.
  const searchPexels = useCallback(async (append = false, qOverride?: string) => {
    const q = qOverride ?? pexQuery
    setPexLoading(true); setPexSearched(true)
    try {
      const bset = brightnessSetRef.current
      const bp = bset.length === 1 ? `&brightness=${bset[0]}` : ''
      const sset = speedSetRef.current
      const sp = sset.length === 1 ? `&speed=${sset[0]}` : ''
      const offset = append ? pexResults.length : 0
      const r = await fetch(`/api/pexels-bg?q=${encodeURIComponent(q)}${bp}${sp}&limit=${PEX_PAGE}&offset=${offset}`)
      const d = await r.json()
      const results = d.results ?? []
      setPexResults(prev => (append ? [...prev, ...results] : results))
      setPexMore(results.length === PEX_PAGE)
    } catch { if (!append) setPexResults([]) } finally { setPexLoading(false) }
  }, [pexQuery, pexResults.length])
  // Show something to browse right away (the search IS the library now) — one initial fetch on mount.
  const didInitSearchRef = useRef(false)
  useEffect(() => { if (!didInitSearchRef.current) { didInitSearchRef.current = true; searchPexels() } }, [searchPexels])
  // Dark-room = only dark clips selected → also softens the reactive beat-flash so nobody's blinded.
  const darkRoomRef = useRef(false); darkRoomRef.current = brightnessSet.length === 1 && brightnessSet[0] === 'dark'
  // Idle / "between-songs" transition mode: when no music is detected, drift through calm clips
  // and barely switch, until a song comes back.
  const [idleTransition, setIdleTransition] = useState(true)
  const idleTransitionRef = useRef(true); idleTransitionRef.current = idleTransition
  const [idle, setIdle] = useState(true)                    // true until music is detected
  const idleRef = useRef(true)
  const lastLoudRef = useRef(0)                             // last time real audio was heard (perf.now)
  const onIdleChangeRef = useRef<(nowIdle: boolean) => void>(() => {})
  const autoShuffleRef = useRef(false); autoShuffleRef.current = autoShuffle
  const bgKindRef = useRef(bgKind); bgKindRef.current = bgKind
  const shuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastErrSwitchRef = useRef(0)                        // debounce error-driven clip skips (no rapid cascade)
  const bgClipIdRef = useRef<string | null>(null)           // current clip id, so nextClip avoids repeats without re-binding
  const recentClipsRef = useRef<string[]>([])               // recently-played ids → no repeats until most of the pool has shown
  const tagRunRef = useRef<{ cat: BgCategory | null; left: number }>({ cat: null, left: 0 })   // stay on one theme for a run of clips
  const nextClipRef = useRef<() => void>(() => {})          // so the beat detector can advance on a bar boundary
  // Preload lookahead: keep the next 2 clips queued + buffering in hidden <video>s, and only
  // cut when the next one is playable — so slow devices/connections never flash a stalled frame.
  const queueRef = useRef<BgClip[]>([])                     // upcoming clips (aim for 2)
  const readySrcsRef = useRef<Set<string>>(new Set())       // srcs buffered enough to play smoothly
  const wantSwitchRef = useRef(false)                       // an auto-switch is waiting on the next clip to buffer
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bgVideoRef = useRef<HTMLVideoElement | null>(null)  // the visible bg video (to replay while we wait)
  const [preloadSrcs, setPreloadSrcs] = useState<string[]>([])
  // Energy-reactive selection: read the song's energy off the analyser and match backgrounds.
  const [matchEnergy, setMatchEnergy] = useState(false)
  const [energyBand, setEnergyBand] = useState<Energy>('mid')   // for the UI readout
  const matchEnergyRef = useRef(false); matchEnergyRef.current = matchEnergy
  const energyEmaRef = useRef(0)                             // smoothed loudness
  const energyBandRef = useRef<Energy>('mid')               // current band (hysteresis), read by nextClip
  const lastEnergyUiRef = useRef(0)
  const energyMinRef = useRef(1)                            // auto-calibrated to THIS song's dynamic range
  const energyMaxRef = useRef(0)                            // (relative energy → band, so it "improves to match")
  // Reactive amounts + detectors — mostly set by the genre presets.
  const [switchChance, setSwitchChance] = useState(0.35)   // per-bar chance to cut the video
  const [punchAmt, setPunchAmt] = useState(1)              // drum-punch intensity
  const switchChanceRef = useRef(0.35); switchChanceRef.current = switchChance
  const punchAmtRef = useRef(1); punchAmtRef.current = punchAmt
  const prevFreqRef = useRef<Uint8Array | null>(null)      // for spectral flux
  const densityEmaRef = useRef(0)                          // busyness (0 sparse … 1 busy)
  const bassRatioRef = useRef(0)                           // low-band share of the spectrum
  const brightRatioRef = useRef(0)                         // high-band share (brightness)
  // On-device "sounds like" read (free, non-AI heuristic from the DSP features). A character guess,
  // not a definitive genre — displayed so you can judge its accuracy before it drives anything.
  // The on-device "sounds like" read runs in the BACKGROUND (no visible chip) so we can keep
  // testing/tuning it. Latest result lives on this ref + window.__lbSonic for inspection.
  const sonicRef = useRef<{ family: Family; profile: string; confidence: number } | null>(null)
  const lastSonicUiRef = useRef(0)
  // Genre prior — a known genre (from song recognition or a broadcast track's tags) that biases the
  // per-frame read so the classifier isn't guessing blind when we already know the answer.
  const genrePriorRef = useRef<Family | null>(null)
  // Temporal voting — the look follows the majority genre over a ~15s window, not a single noisy
  // read, so it doesn't churn on an intro, a breakdown, or one ambiguous bar.
  const familyVotesRef = useRef<Family[]>([])
  const votedFamilyRef = useRef<{ family: Family; conf: number } | null>(null)
  const [density, setDensity] = useState(0)                // readout
  const lastDensityUiRef = useRef(0)
  const onsetEmaRef = useRef(0.3)                          // typical kick strength → auto-gains the drum punch
  // AUTO mode: one tap → fully automatic. Enables the whole reactive stack and adapts the
  // style/mode/backgrounds to the detected energy. Casual users just play music.
  const [auto, setAuto] = useState(false)
  const autoRef = useRef(false); autoRef.current = auto
  const autoApplyRef = useRef<() => void>(() => {})
  const lastAutoVibeRef = useRef('')
  const lastAutoChangeRef = useRef(0)
  const bgInputRef = useRef<HTMLInputElement | null>(null)
  const bgFilterRef = useRef<HTMLDivElement | null>(null)  // filters applied here; EQ mode drives it per frame
  // Offline save/download for the selected library clip
  const [savedCurrent, setSavedCurrent] = useState(false)
  const [savingBg, setSavingBg] = useState(false)
  const [bgMsg, setBgMsg] = useState('')
  const [bgSrcOverride, setBgSrcOverride] = useState<string | null>(null)   // local blob URL when saved offline
  const overrideRef = useRef<string | null>(null)
  const ambient = AMBIENTS.find(a => a.id === bgKind)
  const hasBg = bgKind === 'media' ? !!bgUrl : bgKind === 'library' ? !!bgClip : !!ambient
  const activeVideoMode = VIDEO_MODES.find(m => m.id === videoMode) ?? VIDEO_MODES[0]
  const activeVideoLook = VIDEO_LOOKS.find(l => l.id === videoLook) ?? VIDEO_LOOKS[0]
  const filterParts = (x: VideoLook) => [x.svg ? `url(#${x.svg})` : '', x.css || ''].filter(Boolean).join(' ')
  const lookFilterStr = [filterParts(activeVideoMode), filterParts(activeVideoLook)].filter(Boolean).join(' ')   // mode first, then grade
  lookFilterRef.current = lookFilterStr
  const activeOverlays = [...(activeVideoMode.overlays ?? []), ...(activeVideoLook.overlays ?? [])]
  const bgFilter = [lookFilterStr, `blur(${blur}px) brightness(${brightness}) saturate(${saturate}) hue-rotate(${hueRot}deg)`].filter(Boolean).join(' ')

  // Auto-shuffle: advance to a different clip in the pool (this category, or the whole
  // library). Driven by the video's 'ended' event, with a timer fallback below so it never
  // gets stuck on a still or a clip that fails to fire 'ended'.
  // Pick a fresh clip from the pool (no side effects on the visible bg). Excludes clips shown
  // recently AND ones already queued so the lookahead never doubles up.
  const pickClip = useCallback((): BgClip | null => {
    const bset = brightnessSetRef.current
    let pool: BgClip[]
    if (idleRef.current) {
      // Idle (no music): draw only from calm, low-movement transition clips — ignore the party
      // category/speed set, but still honor the brightness (dark-room) filter.
      pool = BG_LIBRARY.filter(c => c.kind === 'video' && TRANSITION_SET.has(c.id))
      if (bset.length) { const bm = pool.filter(c => bset.includes(clipBrightness(c))); if (bm.length >= 1) pool = bm }
    } else {
      // Draw from the bundled clips PLUS the ~15k-clip Pexels catalogue pool (fetched at runtime).
      const allVideos = [...BG_LIBRARY.filter(c => c.kind === 'video'), ...catalogPoolRef.current]
      // The video set is the categories to draw from ([] = the whole library).
      const set = videoSetRef.current
      pool = allVideos.filter(c => set.length === 0 || set.includes(c.category))
      // Brightness filter (dark-room safety): keep only the chosen brightness. This is a hard
      // promise — never flash-bang — so if the chosen categories don't have enough at that
      // brightness, we widen the category rather than let a brighter clip through.
      if (bset.length) {
        let bm = pool.filter(c => bset.includes(clipBrightness(c)))
        if (bm.length < 2) bm = allVideos.filter(c => bset.includes(clipBrightness(c)))
        if (bm.length >= 1) pool = bm
      }
      // Speed filter (soft): keep the chosen motion levels, fall back if too few.
      const sset = speedSetRef.current
      if (sset.length) { const sm = pool.filter(c => sset.includes(clipSpeed(c))); if (sm.length >= 2) pool = sm }
      // Auto: bias backgrounds to energy-appropriate categories (within the set).
      if (autoRef.current) {
        const cats = autoCategories(energyBandRef.current)
        const inCats = pool.filter(c => cats.includes(c.category))
        if (inCats.length >= 3) pool = inCats
      }
      // Match the song's energy when asked (fall back to the full pool if too few match).
      if (matchEnergyRef.current) {
        const matched = pool.filter(c => clipEnergy(c) === energyBandRef.current)
        if (matched.length >= 2) pool = matched
      }
    }
    if (pool.length < 2) return null
    // Tag cohesion: stay on ONE theme (category) for a run of clips — usually a few, sometimes a whole
    // song — before switching, so the visuals feel intentional instead of random channel-surfing.
    const run = tagRunRef.current
    let cohesive = pool
    if (run.cat && run.left > 0) {
      const same = pool.filter(c => c.category === run.cat)
      if (same.length >= 2) cohesive = same; else run.left = 0   // not enough on this theme → end the run
    }
    // No-repeat history: pick from clips not shown recently, so it works through most of the
    // pool before anything comes back (pure random clusters/repeats). Keep the recent window
    // to ~70% of the current pool; relax if that leaves nothing.
    const recent = recentClipsRef.current
    const queued = queueRef.current.map(c => c.id)
    let candidates = cohesive.filter(c => !recent.includes(c.id) && !queued.includes(c.id))
    if (candidates.length === 0) candidates = cohesive.filter(c => c.id !== bgClipIdRef.current && !queued.includes(c.id))
    if (candidates.length === 0) candidates = cohesive.filter(c => c.id !== bgClipIdRef.current)
    if (candidates.length === 0) return null
    const next = candidates[Math.floor(Math.random() * candidates.length)]
    // Advance / (re)start the theme run: exhausted → pick a fresh theme, mostly a few clips (1-3 more),
    // sometimes a long run (~a whole song).
    if (run.left > 0) run.left--
    else { run.cat = next.category; run.left = Math.random() < 0.3 ? 6 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 3) }
    recent.push(next.id)
    const keep = Math.max(4, Math.floor(pool.length * 0.7))
    while (recent.length > keep) recent.shift()
    return next
  }, [])

  // Top the lookahead queue up to 2 and (re)publish its srcs so the hidden preloader <video>s
  // start buffering the upcoming clips before we ever cut.
  const refillQueue = useCallback(() => {
    while (queueRef.current.length < 2) {
      const c = pickClip()
      if (!c) break
      queueRef.current.push(c)
    }
    const srcs = queueRef.current.map(c => c.src)
    setPreloadSrcs(prev => (prev.length === srcs.length && prev.every((s, i) => s === srcs[i]) ? prev : srcs))
  }, [pickClip])

  // A clip is "ready" to cut to once its src has buffered enough to play (images are instant).
  const clipReady = (c: BgClip | undefined) => !!c && (c.kind !== 'video' || readySrcsRef.current.has(c.src))

  // Cut to the head of the queue, then top the queue back up (starts preloading the new tail).
  const commitHead = useCallback(() => {
    if (waitTimerRef.current) { clearTimeout(waitTimerRef.current); waitTimerRef.current = null }
    wantSwitchRef.current = false
    const head = queueRef.current.shift()
    if (head) { setBgClip(head); setBgKind('library') }
    if (autoRef.current) autoApplyRef.current()   // Auto: re-fit filters + colours to the genre on each video change
    refillQueue()
  }, [refillQueue])

  // Immediate switch (manual Next / initial / toggle-on): prefer the preloaded head, else pick
  // fresh right now. Never waits — the user asked for it.
  const nextClip = useCallback(() => {
    refillQueue()
    if (queueRef.current.length === 0) { const c = pickClip(); if (c) { setBgClip(c); setBgKind('library') } refillQueue(); return }
    commitHead()
  }, [refillQueue, pickClip, commitHead])
  nextClipRef.current = nextClip

  // Auto switch (bar timer / clip ended): only cut when the next clip is buffered, so slow
  // devices/connections stay smooth. If it isn't ready, remember the intent — the preloader
  // commits it the moment it becomes playable (with a safety timeout so we never wait forever).
  // Returns whether it actually switched.
  const requestSwitch = useCallback((): boolean => {
    refillQueue()
    const head = queueRef.current[0]
    if (!head) return false
    if (clipReady(head)) { commitHead(); return true }
    if (!wantSwitchRef.current) {
      wantSwitchRef.current = true
      if (waitTimerRef.current) clearTimeout(waitTimerRef.current)
      waitTimerRef.current = setTimeout(() => { if (wantSwitchRef.current) commitHead() }, 6000)   // don't stall forever
    }
    return false
  }, [refillQueue, commitHead])

  // Music started / stopped (idle flipped) → repick for the new mode: drop the queue (it was
  // filled for the old mode) and immediately move to an appropriate clip — a party clip when a
  // song kicks in, a calm transition when it goes quiet.
  const onIdleChange = useCallback(() => {
    if (!autoShuffleRef.current || bgKindRef.current !== 'library') return
    queueRef.current = []; recentClipsRef.current = []; setPreloadSrcs([])
    tagRunRef.current = { cat: null, left: 0 }   // new song → let it pick a fresh theme to settle on
    nextClip()
  }, [nextClip])
  onIdleChangeRef.current = onIdleChange

  // Keep idle state honest when the toggle flips or audio stops: off = never idle; on-and-silent
  // = idle. (While a song is running, the draw loop owns the idle flag.)
  useEffect(() => {
    if (!idleTransition) { if (idleRef.current) { idleRef.current = false; setIdle(false); onIdleChangeRef.current(false) } }
    else if (!running) { if (!idleRef.current) { idleRef.current = true; setIdle(true); onIdleChangeRef.current(true) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleTransition, running])

  useEffect(() => { bgClipIdRef.current = bgClip?.id ?? null }, [bgClip])
  // Seed / refresh the lookahead whenever shuffle is active and the clip changes; clear it off.
  useEffect(() => {
    if (!autoShuffle || bgKind !== 'library' || !bgClip) {
      queueRef.current = []; wantSwitchRef.current = false
      if (waitTimerRef.current) { clearTimeout(waitTimerRef.current); waitTimerRef.current = null }
      setPreloadSrcs([]); return
    }
    refillQueue()
  }, [autoShuffle, bgKind, bgClip, refillQueue])
  // Bar timer: each bar (4 beats, from the detected BPM — or ~4s if no beat) roll the
  // "Switch chance" to cut the video, nudged by energy (when matching) and density. The video
  // ALSO advances when it finishes (onEnded), so it always moves on even at 0% chance.
  useEffect(() => {
    if (shuffleTimerRef.current) { clearTimeout(shuffleTimerRef.current); shuffleTimerRef.current = null }
    if (!autoShuffle || bgKind !== 'library' || !bgClip) return
    let stopped = false
    const tick = () => {
      if (stopped) return
      if (idleRef.current) {
        // Idle / between songs: hold the calm clip (it loops) and drift to a new transition only
        // every ~60s, so it stays quiet until music returns.
        shuffleTimerRef.current = setTimeout(() => { requestSwitch(); tick() }, 60000)
        return
      }
      const bpm = bpmEmaRef.current
      const barMs = bpm > 0 ? Math.max(1000, Math.round((4 * 60000) / bpm)) : 4000
      shuffleTimerRef.current = setTimeout(() => {
        const ef = matchEnergyRef.current ? (energyBandRef.current === 'hot' ? 1.4 : energyBandRef.current === 'mid' ? 1.0 : 0.6) : 1
        const df = 0.7 + densityEmaRef.current * 0.8
        if (Math.random() < Math.min(1, switchChanceRef.current * ef * df)) requestSwitch()   // gated: waits for the next clip to buffer
        tick()
      }, barMs)
    }
    tick()
    return () => { stopped = true; if (shuffleTimerRef.current) clearTimeout(shuffleTimerRef.current) }
  }, [autoShuffle, bgKind, bgClip, requestSwitch])
  const pickBgFile = useCallback((f: File) => {
    setBgUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
    setBgVideo(f.type.startsWith('video/')); setBgKind('media')
  }, [])
  useEffect(() => () => { if (bgUrl) URL.revokeObjectURL(bgUrl) }, [bgUrl])
  // When a library clip is selected, use its offline copy if it's been saved (no network needed).
  useEffect(() => {
    let cancelled = false
    const revoke = () => { if (overrideRef.current) { URL.revokeObjectURL(overrideRef.current); overrideRef.current = null } }
    setBgMsg('')
    if (bgKind !== 'library' || !bgClip) { revoke(); setBgSrcOverride(null); setSavedCurrent(false); return }
    ;(async () => {
      const url = await localUrl(bgClip.src)
      if (cancelled) { if (url) URL.revokeObjectURL(url); return }
      revoke(); overrideRef.current = url; setBgSrcOverride(url)
      setSavedCurrent(url ? true : await hasAsset(bgClip.src))
    })()
    return () => { cancelled = true }
  }, [bgKind, bgClip])
  useEffect(() => () => { if (overrideRef.current) URL.revokeObjectURL(overrideRef.current) }, [])
  const saveBgOffline = useCallback(async () => {
    if (!bgClip) return
    setSavingBg(true); setBgMsg('')
    const ok = await saveAssets(bgClip.kind === 'video' ? [bgClip.src, bgClip.preview] : [bgClip.src])
    if (ok) { const url = await localUrl(bgClip.src); if (overrideRef.current) URL.revokeObjectURL(overrideRef.current); overrideRef.current = url; setBgSrcOverride(url); setSavedCurrent(true) }
    else setBgMsg('Couldn’t save — the clip isn’t reachable yet (needs a connection, and CORS for streamed clips).')
    setSavingBg(false)
  }, [bgClip])
  const removeBgOffline = useCallback(async () => {
    if (!bgClip) return
    await removeAssets([bgClip.src, bgClip.preview])
    if (overrideRef.current) { URL.revokeObjectURL(overrideRef.current); overrideRef.current = null }
    setBgSrcOverride(null); setSavedCurrent(false)
  }, [bgClip])
  const downloadBg = useCallback(async () => {
    if (!bgClip) return
    setBgMsg('')
    const ext = bgClip.src.split('.').pop() || (bgClip.kind === 'video' ? 'mp4' : 'jpg')
    const ok = await downloadToDevice(bgClip.src, `${bgClip.id}.${ext}`)
    if (!ok) setBgMsg('Couldn’t download — the clip isn’t reachable yet.')
  }, [bgClip])
  // EQ-filter driver: the draw loop reads this; when off (or no audio), the static filter applies.
  const eqRef = useRef({ on: false, blur, brightness, saturate, hueRot })
  useEffect(() => { eqRef.current = { on: reactive, blur, brightness, saturate, hueRot } }, [reactive, blur, brightness, saturate, hueRot])
  // Restore the static filter whenever EQ mode is off (the loop may have left an imperative value).
  useEffect(() => { if (!reactive && bgFilterRef.current) { bgFilterRef.current.style.filter = bgFilter; bgFilterRef.current.style.transform = '' } }, [reactive, bgFilter])
  // Cross-dissolve on every background switch: black out instantly (transition off + reflow), then
  // fade the new clip in over .5s. Masks the hard cut AND the Auto look change that lands with it.
  // Opacity is independent of the per-frame EQ filter/transform, so reactivity stays instant.
  const firstBgRef = useRef(true)
  useEffect(() => {
    if (firstBgRef.current) { firstBgRef.current = false; return }
    const el = bgFilterRef.current; if (!el) return
    el.style.transition = 'none'; el.style.opacity = '0'; void el.offsetHeight
    el.style.transition = 'opacity .5s ease'
    const r = requestAnimationFrame(() => { if (bgFilterRef.current) bgFilterRef.current.style.opacity = '1' })
    return () => cancelAnimationFrame(r)
  }, [bgClip?.id, bgUrl, bgKind])

  // EDITS render loop — sample the on-screen video, find the region (motion diff or COCO-SSD objects),
  // and paint the region-targeted effect on the FX canvas. Only runs while an edit is active.
  useEffect(() => {
    const clearFx = () => { const fx = fxCanvasRef.current; if (fx) fx.getContext('2d')?.clearRect(0, 0, fx.width, fx.height) }
    if (edit === 'none' && !detector) { boxRef.current = null; boxesRef.current = []; freezeRef.current = null; clearFx(); return }
    // Detector diagnostic forces labelled-box ('track') rendering regardless of the chosen edit.
    const activeEdit = detector ? 'track' : edit
    const kind = EDITS.find(e => e.id === activeEdit)?.kind
    const motion = (motionRef.current ||= new MotionDetector())
    motion.reset(); boxRef.current = null; boxesRef.current = []; freezeRef.current = null
    let alive = true, raf = 0, lastDetect = 0
    let model: Awaited<ReturnType<typeof loadObjectDetector>> | null = null
    if (kind === 'object') {
      setModelState('loading')
      loadObjectDetector().then(m => { if (alive) { model = m; setModelState('ready') } }).catch(() => { if (alive) setModelState('error') })
    }
    const getVideo = () => (bgFilterRef.current?.querySelector('video') ?? null) as HTMLVideoElement | null   // the main bg video only (not the 1px preloaders)

    const loop = (t: number) => {
      if (!alive) return
      raf = requestAnimationFrame(loop)
      const video = getVideo(), fx = fxCanvasRef.current, wrap = wrapRef.current
      if (!video || !fx || !wrap || video.readyState < 2 || !video.videoWidth) { return }
      const w = wrap.clientWidth, h = wrap.clientHeight
      if (fx.width !== w || fx.height !== h) { fx.width = w; fx.height = h }
      const ctx = fx.getContext('2d'); if (!ctx) return
      const vw = video.videoWidth, vh = video.videoHeight, m = coverMap(w, h, vw, vh)

      if (activeEdit === 'freeze') {
        // keep tracking the mover so we know where to highlight when we freeze
        boxRef.current = lerpBox(boxRef.current, motion.detect(video), 0.3)
        const fz = freezeRef.current
        if (!fz) { ctx.clearRect(0, 0, w, h); return }
        const dt = t - fz.t0
        if (dt < 600) {                                   // TRAIL — ghost frames, ramp toward slow-mo
          video.playbackRate = Math.max(0.25, 1 - (dt / 600) * 0.75)
          ctx.fillStyle = 'rgba(6,5,10,0.26)'; ctx.fillRect(0, 0, w, h)
          ctx.globalAlpha = 0.5; try { ctx.drawImage(video, m.ox, m.oy, m.dw, m.dh) } catch {} ctx.globalAlpha = 1
        } else if (dt < 1900) {                           // FREEZE — pause, clean frame, highlight the mover
          if (!fz.frozen) { video.pause(); fz.frozen = true; fz.box = boxRef.current }
          ctx.clearRect(0, 0, w, h); try { ctx.drawImage(video, m.ox, m.oy, m.dw, m.dh) } catch {}
          if (fz.box) {
            const b = boxToStage(fz.box, m), cx = b.x + b.w / 2, cy = b.y + b.h / 2
            const rx = Math.max(48, b.w * 0.75), ry = Math.max(48, b.h * 0.75)
            ctx.fillStyle = 'rgba(4,4,10,0.55)'; ctx.fillRect(0, 0, w, h)
            const g = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.3, cx, cy, Math.max(rx, ry))
            g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = g
            ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.fill(); ctx.globalCompositeOperation = 'source-over'
            ctx.strokeStyle = 'rgba(147,197,255,0.9)'; ctx.lineWidth = 2.5; ctx.shadowColor = '#93c5ff'; ctx.shadowBlur = 22
            ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.stroke(); ctx.shadowBlur = 0
          }
        } else if (dt < 2300) {                           // RELEASE — resume + fade the overlay out
          if (fz.frozen) { video.playbackRate = 1; video.play().catch(() => {}); fz.frozen = false }
          ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'
        } else { freezeRef.current = null; ctx.clearRect(0, 0, w, h) }
        return
      }

      if (activeEdit === 'kaleido') { drawKaleido(ctx, w, h, video); return }

      if (activeEdit === 'trails') {
        // fade the existing trail toward transparent, then stamp the current moving region → an echo
        ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'
        const b0 = motion.detect(video); boxRef.current = lerpBox(boxRef.current, b0, 0.4)
        if (b0) {
          const b = boxToStage(b0, m)
          ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip()
          try { ctx.drawImage(video, m.ox, m.oy, m.dw, m.dh) } catch {}
          ctx.restore()
        }
        return
      }

      if (activeEdit === 'ramp') {
        if (model && t - lastDetect > 170) {
          lastDetect = t
          detectObjects(model, video).then(bs => {
            if (!alive) return
            boxesRef.current = bs; boxRef.current = lerpBox(boxRef.current, bs[0] ?? null, 0.4)
            if (bs.length > prevCountRef.current && !rampRef.current && t - rampCooldownRef.current > 3500) { rampRef.current = { t0: performance.now() }; rampCooldownRef.current = t }
            prevCountRef.current = bs.length
          }).catch(() => {})
        }
        const r = rampRef.current, nowP = performance.now()
        if (r && nowP - r.t0 < 1600) { video.playbackRate = 0.3 } else { if (r) rampRef.current = null; video.playbackRate = 1 }
        // draw: faint boxes always; during the ramp, spotlight the newcomer + a "slow-mo" cue
        ctx.clearRect(0, 0, w, h)
        if (rampRef.current && boxRef.current) {
          const b = boxToStage(boxRef.current, m), cx = b.x + b.w / 2, cy = b.y + b.h / 2
          const rx = Math.max(50, b.w * 0.8), ry = Math.max(50, b.h * 0.8)
          ctx.fillStyle = 'rgba(4,4,10,0.5)'; ctx.fillRect(0, 0, w, h)
          const g = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.35, cx, cy, Math.max(rx, ry))
          g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = g
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.fill(); ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = 'rgba(147,197,255,0.9)'; ctx.lineWidth = 2.5; ctx.shadowColor = '#93c5ff'; ctx.shadowBlur = 20
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.stroke(); ctx.shadowBlur = 0
          ctx.fillStyle = '#93c5ff'; ctx.font = '800 12px system-ui, sans-serif'; ctx.fillText('◉ slow-mo', 12, h - 14)
        } else {
          ctx.strokeStyle = 'rgba(147,197,255,0.4)'; ctx.lineWidth = 1.5
          for (const bx of boxesRef.current) { const b = boxToStage(bx, m); ctx.strokeRect(b.x, b.y, b.w, b.h) }
        }
        return
      }

      if (kind === 'motion') boxRef.current = lerpBox(boxRef.current, motion.detect(video), 0.3)
      else if (kind === 'object' && model && t - lastDetect > 170) {
        lastDetect = t
        detectObjects(model, video).then(bs => { if (alive) { boxesRef.current = bs; boxRef.current = lerpBox(boxRef.current, bs[0] ?? null, 0.4) } }).catch(() => {})
      }
      drawEditFx(ctx, w, h, activeEdit, video, boxRef.current, boxesRef.current)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false; cancelAnimationFrame(raf); clearFx()
      rampRef.current = null; freezeRef.current = null; prevCountRef.current = 0
      const v = getVideo(); if (v) { v.playbackRate = 1; if (v.paused) v.play().catch(() => {}) }   // undo any slow-mo/freeze
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, detector])

  // Detector genre readout — surface the on-device "sounds like" classification (normally silent) so
  // you can watch what genre/tone it reads. Polls the ref the audio loop writes ~2x/sec.
  useEffect(() => {
    if (!detector) { setSonicView(null); return }
    const id = setInterval(() => setSonicView(sonicRef.current ? { ...sonicRef.current } : null), 500)
    return () => clearInterval(id)
  }, [detector])

  // Genre "Looks" — apply a whole scene, with a random genre-appropriate background.
  const [activeLook, setActiveLook] = useState<GenreLook | null>(null)
  const shuffleTo = useCallback((look: GenreLook) => {
    const pool = look.bg.pool
    if (!pool.length) return
    const id = pool[Math.floor(Math.random() * pool.length)]
    const clip = clipById(id)            // an image/video clip in the library…
    if (clip) { setBgClip(clip); setBgKind('library') }
    else { setBgKind(id); setBgClip(null) }   // …otherwise it's an ambient gradient id
  }, [])
  const applyLook = useCallback((look: GenreLook) => {
    setStyle(look.style)
    setColorCfg({ paletteId: look.palette, plane: null, mode: look.mode })
    setGain(look.gain); setSmoothing(look.smoothing)
    setMirror(look.mirror); setGlow(look.glow); setTrail(look.trail)
    setMatchVisuals(look.match); setBeatColor(!!look.beat)
    // Reactive amounts — explicit on the preset, else derived from its character.
    setPunchAmt(look.punch ?? (look.eq ? (look.gain >= 1.4 ? 1.5 : 1.0) : 0.7))
    setSwitchChance(look.switchChance ?? (look.trail ? 0.25 : 0.45))
    setBlur(look.filters.blur); setBrightness(look.filters.brightness); setSaturate(look.filters.saturate); setHueRot(look.filters.hue)
    setVideoLook(look.grade ?? 'none'); setVideoMode('none')   // apply the preset's cinematic grade
    setBgCat(look.bg.browse); setActiveLook(look); shuffleTo(look)
  }, [shuffleTo])

  // AUTO re-vibe (called on section changes): ONLY the style + filter mode adapt to the energy.
  // It deliberately does NOT touch the reactive toggles, so anything you switch off (e.g. colour
  // on the beat) stays off while Auto runs.
  const lastAutoFamilyRef = useRef<Family | null>(null)
  const userPaletteRef = useRef(false)   // the user picked a palette → Auto stops re-rolling it (drum flash follows their choice)
  const applyAuto = useCallback(() => {
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
    // Fit the filters (mode + look) + colours (palette) to the VOTED genre (smoothed over ~15s,
    // biased by any known prior), else fall back to the energy band. Called on each video change —
    // NOT on a timer — and never touches the audio visualizer style.
    const v = votedFamilyRef.current
    const known = v && v.conf >= 0.34 && GENRE_LOOK[v.family] ? v.family : null
    const src = (known && GENRE_LOOK[known]) || ENERGY_LOOK[energyBandRef.current]
    // Hysteresis: keep the same palette family while the genre holds — only fully re-roll the look
    // when the voted genre actually changes, so a stable song doesn't recolour every clip.
    const changed = known !== lastAutoFamilyRef.current
    lastAutoFamilyRef.current = known
    // Auto fits a subtle grade + palette to the genre but NEVER touches the transform (Mode): the
    // clean untransformed video is the default (Mode starts 'none'), and if the user picks a Mode
    // themselves it persists — Auto won't override their choice.
    setVideoLook(pick(src.looks))
    // Don't override a palette the user picked — the beat flash / drum bump should follow THEIR colour.
    if ((changed || !known) && !userPaletteRef.current) setColorCfg(c => ({ ...c, paletteId: pick(src.palettes), plane: null }))
  }, [])
  autoApplyRef.current = applyAuto
  const toggleAuto = useCallback(() => {
    setAuto(a => {
      if (!a) {
        // Turning Auto ON: set the reactive stack + baselines ONCE — you can tweak any of it after.
        setReactive(true); setMatchEnergy(true); setBeatColor(true); setAutoShuffle(true)
        setSwitchChance(0.4); setPunchAmt(1)
        lastAutoVibeRef.current = ''; lastAutoChangeRef.current = 0
        userPaletteRef.current = false   // fresh Auto session picks palettes by genre; a palette you pick after persists
        applyAuto()
        nextClipRef.current()   // pick an initial background so there's something to play/switch

      }
      return !a
    })
  }, [applyAuto])

  // Colour presets — new key 'lightningbug-colorpresets'; one-time fall back to the old
  // 'musicvideo-colorpresets' so nothing saved before the rename is lost.
  useEffect(() => { try { const r = localStorage.getItem('lightningbug-colorpresets') ?? localStorage.getItem('musicvideo-colorpresets'); if (r) setPresets(JSON.parse(r)) } catch { /* off */ } }, [])
  const savePreset = useCallback(() => {
    const name = (typeof prompt === 'function' ? prompt('Name this colour preset') : '')?.trim()
    if (!name) return
    setPresets(prev => {
      const next = [...prev.filter(p => p.name !== name), { id: `${Date.now()}`, name, cfg: colorCfg }].slice(-24)
      try { localStorage.setItem('lightningbug-colorpresets', JSON.stringify(next)) } catch { /* off */ }
      return next
    })
  }, [colorCfg])
  const removePreset = useCallback((id: string) => setPresets(prev => { const next = prev.filter(p => p.id !== id); try { localStorage.setItem('lightningbug-colorpresets', JSON.stringify(next)) } catch { /* off */ } return next }), [])

  // ── Scenes: save/load the WHOLE setup (look, filters, reactivity + video set) ──────────
  // localStorage is the offline cache; when signed in they also sync to the account so scenes
  // follow across devices (/api/scenes).
  const { isSignedIn } = useUser()
  const [scenes, setScenes] = useState<Scene[]>([])
  useEffect(() => { try { const r = localStorage.getItem('lightningbug-scenes'); if (r) setScenes(JSON.parse(r)) } catch { /* off */ } }, [])
  const persistScenes = (next: Scene[]) => { try { localStorage.setItem('lightningbug-scenes', JSON.stringify(next)) } catch { /* off */ } return next }
  // Merge the account's scenes in when signed in (server wins on id conflicts).
  useEffect(() => {
    if (!isSignedIn) return
    let cancelled = false
    fetch('/api/scenes').then(r => (r.ok ? r.json() : [])).then((server: Scene[]) => {
      if (cancelled || !Array.isArray(server) || server.length === 0) return
      setScenes(prev => {
        const byId = new Map<string, Scene>()
        prev.forEach(s => byId.set(s.id, s))
        server.forEach(s => s?.id && byId.set(s.id, s))
        return persistScenes([...byId.values()].slice(-48))
      })
    }).catch(() => { /* offline — keep local */ })
    return () => { cancelled = true }
  }, [isSignedIn])
  const saveScene = useCallback(() => {
    const name = (typeof prompt === 'function' ? prompt('Name this scene') : '')?.trim()
    if (!name) return
    const scene: Scene = {
      id: `${Date.now()}`, name,
      style, colorCfg, seed, videoMode, videoLook,
      mirror, glow, trail, gain, smoothing,
      blur, brightness, saturate, hueRot,
      beatColor, punchAmt,
      reactive, matchVisuals, matchEnergy, autoShuffle, videoSet, brightnessSet, speedSet, idleTransition, switchChance,
      bgCat, bgKind, bgClipId: bgClip?.id ?? null,
    }
    setScenes(prev => persistScenes([...prev.filter(s => s.name !== name), scene].slice(-24)))
    if (isSignedIn) fetch('/api/scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scene) }).catch(() => { /* stays local */ })
  }, [style, colorCfg, seed, videoMode, videoLook, mirror, glow, trail, gain, smoothing, blur, brightness, saturate, hueRot, beatColor, punchAmt, reactive, matchVisuals, matchEnergy, autoShuffle, videoSet, brightnessSet, speedSet, idleTransition, switchChance, bgCat, bgKind, bgClip, isSignedIn])
  const loadScene = useCallback((s: Scene) => {
    setAuto(false)   // a saved scene is your own setup — hand control back to you
    setStyle(s.style); setColorCfg(s.colorCfg); setSeed(s.seed); setVideoMode(s.videoMode); setVideoLook(s.videoLook)
    setMirror(s.mirror); setGlow(s.glow); setTrail(s.trail); setGain(s.gain); setSmoothing(s.smoothing)
    setBlur(s.blur); setBrightness(s.brightness); setSaturate(s.saturate); setHueRot(s.hueRot)
    setBeatColor(s.beatColor); setPunchAmt(s.punchAmt)
    setReactive(s.reactive); setMatchVisuals(s.matchVisuals); setMatchEnergy(s.matchEnergy); setAutoShuffle(s.autoShuffle); setVideoSet(s.videoSet ?? []); setBrightnessSet(s.brightnessSet ?? []); setSpeedSet(s.speedSet ?? []); setIdleTransition(s.idleTransition ?? true); setSwitchChance(s.switchChance)
    setBgCat(s.bgCat)
    if (s.bgKind === 'library' && s.bgClipId) { const c = clipById(s.bgClipId); if (c) { setBgClip(c); setBgKind('library') } }
    else if (s.bgKind && s.bgKind !== 'media') { setBgKind(s.bgKind); setBgClip(null) }
  }, [])
  const deleteScene = useCallback((id: string) => {
    setScenes(prev => persistScenes(prev.filter(s => s.id !== id)))
    if (isSignedIn) fetch(`/api/scenes?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => { /* ok */ })
  }, [isSignedIn])
  const pushScene = useCallback((s: Scene) => { if (isSignedIn) fetch('/api/scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) }).catch(() => {}) }, [isSignedIn])
  const renameScene = useCallback((id: string) => {
    const name = (typeof prompt === 'function' ? prompt('Rename scene') : '')?.trim()
    if (!name) return
    setScenes(prev => { const next = prev.map(s => s.id === id ? { ...s, name } : s); persistScenes(next); const s = next.find(x => x.id === id); if (s) pushScene(s); return next })
  }, [pushScene])
  const setDefaultScene = useCallback((id: string) => {
    setScenes(prev => { const next = prev.map(s => ({ ...s, isDefault: s.id === id ? !s.isDefault : false })); persistScenes(next); next.forEach(pushScene); return next })
  }, [pushScene])
  const [sharedMsg, setSharedMsg] = useState('')
  const shareScene = useCallback((s: Scene) => {
    const url = `${location.origin}/apps/lightningbug?scene=${sceneEncode({ ...s, id: undefined, isDefault: undefined })}`
    navigator.clipboard?.writeText(url).then(() => { setSharedMsg(`Link copied for “${s.name}”`); setTimeout(() => setSharedMsg(''), 2500) }).catch(() => setSharedMsg('Couldn’t copy the link'))
  }, [])
  // Auto-load the default scene once, when it first becomes available — unless a shared
  // ?scene= link is opening, which takes precedence.
  const autoLoadedRef = useRef(false)
  useEffect(() => {
    if (autoLoadedRef.current || scenes.length === 0) return
    autoLoadedRef.current = true
    if (new URLSearchParams(window.location.search).get('scene')) return   // shared link wins
    const def = scenes.find(s => s.isDefault)
    if (def) loadScene(def)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes])

  const audioRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)   // "play a track" source
  const fileUrlRef = useRef<string | null>(null)
  // Broadcast/radio mode: a playlist of tracks fed through the analyser (see lib/stations.ts).
  const broadcastTracksRef = useRef<BroadcastTrack[]>([])
  const broadcastIdxRef = useRef(0)
  const [nowPlaying, setNowPlaying] = useState<BroadcastTrack | null>(null)
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null)
  // Passive song identification (AudD, Shazam-like) — records a short clip off the audio and
  // recognizes it. Gives the "now playing" name + ground-truth (Spotify) tempo/energy to sanity-
  // check the DSP. recDest is a silent tap on the audio graph we record from.
  const recDestRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const recognizingRef = useRef(false)
  const [identify, setIdentify] = useState(false)
  const identifyRef = useRef(false); identifyRef.current = identify
  const [recognized, setRecognized] = useState<{ title: string; artist: string; genre: string | null; artwork: string | null; features: { tempo: number } | null } | null>(null)
  const [idMsg, setIdMsg] = useState<string | null>(null)
  const trackInputRef = useRef<HTMLInputElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)
  const bufRef = useRef<Array<{ t: number; freq: Uint8Array; wave: Uint8Array }>>([])
  const optsRef = useRef<LiveOpts>({ style, colors, mode: colorCfg.mode, seed, gain, mirror, glow, trail, bg: hasBg })
  useEffect(() => { optsRef.current = { style, colors, mode: colorCfg.mode, seed, gain, mirror, glow, trail, bg: hasBg, beatColor } }, [style, colors, colorCfg.mode, seed, gain, mirror, glow, trail, hasBg, beatColor])
  const delayRef = useRef(delayMs); useEffect(() => { delayRef.current = delayMs }, [delayMs])
  const smoothingRef = useRef(smoothing)
  useEffect(() => { smoothingRef.current = smoothing; if (analyserRef.current) analyserRef.current.smoothingTimeConstant = smoothing }, [smoothing])

  const wake = useCallback(async () => {
    try { wakeRef.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* unsupported */ }
  }, [])

  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.src = ''; audioElRef.current = null }
    if (fileUrlRef.current) { URL.revokeObjectURL(fileUrlRef.current); fileUrlRef.current = null }
    void audioRef.current?.close().catch(() => {}); audioRef.current = null
    void wakeRef.current?.release().catch(() => {}); wakeRef.current = null
    analyserRef.current = null; bufRef.current = []; recDestRef.current = null
    setRunning(false); setSource(null); setNowPlaying(null); setRecognized(null); sonicRef.current = null
    genrePriorRef.current = null; familyVotesRef.current = []; votedFamilyRef.current = null
    // No audio → back to idle/transition mode (also repicks a calm clip if shuffling).
    lastLoudRef.current = 0
    if (idleTransitionRef.current && !idleRef.current) { idleRef.current = true; setIdle(true); onIdleChangeRef.current(true) }
  }, [])

  // Fresh song → fresh detectors: reset BPM, beat and energy state so nothing carries over from
  // the previous track (all non-AI — pure analyser math). Also called per playlist track.
  const resetDetectors = useCallback(() => {
    bpmEmaRef.current = 0; beatIvBufRef.current = []; setBpm(0)
    bassAvgRef.current = 0; energyEmaRef.current = 0; punchEnvRef.current = 0
    energyMinRef.current = 1; energyMaxRef.current = 0   // recalibrate dynamic range to the new song
    prevFreqRef.current = null; densityEmaRef.current = 0; onsetEmaRef.current = 0.3
    lastBeatRef.current = 0; prevBeatRef.current = 0
  }, [])

  // Record ~7s off the audio tap and ask the recognizer what's playing (once at a time).
  const recognizeNow = useCallback(async () => {
    const dest = recDestRef.current
    if (!identifyRef.current || !dest || recognizingRef.current || typeof MediaRecorder === 'undefined') return
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || ''
    let rec: MediaRecorder
    try { rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined) } catch { return }
    recognizingRef.current = true
    const chunks: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: mime || 'audio/webm' })
        if (blob.size < 2000) return   // basically silence
        const fd = new FormData(); fd.append('audio', blob, 'clip.webm')
        const r = await fetch('/api/recognize', { method: 'POST', body: fd })
        const d = await r.json()
        if (d.error === 'not_configured') setIdMsg('Add AUDD_API_TOKEN to enable song ID')
        else if (d.match) { setRecognized(d.match); setIdMsg(null); genrePriorRef.current = tagsToFamily(d.match.genre ? [d.match.genre] : null) }   // recognized genre → classifier prior
      } catch { /* ignore — try again next tick */ } finally { recognizingRef.current = false }
    }
    try { rec.start(); window.setTimeout(() => { try { rec.stop() } catch { /* already stopped */ } }, 7000) } catch { recognizingRef.current = false }
  }, [])
  // Identify ONCE when turned on (cost control — AudD is billed per call). It also re-IDs on a new
  // song after a quiet gap (below). No polling; the visuals never depend on it.
  useEffect(() => {
    if (!identify || !running) return
    const t0 = window.setTimeout(() => recognizeNow(), 1500)
    return () => clearTimeout(t0)
  }, [identify, running, recognizeNow])
  // A new song after a quiet gap → re-identify right away.
  useEffect(() => { if (!idle && identify && running) recognizeNow() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle])
  // Lean on recognition: seed BPM from the identified track's real tempo (Deezer) so beat-sync and
  // clip switching lock instantly — with less reliance on live DSP — until the detector locks its own.
  useEffect(() => {
    const tempo = recognized?.features?.tempo
    if (!tempo || !running || bpmEmaRef.current > 0) return
    let v = tempo; while (v > 175) v /= 2; while (v < 70) v *= 2
    bpmEmaRef.current = v; setBpm(Math.round(v))
  }, [recognized, running])

  const start = useCallback(async (src: 'mic' | 'device' | 'file' | 'broadcast', file?: File) => {
    setErr(null)
    resetDetectors()
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC(); audioRef.current = ctx
      await ctx.resume().catch(() => {})
      const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = smoothingRef.current
      const recDest = ctx.createMediaStreamDestination(); recDestRef.current = recDest   // silent tap for song ID

      if (src === 'broadcast') {
        // Radio mode: play a playlist through the analyser. Same-origin files play directly; remote
        // URLs stream through /api/broadcast/audio so Web Audio can read them (CORS).
        const el = new Audio(); el.crossOrigin = 'anonymous'; el.preload = 'auto'
        audioElRef.current = el
        const node = ctx.createMediaElementSource(el)
        node.connect(an); node.connect(ctx.destination); node.connect(recDest)
        const proxied = (u: string) => u.startsWith('http') ? `/api/broadcast/audio?src=${encodeURIComponent(u)}` : u
        const playAt = async (i: number) => {
          const list = broadcastTracksRef.current
          if (!list.length) return
          const idx = ((i % list.length) + list.length) % list.length
          broadcastIdxRef.current = idx
          const t = list[idx]
          resetDetectors()
          // Each broadcast track carries its known genre (resolved server-side from its tags) → feed
          // it as the classifier prior and reset the vote so the read locks on fast.
          genrePriorRef.current = (t.genre as Family | undefined) ?? null
          familyVotesRef.current = []; votedFamilyRef.current = null
          setNowPlaying(t)
          el.src = proxied(t.url)
          try { await el.play() }
          catch (e) {
            if ((e as DOMException)?.name === 'NotAllowedError') { setBroadcastMsg('Tap anywhere to start the broadcast'); return }   // autoplay blocked — wait for a gesture, don't skip
            window.setTimeout(() => { void playAt(idx + 1) }, 1500)   // dead track → skip on
          }
        }
        el.addEventListener('ended', () => { void playAt(broadcastIdxRef.current + 1) })
        el.addEventListener('error', () => { window.setTimeout(() => { void playAt(broadcastIdxRef.current + 1) }, 1500) })
        await playAt(0)
      } else if (src === 'file') {
        // Play the track THROUGH the app and tap it directly — no mic, no screen prompt.
        // The <audio> element still plays out to the speaker / Bluetooth / AirPlay.
        if (!file) throw new Error('No audio file')
        const url = URL.createObjectURL(file); fileUrlRef.current = url
        const el = new Audio(); el.src = url; el.loop = true; el.crossOrigin = 'anonymous'
        audioElRef.current = el
        const node = ctx.createMediaElementSource(el)
        node.connect(an); node.connect(ctx.destination); node.connect(recDest)   // audible, tapped for visuals + song ID
        await el.play().catch(() => { throw new Error('Couldn’t play that file — try an MP3, M4A, or WAV.') })
      } else {
        const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: unknown) => Promise<MediaStream> }
        let stream: MediaStream
        if (src === 'device') {
          // No API grabs internal audio silently — another tab/app's sound needs the screen-share
          // prompt. We keep the whole stream alive (stopping the video track kills the audio).
          if (!md.getDisplayMedia) throw new Error('Capturing device audio needs a desktop browser. On a phone, use the microphone or play a track through the app.')
          // The screen-share prompt is the browser's only route to system audio. Ask for system
          // audio explicitly and keep it playing on the speakers. Pick "Entire Screen" +
          // "Share system audio" for everything, or a tab + "Share tab audio".
          stream = await md.getDisplayMedia({ video: true, audio: { systemAudio: 'include', suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
          if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); throw new Error('No audio was shared. In the picker, choose "Entire Screen" and turn on "Share system audio" (or a tab + "Share tab audio").') }
        } else {
          stream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        }
        streamRef.current = stream
        stream.getTracks().forEach(t => t.addEventListener('ended', () => stop()))   // user hit "Stop sharing"
        const srcNode = ctx.createMediaStreamSource(stream); srcNode.connect(an); srcNode.connect(recDest)
      }
      analyserRef.current = an
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
          // Beat detection off the low band (kick): energy rising above a running average,
          // debounced → a beat pulse that cycles the palette + estimates BPM.
          let bass = 0; for (let i = 0; i < 12; i++) bass += f.freq[i]
          bass /= 12 * 255
          bassAvgRef.current = bassAvgRef.current * 0.94 + bass * 0.06
          // Sub/bass transient → a "punch" envelope: how far the low end jumps above its own
          // average right now (fast attack, slow release), so kicks/drums pop the filters.
          const punch = Math.max(0, (bass - bassAvgRef.current) * 4)
          punchEnvRef.current = Math.max(Math.min(1, punch), punchEnvRef.current * 0.85)
          // Density / busyness — spectral flux (how much the spectrum is changing). Busy songs
          // (lots of notes/percussion) read high; drones read low.
          const prevF = prevFreqRef.current
          if (prevF && prevF.length === f.freq.length) {
            let flux = 0; for (let i = 0; i < f.freq.length; i++) { const d = f.freq[i] - prevF[i]; if (d > 0) flux += d }
            densityEmaRef.current = densityEmaRef.current * 0.9 + Math.min(1, (flux / (f.freq.length * 255)) * 12) * 0.1
          }
          if (!prevF || prevF.length !== f.freq.length) prevFreqRef.current = new Uint8Array(f.freq.length)
          prevFreqRef.current!.set(f.freq)
          if (now - lastDensityUiRef.current > 400) { lastDensityUiRef.current = now; setDensity(densityEmaRef.current) }
          // Spectral balance (bass vs bright) for the on-device "sounds like" read.
          { let low = 0, mid = 0, high = 0
            for (let i = 0; i < f.freq.length; i++) { const v = f.freq[i]; if (i < 24) low += v; else if (i < 160) mid += v; else high += v }
            const spTot = low + mid + high || 1
            bassRatioRef.current = bassRatioRef.current * 0.9 + (low / spTot) * 0.1
            brightRatioRef.current = brightRatioRef.current * 0.9 + (high / spTot) * 0.1 }
          if (bass > bassAvgRef.current * 1.35 && bass > 0.12 && now - lastBeatRef.current > 250) {
            // Onset sharpness — track the typical kick strength so the drum punch auto-gains
            // (soft kicks stay visible, slamming ones don't blow out).
            onsetEmaRef.current = onsetEmaRef.current * 0.9 + punchEnvRef.current * 0.1
            const iv = now - prevBeatRef.current; prevBeatRef.current = now; lastBeatRef.current = now
            beatShiftRef.current++
            // Cut on the beat: hard-switch the clip every Nth kick (a real edit-style cut). No-ops
            // safely if there's nothing queued to cut to.
            if (cutOnBeatRef.current && ++beatCutCountRef.current % Math.max(1, cutEveryRef.current) === 0) requestSwitch()
            // Motion-freeze edit: armed by the Trigger button, fires on the next kick so it lands on-beat.
            if (editRef.current === 'freeze' && freezeArmedRef.current && !freezeRef.current) { freezeRef.current = { t0: performance.now(), frozen: false, box: null }; freezeArmedRef.current = false }
            if (iv > 250 && iv < 2000) {
              // Median of the last 6 intervals: robust to missed/double beats, and re-locks
              // within a few beats when the song (or tempo) changes.
              const b = beatIvBufRef.current; b.push(iv); if (b.length > 6) b.shift()
              const sorted = [...b].sort((x, y) => x - y); const med = sorted[sorted.length >> 1]
              // Fold into a musical range so half/double-time detection reads sanely.
              let v = 60000 / med
              while (v > 175) v /= 2
              while (v < 70) v *= 2
              bpmEmaRef.current = v
              if (now - lastBpmUiRef.current > 350) { lastBpmUiRef.current = now; setBpm(Math.round(v)) }
            }
            // Beat-colour flash on the whole frame (background included) — arm on the kick.
            if (beatColorRef.current) { beatFlashRef.current = 1; const c = optsRef.current.colors; beatFlashColorRef.current = c[beatShiftRef.current % c.length] }
          }
          drawLive(cv, f.freq, f.wave, { ...optsRef.current, beatShift: beatShiftRef.current, density: densityEmaRef.current })
          // Decay + apply the beat flash overlay every frame.
          if (beatFlashDivRef.current) {
            if (beatColorRef.current) {
              beatFlashRef.current *= 0.82
              beatFlashDivRef.current.style.background = beatFlashColorRef.current
              // Dark-room mode softens the flash so nobody gets blinded.
              beatFlashDivRef.current.style.opacity = (beatFlashRef.current * (darkRoomRef.current ? 0.12 : 0.32)).toFixed(3)
            } else if (beatFlashDivRef.current.style.opacity !== '0') beatFlashDivRef.current.style.opacity = '0'
          }
          // Overall loudness off the spectrum — drives both the EQ filter pulse and the
          // rolling "song energy" that picks energy-matched backgrounds.
          let s = 0; for (let i = 0; i < f.freq.length; i++) s += f.freq[i]
          const level = Math.min(1, (s / (f.freq.length * 255)) * optsRef.current.gain)
          // Idle / music detection (gain-independent): note when real audio was last heard; if
          // it's been quiet for a couple seconds, we're between songs → transition mode.
          if (s / (f.freq.length * 255) > 0.02) lastLoudRef.current = now
          const nowIdle = idleTransitionRef.current && now - lastLoudRef.current > 2500
          if (nowIdle !== idleRef.current) { idleRef.current = nowIdle; setIdle(nowIdle); onIdleChangeRef.current(nowIdle) }
          // Smooth it, then auto-calibrate to THIS song's own range: track a slowly-relaxing
          // min & max so the band reflects the song's structure (builds/drops), not absolute
          // loudness — it "improves to match" the longer it listens. Then bucket with hysteresis.
          energyEmaRef.current = energyEmaRef.current * 0.92 + level * 0.08
          const e = energyEmaRef.current
          energyMaxRef.current = Math.max(e, energyMaxRef.current - 0.00003)
          energyMinRef.current = Math.min(e, energyMinRef.current + 0.00003)
          const rel = Math.min(1, Math.max(0, (e - energyMinRef.current) / Math.max(0.04, energyMaxRef.current - energyMinRef.current)))
          // Blend absolute loudness with the song-relative position: loud still reads energetic,
          // and the calibrated dynamics (builds/drops) push it further.
          const score = 0.5 * Math.min(1, e / 0.3) + 0.5 * rel
          const cur = energyBandRef.current
          const band: Energy = score > (cur === 'hot' ? 0.50 : 0.60) ? 'hot' : score > (cur === 'calm' ? 0.35 : 0.28) ? 'mid' : 'calm'
          energyBandRef.current = band
          if (now - lastEnergyUiRef.current > 300) { lastEnergyUiRef.current = now; setEnergyBand(band) }
          // On-device "sounds like" read (free, no API) — updated ~every 1.5s.
          if (now - lastSonicUiRef.current > 1500) {
            lastSonicUiRef.current = now
            const beaty = Math.min(1, (beatIvBufRef.current.length / 6) * 0.6 + Math.min(1, onsetEmaRef.current * 1.2) * 0.4)
            const sc = classifySonic({ bpm: Math.round(bpmEmaRef.current), energy: Math.min(1, e / 0.3), bass: bassRatioRef.current, bright: brightRatioRef.current, density: densityEmaRef.current, beaty }, genrePriorRef.current)
            sonicRef.current = sc; (window as unknown as { __lbSonic?: unknown }).__lbSonic = sc   // background — no UI, for testing/tuning
            // Roll the family into a ~15s vote (10 reads × 1.5s) and take the plurality winner; conf =
            // share of the window that agrees. votedFamily is what Auto actually acts on.
            const votes = familyVotesRef.current
            votes.push(sc.family); if (votes.length > 10) votes.shift()
            const tally = votes.reduce((m, f) => (m[f] = (m[f] || 0) + 1, m), {} as Record<Family, number>)
            const win = (Object.entries(tally) as [Family, number][]).sort((a, b) => b[1] - a[1])[0]
            votedFamilyRef.current = { family: win[0], conf: win[1] / votes.length }
          }
          // AUTO re-fits filters + colours to the genre only when the video changes (see commitHead),
          // so the look doesn't churn mid-clip. Nothing to do here per-frame.
          // Filters interacting with the EQ — brightness/saturation pulse with the overall level,
          // and the sub/bass PUNCH sharpens + brightens + scale-"thumps" (drums).
          const eq = eqRef.current
          if (eq.on && bgFilterRef.current) {
            // Onset sharpness auto-gain: normalize the punch by the song's typical kick so drums
            // are consistently visible whatever the track's dynamics.
            const p = Math.min(1.5, (punchEnvRef.current / Math.max(0.12, onsetEmaRef.current)) * 0.55) * punchAmtRef.current
            const dim = darkRoomRef.current ? 0.45 : 1   // dark room: dampen the brightness pulses
            const bl = eq.blur * (1 - level * 0.4) * (1 - Math.min(1, p) * 0.5)
            const br = eq.brightness * (0.7 + (level * 0.55 + p * 0.55) * dim)
            const sa = eq.saturate * (0.85 + level * 0.55 + p * 0.4)
            const hu = eq.hueRot + level * 45 + p * 18
            bgFilterRef.current.style.filter = `${lookFilterRef.current} blur(${bl.toFixed(1)}px) brightness(${br.toFixed(2)}) saturate(${sa.toFixed(2)}) hue-rotate(${Math.round(hu)}deg)`.trim()
            bgFilterRef.current.style.transform = `scale(${(1 + Math.min(1, p) * 0.035).toFixed(3)})`
          }
        }
        rafRef.current = requestAnimationFrame(draw)
      }
      rafRef.current = requestAnimationFrame(draw)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not access audio.')
      stop()
    }
  }, [stop, resetDetectors])

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

  // Deep-link: open with a chosen background (from the Background Library).
  useEffect(() => {
    if (!initialBg) return
    const c = clipById(initialBg)
    if (c) { setBgClip(c); setBgKind('library'); if (c.category) setBgCat(c.category) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBg])

  // Shared scene link (?scene=...) — decode and apply it on open.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('scene')
    if (!code) return
    const s = sceneDecode(code)
    if (s) { loadScene({ ...s, id: `${Date.now()}` }); setSharedMsg(`Loaded shared scene${s.name ? ` “${s.name}”` : ''} — press Save scene to keep it`); setTimeout(() => setSharedMsg(''), 5000) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply a station's visual look (broadcast mode). Only sets what the station specifies; forces
  // the radio essentials (auto-shuffle + calm-between-songs on, background layer on).
  const applyStationScene = useCallback((sc: StationScene) => {
    setAuto(false)
    if (sc.style) setStyle(sc.style as LiveStyle)
    if (sc.paletteId) setColorCfg(c => ({ ...c, paletteId: sc.paletteId! }))
    if (sc.videoMode) setVideoMode(sc.videoMode)
    if (sc.videoLook) setVideoLook(sc.videoLook)
    if (sc.videoSet) setVideoSet(sc.videoSet as BgCategory[])
    if (sc.brightnessSet) setBrightnessSet(sc.brightnessSet)
    if (sc.speedSet) setSpeedSet(sc.speedSet)
    if (sc.matchEnergy != null) setMatchEnergy(sc.matchEnergy)
    setReactive(sc.reactive ?? true)
    setAutoShuffle(true); setIdleTransition(true); setBgKind('library')
  }, [])

  // Broadcast / radio mode (?station=<slug>&broadcast=1): load the station's scene + playlist and
  // auto-start. If autoplay is blocked (normal browser), we show a tap-to-start overlay; a headless
  // broadcast box launches Chrome with --autoplay-policy=no-user-gesture-required so it just plays.
  const broadcastStartedRef = useRef(false)
  useEffect(() => {
    if (!broadcast || broadcastStartedRef.current) return
    broadcastStartedRef.current = true
    ;(async () => {
      try {
        const r = await fetch(`/api/broadcast/playlist?station=${encodeURIComponent(broadcast)}`)
        if (!r.ok) { setBroadcastMsg('Unknown station.'); return }
        const data = await r.json() as { station?: { scene?: StationScene; shuffle?: boolean }; tracks?: BroadcastTrack[] }
        if (data.station?.scene) applyStationScene(data.station.scene)
        let tracks = data.tracks ?? []
        if (data.station?.shuffle) tracks = [...tracks].sort(() => Math.random() - 0.5)
        broadcastTracksRef.current = tracks
        nextClipRef.current()   // an initial background so visuals show even before/without audio
        if (tracks.length) start('broadcast')
        else setBroadcastMsg(`No tracks yet — drop audio into public/broadcast/${broadcast}/ or set JAMENDO_CLIENT_ID.`)
      } catch { setBroadcastMsg('Couldn’t load this station.') }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast])

  // Tap-to-start fallback: a user gesture resumes the audio context + playback.
  const resumeBroadcast = useCallback(() => {
    setBroadcastMsg(null)
    void audioRef.current?.resume().catch(() => {})
    audioElRef.current?.play().catch(() => {})
  }, [])

  // Drag-and-drop media onto the stage: audio plays into the visualizer, a video/image
  // becomes the background.
  const onDropMedia = useCallback((files: File[]) => {
    const f = files[0]; if (!f) return
    const k = detectMediaKind(f)
    if (k === 'audio') start('file', f)
    else if (k === 'video' || k === 'image') pickBgFile(f)
  }, [start, pickBgFile])
  const { isOver, dropProps } = useMediaDrop(onDropMedia, { accept: ['audio', 'video', 'image'] })

  return (
    <div className={`mv-live${broadcast ? ' mv-broadcast' : ''}`}>
      <style>{`@keyframes mv-amb{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}} .mv-ambient{animation:mv-amb 16s ease-in-out infinite}
@keyframes mv-grain{0%{background-position:0 0}25%{background-position:-6% 5%}50%{background-position:5% -4%}75%{background-position:-4% -6%}100%{background-position:0 0}} .mv-grain{animation:mv-grain .6s steps(3) infinite}
@keyframes mv-beat{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.5);opacity:1}}
@keyframes mv-grid{from{background-position:0 0}to{background-position:0 40px}} .mv-grid{animation:mv-grid 1.1s linear infinite}
@keyframes mv-flicker{0%,100%{opacity:.05}18%{opacity:.14}36%{opacity:.02}52%{opacity:.16}68%{opacity:.05}84%{opacity:.11}} .mv-flicker{animation:mv-flicker .3s steps(2) infinite}
@media (prefers-reduced-motion: reduce){.mv-grid,.mv-flicker,.mv-grain,.mv-ambient{animation:none}}
.mv-live{container-type:inline-size}
.mv-split{display:flex;flex-direction:column}
.mv-stage{position:sticky;top:0;z-index:3;background:var(--bg-base);padding-bottom:12px}
.mv-panels{display:flex;flex-direction:column}
.mv-broadcast{position:fixed;inset:0;background:#000;z-index:60}
.mv-broadcast .mv-panels{display:none}
.mv-broadcast .mv-split{display:block;height:100%}
.mv-broadcast .mv-stage{position:static;height:100dvh;padding:0;background:#000}
.mv-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:12px 0 2px}
.mv-tab{display:inline-flex;align-items:center;height:38px;padding:0 11px;border:1px solid var(--border);border-radius:999px;background:var(--bg-card);color:var(--text-secondary);cursor:pointer;flex:0 0 auto;transition:background .15s,color .15s,border-color .15s}
.mv-tab .mv-tablabel{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;font-size:13px;font-weight:800;margin-left:0;transition:max-width .25s ease,opacity .2s ease,margin-left .25s ease}
.mv-tab:hover{color:var(--text-primary);border-color:var(--text-muted)}
.mv-tab:hover .mv-tablabel,.mv-tab.is-active .mv-tablabel,.mv-tabs.is-open .mv-tablabel{max-width:150px;opacity:1;margin-left:7px}
.mv-tab.is-active{background:var(--accent);color:#0e0d12;border-color:transparent}
.mv-tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mv-tabcollapse{display:none;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid var(--border);border-radius:999px;background:var(--bg-card);color:var(--text-secondary);cursor:pointer;flex:0 0 auto}
@container (min-width:760px){.mv-split{flex-direction:row;align-items:flex-start;gap:20px}.mv-stage{flex:1 1 60%;min-width:0;padding-bottom:4px}.mv-panels{flex:1 1 40%;min-width:280px;max-height:calc(100dvh - 16px);overflow:auto;padding-right:4px}}
@container (max-width:759px){.mv-tabcollapse{display:inline-flex}}`}</style>
      <LookSvgDefs />
      <div className="mv-split">
        <div className="mv-stage">
      <div ref={wrapRef} {...dropProps} style={{ position: 'relative', width: '100%', aspectRatio: (fs || broadcast) ? undefined : '16 / 9', height: (fs || broadcast) ? '100dvh' : undefined, borderRadius: (fs || broadcast) ? 0 : 14, overflow: 'hidden', background: '#08070d', border: (fs || broadcast) ? 'none' : '1px solid var(--border)', outline: isOver ? '3px dashed var(--accent)' : 'none', outlineOffset: -3 }}>
        {isOver && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'grid', placeItems: 'center', background: 'rgba(6,5,10,0.6)', color: '#fff', fontSize: 15, fontWeight: 800, pointerEvents: 'none' }}>Drop audio to visualize · video or image for the background</div>
        )}
        {/* Background layer — ambient gradient, library clip (streamed), or your own upload; filtered here */}
        {hasBg && (
          <div ref={bgFilterRef} style={{ position: 'absolute', inset: 0, filter: bgFilter, isolation: 'isolate', transition: 'opacity .5s ease' }}>
            {bgKind === 'media' ? (
              bgVideo
                ? <video key={(bgUrl ?? '') + (edit !== 'none' ? '-x' : '')} src={bgUrl ?? undefined} crossOrigin={edit !== 'none' ? 'anonymous' : undefined} autoPlay loop muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={bgUrl ?? undefined} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : bgKind === 'library' && bgClip ? (
              <>
                {/* tint fallback shows offline or until the asset loads */}
                <div style={{ position: 'absolute', inset: 0, backgroundImage: bgClip.tint, backgroundSize: 'cover' }} />
                {bgClip.kind === 'image' ? (
                  <img key={bgClip.id + (bgSrcOverride ? '-off' : '')} src={bgSrcOverride ?? bgClip.src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <>
                    <img src={bgClip.preview} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    <video ref={bgVideoRef} key={bgClip.id + (bgSrcOverride ? '-off' : '') + (edit !== 'none' ? '-x' : '')} src={bgSrcOverride ?? bgClip.src} crossOrigin={edit !== 'none' ? 'anonymous' : undefined} poster={bgClip.preview} autoPlay loop={!autoShuffle || idle} muted playsInline
                      onCanPlay={() => { if (bgClip) readySrcsRef.current.add(bgClip.src) }}
                      onEnded={() => { if (!autoShuffle) return; if (!requestSwitch() && bgVideoRef.current) { bgVideoRef.current.currentTime = 0; bgVideoRef.current.play().catch(() => {}) } }}   // next not buffered yet → replay current (stay smooth) until it is
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={() => { if (!autoShuffle) return; const now = performance.now(); if (now - lastErrSwitchRef.current < 1500) return; lastErrSwitchRef.current = now; nextClip() }} />
                  </>
                )}
              </>
            ) : (
              <div className="mv-ambient" style={{ position: 'absolute', inset: 0, backgroundImage: ambient?.css, backgroundSize: '240% 240%' }} />
            )}
            {/* Palette match — tint the background toward the visualizer colours */}
            {matchVisuals && <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(120deg, ${colors.join(', ')})`, mixBlendMode: 'overlay', opacity: 0.5, pointerEvents: 'none' }} />}
            {/* Mode + look overlays (vignette / grain / scanlines / duotone / halftone) */}
            <LookOverlays keys={activeOverlays} />
          </div>
        )}

        {/* Hidden preloaders — buffer the next 2 queued clips so switches are instant. A 1px
            offscreen (not display:none) node so browsers actually fetch it; muted, no autoplay.
            When one becomes playable we mark it ready and, if a switch is waiting on it, cut now. */}
        {autoShuffle && preloadSrcs.map(src => (
          // crossOrigin must match the main video's, or the cached response won't be CORS-usable there.
          <video key={src + (edit !== 'none' ? '-x' : '')} src={src} crossOrigin={edit !== 'none' ? 'anonymous' : undefined} preload="auto" muted playsInline aria-hidden
            onCanPlay={() => { readySrcsRef.current.add(src); if (wantSwitchRef.current) requestSwitch() }}
            onCanPlayThrough={() => { readySrcsRef.current.add(src); if (wantSwitchRef.current) requestSwitch() }}
            style={{ position: 'absolute', width: 1, height: 1, top: 0, left: 0, opacity: 0, pointerEvents: 'none' }} />
        ))}

        {/* Edits FX layer — region-targeted effects (motion/object) paint here, over the video. */}
        <canvas ref={fxCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', display: (edit === 'none' && !detector) ? 'none' : 'block' }} />
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: reactive ? 'block' : 'none' }} />
        {/* Beat-colour flash — pulses the whole frame (background included) on each kick. */}
        <div ref={beatFlashDivRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'screen', opacity: 0 }} />

        {!broadcast && reactive && !running && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', gap: 12, padding: 24, textAlign: 'center', background: hasBg ? 'rgba(6,5,10,0.45)' : 'transparent' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Visualize your music</p>
            {/* Auto — the casual-user hero on the start screen: flip it on, then just press play. */}
            <button type="button" onClick={toggleAuto} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 999, cursor: 'pointer', border: auto ? 'none' : '1px solid var(--accent)', background: auto ? 'var(--accent)' : 'transparent', color: auto ? '#0e0d12' : 'var(--accent)', fontSize: 13.5, fontWeight: 850 }}>
              <Sparkles size={15} /> {auto ? 'Auto is on — just press play' : 'Auto — read the music & do it all'}
            </button>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" onClick={() => trackInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 22px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 15, fontWeight: 850, cursor: 'pointer' }}><Play size={17} fill="#0e0d12" /> Play a track</button>
              <button type="button" onClick={() => start('mic')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 15, fontWeight: 750, cursor: 'pointer' }}><Mic size={17} /> Use microphone</button>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, maxWidth: 360, lineHeight: 1.5 }}>Play a track through the app for perfect sync — no prompts, no mic. Or point the mic at the speaker to visualize whatever’s in the room.</p>
            <button type="button" onClick={() => start('device')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}><Radio size={14} /> Capture system audio (desktop)</button>
          </div>
        )}
        <input ref={trackInputRef} type="file" accept="audio/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) start('file', f); e.currentTarget.value = '' }} />
        {!reactive && (
          <div style={{ position: 'absolute', left: 12, bottom: 12, padding: '5px 10px', borderRadius: 999, background: 'rgba(0,0,0,0.4)', color: '#fff', fontSize: 12, fontWeight: 700 }}>Background only</div>
        )}
        {(running || !reactive) && !broadcast && (
          <button type="button" onClick={toggleFs} aria-label="Fullscreen" style={{ position: 'absolute', top: 10, right: 10, display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}><Maximize2 size={17} /></button>
        )}
        {/* Broadcast: now-playing card (carries attribution for the description) */}
        {broadcast && nowPlaying && (
          <div style={{ position: 'absolute', left: 16, bottom: 16, maxWidth: '72%', padding: '8px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.5)', color: '#fff', pointerEvents: 'none' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>Now playing{nowPlaying.genre ? ` · ${nowPlaying.genre}` : ''}</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{nowPlaying.title}{nowPlaying.artist ? ` — ${nowPlaying.artist}` : ''}</div>
            {nowPlaying.attribution && <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 2 }}>{nowPlaying.attribution}</div>}
          </div>
        )}
        {/* Broadcast: tap-to-start (autoplay blocked) / status overlay */}
        {broadcast && broadcastMsg && (
          <button type="button" onClick={resumeBroadcast} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', gap: 14, background: 'rgba(6,5,10,0.78)', border: 'none', color: '#fff', cursor: 'pointer', zIndex: 6 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 74, height: 74, borderRadius: 999, background: 'var(--accent)', color: '#0e0d12' }}><Play size={34} /></span>
            <span style={{ fontSize: 16, fontWeight: 800, maxWidth: 440, textAlign: 'center', lineHeight: 1.4, padding: '0 20px' }}>{broadcastMsg}</span>
          </button>
        )}
        {/* The on-device "sounds like" read runs in the background (window.__lbSonic) — no chip. */}
        {/* Detector readout — what the program thinks it's seeing (objects) + hearing (genre/tone). */}
        {detector && (
          <div style={{ position: 'absolute', left: 12, top: 12, maxWidth: '78%', padding: '10px 13px', borderRadius: 12, background: 'rgba(0,0,0,0.62)', color: '#fff', pointerEvents: 'none', backdropFilter: 'blur(4px)' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}><Scan size={12} /> Detector</div>
            <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}><Crosshair size={12} style={{ opacity: 0.8 }} /> Objects: {modelState === 'ready' ? 'boxing people · cars · animals' : modelState === 'loading' ? 'loading detector…' : modelState === 'error' ? 'detector failed to load' : 'starting…'}{modelState === 'ready' && !hasBg ? ' (add a video background)' : ''}</div>
            <div style={{ fontSize: 12.5, marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={12} style={{ opacity: 0.8 }} /> Genre read: {sonicView ? <><strong>{sonicView.family}</strong> · {Math.round(sonicView.confidence * 100)}% confident</> : running ? 'listening…' : 'play audio to read'}</div>
            {sonicView && <div style={{ fontSize: 11, opacity: 0.78, marginTop: 2, marginLeft: 18 }}>{sonicView.profile}</div>}
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 6, lineHeight: 1.4 }}>All on-device. The genre is a rough sound-based guess (often low-confidence) — it nudges Auto’s grade &amp; palette, so a wrong read is why visuals can miss the tone.</div>
          </div>
        )}
        {/* Song ID — the recognized track (+ a BPM accuracy check vs the DSP) */}
        {identify && !broadcast && recognized && (
          <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', alignItems: 'center', gap: 10, maxWidth: '80%', padding: '8px 12px 8px 8px', borderRadius: 12, background: 'rgba(0,0,0,0.55)', color: '#fff', pointerEvents: 'none' }}>
            {recognized.artwork && <img src={recognized.artwork} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>Now playing{recognized.genre ? ` · ${recognized.genre}` : ''}</div>
              <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{recognized.title}{recognized.artist ? ` — ${recognized.artist}` : ''}</div>
              {recognized.features && running && bpm > 0 && (
                <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 1 }}>Track {recognized.features.tempo} BPM · detected {bpm} {Math.abs(recognized.features.tempo - bpm) <= 3 || Math.abs(recognized.features.tempo - bpm * 2) <= 4 || Math.abs(recognized.features.tempo - bpm / 2) <= 3 ? '✓' : '≈'}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {!broadcast && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 4px', flexWrap: 'wrap' }}>
        {running
          ? <button type="button" onClick={stop} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><Square size={15} /> Stop</button>
          : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not listening</span>}
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{source === 'file' ? 'Playing your track' : source === 'device' ? 'Capturing device audio' : source === 'mic' ? 'Listening to the room' : ''}</span>
        {AUDD_ENABLED && (
        <button type="button" onClick={() => { setIdentify(v => !v); if (identify) setRecognized(null) }} title="Passively recognize the song that's playing (AudD) and show its name"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: identify ? 'var(--accent)' : 'transparent', color: identify ? '#0e0d12' : 'var(--text-secondary)' }}>
          <Radio size={14} /> Song ID{identify ? ' · on' : ''}
        </button>
        )}
        {/* Detector — diagnostic: box detected people/cars/animals + show the live genre/tone read. */}
        <button type="button" onClick={() => setDetector(v => !v)} title="Diagnostic: box people / cars / animals it detects, and show the live genre &amp; tone read"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: detector ? 'var(--accent)' : 'transparent', color: detector ? '#0e0d12' : 'var(--text-secondary)' }}>
          <Scan size={14} /> Detector{detector ? ' · on' : ''}
        </button>
        <button type="button" onClick={() => { stop(); onExit() }} style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Exit live</button>
      </div>
      )}
      {!broadcast && idMsg && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>{idMsg}</p>}
        </div>{/* /mv-stage */}

        <div className="mv-panels">
      {/* AUTO — the one-tap button. Casual users press this and just play music. */}
      <button type="button" onClick={toggleAuto}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 16px', marginBottom: 12, borderRadius: 14, cursor: 'pointer', textAlign: 'left', border: auto ? 'none' : '1px solid var(--border)', background: auto ? 'var(--accent)' : 'var(--bg-card)', color: auto ? '#0e0d12' : 'var(--text-primary)' }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: auto ? 'rgba(0,0,0,0.15)' : 'var(--accent)', color: auto ? '#0e0d12' : '#0e0d12' }}><Sparkles size={18} /></span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 850 }}>{auto ? 'Auto — on' : 'Auto'}</span>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, opacity: 0.85 }}>{auto ? 'Reading the music and deciding it all for you' + (running ? ` · ${energyBand}` : '') : 'One tap — just play music and it looks great'}</span>
        </span>
      </button>

      {/* Scenes — save your whole setup (look + filters + reactivity + video set), reload, set a
          default that opens with the app, rename, and share via a link. */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={saveScene} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}><Save size={13} /> Save scene</button>
          {scenes.map(s => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 5px 3px 11px', borderRadius: 999, border: s.isDefault ? '1px solid var(--accent)' : '1px solid var(--border)', background: 'var(--bg-base)', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
              <button type="button" onClick={() => loadScene(s)} title="Load this scene" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 700 }}>{s.name}</button>
              <button type="button" onClick={() => setDefaultScene(s.id)} title={s.isDefault ? 'Default — opens with the app' : 'Set as default'} style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 999, background: 'transparent', border: 'none', color: s.isDefault ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }}><Star size={12} fill={s.isDefault ? 'currentColor' : 'none'} /></button>
              <button type="button" onClick={() => shareScene(s)} title="Copy a share link" style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 999, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Link2 size={12} /></button>
              <button type="button" onClick={() => renameScene(s.id)} aria-label="Rename scene" style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 999, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Pencil size={11} /></button>
              <button type="button" onClick={() => deleteScene(s.id)} aria-label="Delete scene" style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 999, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={12} /></button>
            </span>
          ))}
          {scenes.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Save your style, colours, filters &amp; video set to reuse, set a default, or share it.</span>}
        </div>
        {sharedMsg && <p style={{ fontSize: 11.5, color: 'var(--accent)', margin: '8px 0 0', fontWeight: 700 }}>{sharedMsg}</p>}
      </div>

      {/* Section tabs — compact symbols that expand to their name on hover (desktop) or via the
          collapse toggle (mobile). The selected section shows a title header below. */}
      <div className={`mv-tabs${tabsOpen ? ' is-open' : ''}`} role="tablist">
        <button type="button" className="mv-tabcollapse" onClick={() => setTabsOpen(o => !o)} aria-label={tabsOpen ? 'Collapse to symbols' : 'Show section names'} aria-expanded={tabsOpen}>{tabsOpen ? <ChevronLeft size={16} /> : <Menu size={16} />}</button>
        {SECTIONS.map(s => (
          <button key={s.id} type="button" role="tab" aria-selected={openPanel === s.id} title={s.label}
            className={`mv-tab${openPanel === s.id ? ' is-active' : ''}`}
            onClick={() => setOpenPanel(p => (p === s.id ? null : s.id))}>
            <s.Icon size={16} />
            <span className="mv-tablabel">{s.label}</span>
          </button>
        ))}
      </div>

      {openPanel === 'look' && (
      <TabSection title="Genre look">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {GENRE_LOOKS.map(l => (
            <button key={l.id} type="button" onClick={() => applyLook(l)} title={l.desc}
              style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: activeLook?.id === l.id ? 'var(--accent)' : 'var(--bg-card)', color: activeLook?.id === l.id ? '#0e0d12' : 'var(--text-secondary)' }}>{l.name}</button>
          ))}
        </div>
        {activeLook && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '9px 0 0' }}>
            {activeLook.desc} · a random on-theme background.{' '}
            <button type="button" onClick={() => shuffleTo(activeLook)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Shuffle background</button>
          </p>
        )}
      </TabSection>)}

      {openPanel === 'visualizer' && (
      <TabSection title="Visualizer">
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '0 0 9px' }}>Style</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {(['none', 'bars', 'area', 'rings', 'dots', 'radial', 'wave'] as LiveStyle[]).map(s => (
            <button key={s} type="button" onClick={() => setStyle(s)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: style === s ? 'var(--accent)' : 'var(--bg-card)', color: style === s ? '#0e0d12' : 'var(--text-secondary)' }}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        {style === 'none' && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
            Just the background — no bars or shapes over it. The music can still react to it: in the <strong style={{ color: 'var(--text-secondary)' }}>Background</strong> panel keep <strong style={{ color: 'var(--text-secondary)' }}>React to the music</strong> on to pulse the filters, and <strong style={{ color: 'var(--text-secondary)' }}>Match my palette</strong> to tint it with your colours.
          </p>
        )}
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '20px 0 12px', paddingTop: 14, borderTop: '1px solid var(--border)' }}>Colour</p>
        {/* Palettes */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {PALETTES.map(p => {
            const active = colorCfg.paletteId === p.id
            return (
              <button key={p.id} type="button" title={p.name} aria-label={p.name}
                onClick={() => { userPaletteRef.current = true; setColorCfg(c => ({ ...c, paletteId: p.id, plane: null })) }}
                style={{ width: 54, height: 26, borderRadius: 8, background: `linear-gradient(90deg, ${p.colors.join(', ')})`, border: active ? '2px solid #fff' : '2px solid var(--border)', cursor: 'pointer', padding: 0 }} />
            )
          })}
        </div>

        {/* Colour map — drag a rectangle to pick a hue band + lightness */}
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 7px' }}>Or drag a spectrum off the colour map:</p>
        <ColorPlane onChange={p => { userPaletteRef.current = true; setColorCfg(c => ({ ...c, plane: p, paletteId: null })) }} />
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

        {/* Beat-synced colour */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '14px 0 0' }}>
          <button type="button" onClick={() => setBeatColor(v => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: beatColor ? 'var(--accent)' : 'var(--bg-card)', color: beatColor ? '#0e0d12' : 'var(--text-secondary)' }}>
            <Activity size={13} /> Colour on the beat
          </button>
          {running && bpm > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent)', animation: 'mv-beat 0.5s ease-in-out infinite' }} /> {bpm} BPM
            </span>
          )}
        </div>
        {beatColor && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>The palette steps forward on every kick and the whole frame flashes with it — so the background pulses to the beat even in the None style. Genre looks turn this on for the beat-driven genres.</p>}

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
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '20px 0 12px', paddingTop: 14, borderTop: '1px solid var(--border)' }}>Feel</p>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" onClick={() => setMirror(v => !v)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: mirror ? 'var(--accent)' : 'var(--bg-card)', color: mirror ? '#0e0d12' : 'var(--text-secondary)' }}>Mirror</button>
          <button type="button" onClick={() => setGlow(v => !v)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: glow ? 'var(--accent)' : 'var(--bg-card)', color: glow ? '#0e0d12' : 'var(--text-secondary)' }}>Glow</button>
          <button type="button" onClick={() => setTrail(v => !v)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: trail ? 'var(--accent)' : 'var(--bg-card)', color: trail ? '#0e0d12' : 'var(--text-secondary)' }}>Trails</button>
        </div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>Sensitivity</label>
        <input type="range" min={0.5} max={2.6} step={0.1} value={gain} onChange={e => setGain(parseFloat(e.target.value))} style={{ width: '100%', maxWidth: 320 }} />
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 5px' }}>Smoothness</label>
        <input type="range" min={0} max={0.95} step={0.01} value={smoothing} onChange={e => setSmoothing(parseFloat(e.target.value))} style={{ width: '100%', maxWidth: 320 }} />
      </TabSection>)}

      {openPanel === 'edits' && (
      <TabSection title="Edits — effects that target what's on screen">
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>These change only the <strong style={{ color: 'var(--text-secondary)' }}>thing the program detects</strong> — the moving subject, or a person / car / animal — not the whole frame. They read the video pixels, so they work on a <strong style={{ color: 'var(--text-secondary)' }}>video background</strong> (library clips or your upload), not stills.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {EDITS.map(e => (
            <button key={e.id} type="button" onClick={() => setEdit(e.id)} title={e.desc}
              style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: edit === e.id ? 'var(--accent)' : 'var(--bg-card)', color: edit === e.id ? '#0e0d12' : 'var(--text-secondary)' }}>
              {e.kind === 'object' && <Crosshair size={12} style={{ marginRight: 5, verticalAlign: '-1px' }} />}{e.name}
            </button>
          ))}
        </div>
        {edit !== 'none' && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '10px 0 0' }}>{EDITS.find(e => e.id === edit)?.desc}</p>}
        {edit === 'freeze' && (
          <button type="button" onClick={() => { freezeArmedRef.current = true }} style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#0e0d12' }}>
            <Activity size={14} /> Trigger freeze (fires on the next beat)
          </button>
        )}
        {EDITS.find(e => e.id === edit)?.kind === 'object' && (
          <p style={{ fontSize: 11.5, margin: '10px 0 0', color: modelState === 'error' ? '#f87171' : 'var(--text-muted)' }}>
            {modelState === 'loading' ? 'Loading the on-device detector (one-time, ~a few MB)…' : modelState === 'ready' ? '● Detector ready — runs entirely on your device.' : modelState === 'error' ? 'Couldn’t load the detector.' : ''}
          </p>
        )}
      </TabSection>)}

      {openPanel === 'bg' && (
      <TabSection title="Background & video set">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 6 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={reactive} onChange={e => setReactive(e.target.checked)} /> React to the music
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={matchVisuals} onChange={e => setMatchVisuals(e.target.checked)} /> Match my palette
          </label>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>One switch for all reactivity — the visualizer AND the background filters/drum-punch move with the audio. Off = a still background. Match tints the background toward your visualizer colours.</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={() => setBgKind('none')} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: bgKind === 'none' ? 'var(--accent)' : 'var(--bg-card)', color: bgKind === 'none' ? '#0e0d12' : 'var(--text-secondary)' }}>None</button>
          {AMBIENTS.map(a => (
            <button key={a.id} type="button" onClick={() => setBgKind(a.id)} title={a.name} aria-label={a.name}
              style={{ width: 54, height: 26, borderRadius: 8, backgroundImage: a.css, backgroundSize: '160% 160%', border: bgKind === a.id ? '2px solid #fff' : '2px solid var(--border)', cursor: 'pointer', padding: 0 }} />
          ))}
          <button type="button" onClick={() => bgInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: bgKind === 'media' ? 'var(--accent)' : 'var(--bg-card)', color: bgKind === 'media' ? '#0e0d12' : 'var(--text-secondary)' }}><Upload size={13} /> Upload</button>
          <input ref={bgInputRef} type="file" accept="video/*,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) pickBgFile(f); e.currentTarget.value = '' }} />
        </div>

        {/* Auto-shuffle — play a clip, then move to the next one automatically */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '18px 0 4px' }}>
          <button type="button" onClick={() => { setAutoShuffle(v => !v); if (!autoShuffle) nextClip() }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: autoShuffle ? 'var(--accent)' : 'var(--bg-card)', color: autoShuffle ? '#0e0d12' : 'var(--text-secondary)' }}>
            <Shuffle size={14} /> Auto-shuffle clips
          </button>
          {autoShuffle && <button type="button" onClick={nextClip} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}><SkipForward size={13} /> Next</button>}
          {/* Cut on beat — hard-cut clips on the music (an edit, not a slow shuffle). */}
          <button type="button" onClick={() => { setCutOnBeat(v => { const nv = !v; if (nv) { setAutoShuffle(true); setBgKind('library'); beatCutCountRef.current = 0 } return nv }) }}
            title="Hard-cut to a new clip on the beat, like a real edit"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: cutOnBeat ? 'var(--accent)' : 'var(--bg-card)', color: cutOnBeat ? '#0e0d12' : 'var(--text-secondary)' }}>
            <Activity size={14} /> Cut on beat
          </button>
        </div>
        {cutOnBeat && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Cut every</span>
            {[4, 8, 16].map(n => (
              <button key={n} type="button" onClick={() => setCutEvery(n)}
                style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: cutEvery === n ? 'var(--accent)' : 'var(--bg-card)', color: cutEvery === n ? '#0e0d12' : 'var(--text-secondary)' }}>{n === 4 ? '1 bar' : n === 8 ? '2 bars' : '4 bars'}</button>
            ))}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· cuts land on downbeats{bpm ? ` · ~${bpm} BPM` : ''}</span>
          </div>
        )}
        {autoShuffle && (
          <div style={{ margin: '6px 0 4px' }}>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 6px' }}>Shuffle from — pick the categories for your set, or leave all off for everything:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BG_CATEGORIES.map(cat => {
                const on = videoSet.includes(cat)
                return (
                  <button key={cat} type="button" onClick={() => setVideoSet(v => v.includes(cat) ? v.filter(c => c !== cat) : [...v, cat])}
                    style={{ padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--bg-card)', color: on ? '#0e0d12' : 'var(--text-secondary)' }}>{cat}</button>
                )
              })}
              {videoSet.length > 0 && <button type="button" onClick={() => setVideoSet([])} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>Clear ({videoSet.length})</button>}
            </div>
          </div>
        )}
        {autoShuffle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '2px 0 4px' }}>
            <button type="button" onClick={() => setMatchEnergy(v => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: matchEnergy ? 'var(--accent)' : 'var(--bg-card)', color: matchEnergy ? '#0e0d12' : 'var(--text-secondary)' }}>
              <Activity size={13} /> Match song energy
            </button>
            {matchEnergy && running && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                Now: <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, textTransform: 'capitalize', color: '#0e0d12', background: energyBand === 'hot' ? '#f87171' : energyBand === 'mid' ? '#fbbf24' : '#34d399' }}>{energyBand}</span>
                <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, color: '#0e0d12', background: '#a78bfa' }}>{density > 0.5 ? 'busy' : density > 0.22 ? 'flowing' : 'sparse'}</span>
              </span>
            )}
          </div>
        )}
        {autoShuffle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '2px 0 4px' }}>
            <button type="button" onClick={() => setIdleTransition(v => !v)}
              title="Between songs, drift through calm low-movement clips and barely switch — resumes the moment music is detected"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: idleTransition ? 'var(--accent)' : 'var(--bg-card)', color: idleTransition ? '#0e0d12' : 'var(--text-secondary)' }}>
              <Coffee size={13} /> Calm between songs
            </button>
            {idleTransition && idle && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: '#0e0d12', background: '#34d399', padding: '3px 10px', borderRadius: 999 }}>
                <Turtle size={12} /> {running ? 'Waiting for music — transition mode' : 'Transition mode'}
              </span>
            )}
          </div>
        )}
        {autoShuffle && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 6px' }}>{matchEnergy ? 'Reads the song’s energy off the EQ and pulls matching scenes — calm songs get slow, mellow backgrounds; loud, busy songs get fast, bright ones. When a beat is detected it rolls each bar whether to cut.' : 'A new clip comes on automatically — each bar there’s a chance to cut (set below), otherwise on a timer. Like a living wallpaper; great full-screen on a TV.'}</p>}
        {autoShuffle && (
          <div style={{ margin: '4px 0 6px' }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Switch chance — {Math.round(switchChance * 100)}% per bar</label>
            <input type="range" min={0} max={1} step={0.05} value={switchChance} onChange={e => setSwitchChance(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>A “bar” = 4 beats of the detected tempo{running && bpm > 0 ? ` (~${(4 * 60 / bpm).toFixed(1)}s at ${bpm} BPM)` : ' (≈4s until a beat is found)'}. Each bar it rolls this chance to cut. The clip always changes when it finishes, so 0% = only when the video ends.</p>
          </div>
        )}

        {/* Brightness filter — one control governs BOTH the auto-shuffle pool and the grid
            below. Pick "Dark" and a dark room never gets flash-banged. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '16px 0 6px' }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-secondary)', marginRight: 2 }}>Brightness</span>
          {(['dark', 'mid', 'bright'] as Brightness[]).map(b => {
            const on = brightnessSet.includes(b)
            const Icon = b === 'dark' ? Moon : b === 'bright' ? Sun : Circle
            return (
              <button key={b} type="button" onClick={() => setBrightnessSet(v => v.includes(b) ? v.filter(x => x !== b) : [...v, b])}
                title={b === 'dark' ? 'Dim scenes — safe for a dark room' : b === 'bright' ? 'Bright, high-energy scenes' : 'Medium brightness'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--bg-card)', color: on ? '#0e0d12' : 'var(--text-secondary)' }}>
                <Icon size={12} /> {BRIGHTNESS_LABEL[b]}
              </button>
            )
          })}
          {brightnessSet.length > 0
            ? <button type="button" onClick={() => setBrightnessSet([])} style={{ padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>All</button>
            : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· all brightnesses</span>}
        </div>
        {brightnessSet.length > 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 6px' }}>{brightnessSet.includes('dark') && brightnessSet.length === 1 ? 'Dark-room mode — only dim scenes play, so nobody gets flash-banged (the beat-flash softens too).' : `Showing ${brightnessSet.map(b => BRIGHTNESS_LABEL[b].toLowerCase()).join(' + ')} scenes only — applies to shuffle and the picker below.`}</p>}

        {/* Speed / motion filter — same deal, governs shuffle + the grid. Slow = calm, low-movement. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '2px 0 6px' }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-secondary)', marginRight: 2 }}>Speed</span>
          {(['slow', 'standard', 'fast'] as Speed[]).map(sp => {
            const on = speedSet.includes(sp)
            const Icon = sp === 'slow' ? Turtle : sp === 'fast' ? Rabbit : Gauge
            return (
              <button key={sp} type="button" onClick={() => setSpeedSet(v => v.includes(sp) ? v.filter(x => x !== sp) : [...v, sp])}
                title={sp === 'slow' ? 'Calm, low-movement scenes' : sp === 'fast' ? 'High-movement, energetic scenes' : 'Medium movement'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--bg-card)', color: on ? '#0e0d12' : 'var(--text-secondary)' }}>
                <Icon size={12} /> {SPEED_LABEL[sp]}
              </button>
            )
          })}
          {speedSet.length > 0
            ? <button type="button" onClick={() => setSpeedSet([])} style={{ padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>All</button>
            : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· any speed</span>}
        </div>

        {/* Search the tagged Pexels catalog — thousands of streaming backgrounds, nothing downloaded */}
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '14px 0 6px' }}>Backgrounds — search or tap a tag ({(15000).toLocaleString()}+ clips){brightnessSet.length === 1 ? ` · ${BRIGHTNESS_LABEL[brightnessSet[0]]} only` : ''}:</p>
        <form onSubmit={e => { e.preventDefault(); searchPexels() }} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input value={pexQuery} onChange={e => setPexQuery(e.target.value)} placeholder="e.g. neon, ink in water, forest…" style={{ flex: 1, minWidth: 0, padding: '8px 11px', borderRadius: 9, fontSize: 13, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          <button type="submit" disabled={pexLoading} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#0e0d12', opacity: pexLoading ? 0.6 : 1 }}><Search size={14} /> {pexLoading ? '…' : 'Search'}</button>
        </form>
        {/* Tag filters — one tap searches the whole catalogue by that tag. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {POPULAR_TAGS.map(tag => {
            const on = pexQuery.trim().toLowerCase() === tag
            return (
              <button key={tag} type="button" onClick={() => { const nq = on ? '' : tag; setPexQuery(nq); searchPexels(false, nq) }}
                style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--bg-card)', color: on ? '#0e0d12' : 'var(--text-secondary)' }}>{tag}</button>
            )
          })}
        </div>
        {pexSearched && (
          pexResults.length ? (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginBottom: 8 }}>
              {pexResults.map(r => {
                const active = bgKind === 'library' && bgClip?.id === r.id
                const clip: BgClip = { id: r.id, category: (r.category as BgCategory), title: r.title, kind: 'video', preview: r.poster, src: r.mp4, tint: 'linear-gradient(135deg,#1e1b4b,#0b1020)', brightness: r.brightness }
                return (
                  <button key={r.id} type="button" onClick={() => { setBgClip(clip); setBgKind('library') }}
                    onMouseEnter={() => setPexHover(r.id)} onMouseLeave={() => setPexHover(h => (h === r.id ? null : h))}
                    title={`${r.title} · ${BRIGHTNESS_LABEL[r.brightness]} · Pexels/${r.author}`}
                    style={{ position: 'relative', aspectRatio: '16 / 10', borderRadius: 9, overflow: 'hidden', padding: 0, cursor: 'pointer', border: active ? '2px solid var(--accent)' : '1px solid var(--border)', background: '#08070d' }}>
                    <img src={r.poster} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    {/* Lazy preview: the video is only loaded/played while hovered. */}
                    {pexHover === r.id && <video src={r.mp4} autoPlay muted loop playsInline preload="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                    <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '3px 5px', fontSize: 9.5, fontWeight: 700, color: '#fff', background: 'linear-gradient(0deg, rgba(0,0,0,0.7), transparent)', textAlign: 'left' }}>{r.title}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {pexMore && <button type="button" onClick={() => searchPexels(true)} disabled={pexLoading} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', opacity: pexLoading ? 0.6 : 1 }}>{pexLoading ? 'Loading…' : 'Load more'}</button>}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pexResults.length} shown{pexMore ? '' : ' · end'} · hover a tile to preview</span>
            </div>
            </>
          ) : !pexLoading && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>No tagged matches yet. Add more in the admin (Fetch from Pexels), then search again.</p>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0' }}>Backgrounds stream from the cloud; a low-res preview is cached for offline. Or upload your own.</p>

        {/* Offline: save the selected background to the device */}
        {bgKind === 'library' && bgClip && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{bgClip.title}:</span>
            {savedCurrent ? (
              <button type="button" onClick={removeBgOffline} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)', color: '#34d399' }}><Check size={13} /> Saved offline · remove</button>
            ) : (
              <button type="button" onClick={saveBgOffline} disabled={savingBg} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', opacity: savingBg ? 0.6 : 1 }}><DownloadCloud size={13} /> {savingBg ? 'Saving…' : 'Save for offline'}</button>
            )}
            <button type="button" onClick={downloadBg} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}><Download size={13} /> Download</button>
            {bgMsg && <span style={{ flexBasis: '100%', fontSize: 11, color: '#f87171', lineHeight: 1.5 }}>{bgMsg}</span>}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>Saved backgrounds play with no connection. Bundled images already work offline once viewed.</p>

        {hasBg && (
        <div style={{ paddingTop: 14, marginTop: 18, borderTop: '1px solid var(--border)' }}>
          {/* Advanced settings — the granular mode/grade/filter controls live here so the everyday
              surface stays simple. Auto sets all of this for you; open this to do it by hand. */}
          <button type="button" onClick={() => setAdvOpen(o => !o)} aria-expanded={advOpen}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <SlidersHorizontal size={14} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Advanced settings</span>
            <ChevronLeft size={15} style={{ marginLeft: 'auto', color: 'var(--text-muted)', transform: advOpen ? 'rotate(-90deg)' : 'rotate(-90deg) scaleX(-1)', transition: 'transform .15s' }} />
          </button>
          {!advOpen && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0' }}>Auto fits the mode, grade &amp; filters to the music. Open this to set the film look and filters yourself.</p>}
          {advOpen && (
          <div style={{ marginTop: 14 }}>
          {/* MODE — dramatic live transform of the whole frame */}
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 7px' }}>Mode — transform the whole look</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 6 }}>
            {VIDEO_MODES.map(m => (
              <button key={m.id} type="button" onClick={() => setVideoMode(m.id)}
                style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: videoMode === m.id ? 'var(--accent)' : 'var(--bg-card)', color: videoMode === m.id ? '#0e0d12' : 'var(--text-secondary)' }}>{m.name}</button>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 16px' }}>Anime cel-shades with ink outlines, Comic adds halftone, Ink/Oil restyle the paint, Thermal/Infrared recolour, Glitch &amp; Neon edge go electric. Applies live over any background.</p>

          {/* LOOK — subtle grade layered underneath the mode */}
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 7px' }}>Look — grade</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 8 }}>
            {VIDEO_LOOKS.map(l => (
              <button key={l.id} type="button" onClick={() => setVideoLook(l.id)}
                style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: videoLook === l.id ? 'var(--accent)' : 'var(--bg-card)', color: videoLook === l.id ? '#0e0d12' : 'var(--text-secondary)' }}>{l.name}</button>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>A grade stacks under the mode and the sliders below — Film/Noir add grain &amp; vignette, Warm/Cool shift temperature, and the cinematic grades: Blockbuster (teal-orange), Neon-noir, Bleach (gritty), Giallo (lurid reds), Lean (purple).</p>
          {reactive && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>These filters react to the music (turned on by <strong style={{ color: 'var(--text-secondary)' }}>React to the music</strong> in Background): brightness &amp; saturation pulse, and the sub/bass kick punches the background — a quick brighten, sharpen and scale-thump so drums pop. The sliders set the baseline.</p>}
          {!reactive && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>Turn on <strong style={{ color: 'var(--text-secondary)' }}>React to the music</strong> in Background to make these filters move with the audio; otherwise the sliders are a static grade.</p>}
          {reactive && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Drum punch — {Math.round(punchAmt * 100)}%</label>
              <input type="range" min={0} max={2} step={0.1} value={punchAmt} onChange={e => setPunchAmt(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
            </div>
          )}
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Blur — {blur}px</label>
          <input type="range" min={0} max={24} step={1} value={blur} onChange={e => setBlur(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 4px' }}>Brightness</label>
          <input type="range" min={0.3} max={1.6} step={0.05} value={brightness} onChange={e => setBrightness(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 4px' }}>Saturation</label>
          <input type="range" min={0} max={2.2} step={0.05} value={saturate} onChange={e => setSaturate(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 4px' }}>Hue shift — {hueRot}°</label>
          <input type="range" min={0} max={360} step={5} value={hueRot} onChange={e => setHueRot(+e.target.value)} style={{ width: '100%', maxWidth: 320 }} />
          <button type="button" onClick={() => { setBlur(0); setBrightness(1); setSaturate(1); setHueRot(0) }} style={{ marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reset filters</button>
          </div>
          )}
        </div>
        )}
      </TabSection>)}

      {openPanel === 'sync' && (
      <TabSection title={`Sync delay — ${delayMs} ms`}>
        <input type="range" min={0} max={600} step={10} value={delayMs} onChange={e => setDelayMs(parseInt(e.target.value, 10))} style={{ width: '100%', maxWidth: 320 }} />
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0' }}>Nudge the visuals later to match sound that reaches the room a beat behind — e.g. streaming to a TV or Bluetooth speaker.</p>
      </TabSection>)}
      {err && <p style={{ color: '#f87171', fontSize: 13.5, marginTop: 8 }}>{err}</p>}
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Party setup:</strong> tap fullscreen and drag this window onto your TV or projector — it keeps running while its window stays visible, so you can use other apps beside it. The mic is the reliable way to visualize the room: point your device at the speaker. Grabbing another app’s audio directly (Spotify, Apple Music) isn’t possible on iPhone and is limited on Android — a phone can’t silently tap another app’s sound — so the mic stays the go-to; on a computer you can also capture a browser tab’s sound.
      </p>
        </div>{/* /mv-panels */}
      </div>{/* /mv-split */}
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

// Collapsible control group for the live visualizer — a tap-to-open tab so the panel
// column stays calm (one group open at a time) instead of a long wall of buttons.
// The open control group: a title header for the selected category + its controls.
function TabSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: '1px solid var(--border)', marginTop: 8 }}>
      <h3 style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.02em', margin: '13px 2px 6px', color: 'var(--text-primary)' }}>{title}</h3>
      <div style={{ padding: '0 2px 18px' }}>{children}</div>
    </section>
  )
}
