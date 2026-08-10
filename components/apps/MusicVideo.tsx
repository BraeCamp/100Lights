'use client'

// Music Video — put a transcription ON a video as visuals. Upload a video, its audio is
// transcribed (the hybrid confidence engine — free for clean lines, AI only for the hard bits),
// and the notes drive a visual overlay synced to playback: falling notes, flowing shapes, radial
// spectrum, and more, with colour/font controls. Reuses lib/song-video (the falling-notes engine,
// via o.media = the <video> so it follows the video's clock) + the transcription pipeline.
// v1 = live preview + controls; video EXPORT is the next pass. Non-AI editing is free/unlimited.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Film, Loader2, Play, Square } from 'lucide-react'
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

type Controller = { play: () => void; pause: () => void; destroy: () => void; update: (p: Record<string, unknown>) => void; resize: () => void }
const FONTS = ['system-ui', 'Georgia, serif', 'ui-monospace, monospace', 'Impact, sans-serif']

export default function MusicVideo() {
  return (
    <AppChrome>
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

  return (
    <main id="main" className="max-w-2xl mx-auto" style={{ padding: '20px 18px 40px' }}>
      <header style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>100Lights</p>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>Music Video</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, maxWidth: '54ch' }}>
          Upload a video and its melody becomes a visual overlay — falling notes, flowing shapes, colours, fonts — synced to playback. Then tweak the look freely (no AI).
        </p>
      </header>

      {!videoUrl ? (
        <UploadZone busy={busy} onFile={handleFile} />
      ) : (
        <>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden', background: '#000', border: '1px solid var(--border)' }}>
            <video ref={videoRef} src={videoUrl} playsInline onEnded={() => setPlaying(false)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
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

function UploadZone({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
      onClick={() => inputRef.current?.click()}
      style={{ display: 'grid', placeItems: 'center', gap: 8, minHeight: 168, padding: 20, borderRadius: 16, cursor: busy ? 'wait' : 'pointer', textAlign: 'center', border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`, background: drag ? 'var(--accent-subtle, var(--bg-card))' : 'var(--bg-card)' }}
    >
      <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.webm,.m4v" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = '' }} />
      <span style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, background: 'var(--accent-subtle, var(--bg-base))', color: 'var(--accent)' }}><Film size={22} /></span>
      <span style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)' }}>Drop a video, or tap to choose</span>
      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Upload size={13} /> MP4 · MOV · WebM</span>
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
