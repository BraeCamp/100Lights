'use client'

// Transcribe — audio → MIDI. Upload an audio file (or record a line), and the tuned pitch
// detector (lib/voice-backfill, the same engine behind voice→instrument) turns it into editable
// notes you can HEAR on any instrument and export (studio / WAV / MIDI). Works on real recordings,
// not just live singing; fully client-side (no sign-in). Monophonic — best on a single melody line.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, Upload, Music, Loader2, Sparkles, Download, FileMusic, Mic } from 'lucide-react'
import { analyzeBufferAsync, type BackfillNote } from '@/lib/voice-backfill'
import { buildSketchProject, openSketchInStudio } from '@/lib/open-in-studio'
import { writeMidiFile } from '@/lib/midi-file'
import { DawEngine } from '@/lib/daw-engine'
import { POLY_PRESETS, type MidiNote, type TrackInstrument, defaultPolyInstrument } from '@/lib/daw-types'
import { WorkshopThemeProvider } from '@/components/editor/WorkshopThemeProvider'

const INSTRUMENTS = ['Default', 'Super Saw', 'Glass Pluck', 'Cold Pad', 'Brass Pad', 'Darkwave Lead']

export default function Transcribe() {
  return (
    <WorkshopThemeProvider>
      <TranscribeApp />
    </WorkshopThemeProvider>
  )
}

function TranscribeApp() {
  const [secNotes, setSecNotes] = useState<BackfillNote[]>([])  // detection result, in SECONDS
  const [tempo, setTempo] = useState(100)
  const [name, setName] = useState('Transcription')
  const [inst, setInst] = useState('Default')
  const [sensitivity, setSensitivity] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)

  const audioRef = useRef<{ samples: Float32Array; sr: number } | null>(null)  // for re-analysis
  const mrRef = useRef<MediaRecorder | null>(null)

  const instrument = useMemo<TrackInstrument>(
    () => (inst === 'Default' ? defaultPolyInstrument() : { type: 'poly', params: POLY_PRESETS[inst] }),
    [inst],
  )
  // Seconds → beats at the chosen tempo (playback timing is faithful either way; tempo sets the grid).
  const notes = useMemo<MidiNote[]>(() => secNotes.map(n => ({
    id: crypto.randomUUID(), pitch: n.midi,
    startBeat: (n.startSec * tempo) / 60,
    durationBeats: Math.max(0.0625, (n.durSec * tempo) / 60),
    velocity: n.velocity <= 1 ? Math.max(1, Math.round(n.velocity * 127)) : Math.round(n.velocity),
  })), [secNotes, tempo])
  const project = useMemo(() => buildSketchProject(notes, [], { tempo, name, voice: { instrument } }), [notes, tempo, name, instrument])
  const lenBeats = useMemo(() => Math.max(4, ...notes.map(n => n.startBeat + n.durationBeats), 4), [notes])
  const has = secNotes.length > 0

  const analyze = useCallback(async (samples: Float32Array, sr: number, sens: number) => {
    const a = await analyzeBufferAsync(samples, sr, { sensitivity: sens, minDuration: 0.08, segmenter: 'hmm' })
    setSecNotes(a.notes)
    if (!a.notes.length) setError('No clear melody detected. Try a cleaner, single-line recording.')
  }, [])

  const ingest = useCallback(async (buf: ArrayBuffer, label: string) => {
    setBusy(true); setError(null); setPlaying(false)
    try {
      const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const audio = await ac.decodeAudioData(buf)
      const samples = new Float32Array(audio.getChannelData(0))  // channel 0 (mono)
      audioRef.current = { samples, sr: audio.sampleRate }
      setName(label)
      await analyze(samples, audio.sampleRate, sensitivity)
      ac.close()
    } catch (e) {
      setError(e instanceof Error ? `Couldn't read that audio: ${e.message}` : 'Could not read that audio file.')
    } finally { setBusy(false) }
  }, [analyze, sensitivity])

  const onFile = useCallback((f: File) => { void f.arrayBuffer().then(b => ingest(b, f.name.replace(/\.[^.]+$/, ''))) }, [ingest])

  // Re-run detection when sensitivity changes (on the stored audio).
  const onSensitivity = useCallback((v: number) => {
    setSensitivity(v)
    const a = audioRef.current
    if (a && !busy) { setBusy(true); void analyze(a.samples, a.sr, v).finally(() => setBusy(false)) }
  }, [analyze, busy])

  // ── Mic record → transcribe ────────────────────────────────────────────────────
  const startRec = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); void new Blob(chunks).arrayBuffer().then(b => ingest(b, 'Recording')) }
      mr.start(); mrRef.current = mr; setRecording(true); setError(null)
    } catch { setError('Microphone access was denied.') }
  }, [ingest])
  const stopRec = useCallback(() => { mrRef.current?.stop(); setRecording(false) }, [])

  // ── Playback ───────────────────────────────────────────────────────────────────
  const engineRef = useRef<DawEngine | null>(null)
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project; const e = engineRef.current; if (e && !e.isClosed) e.updateProject(project) }, [project])
  useEffect(() => () => { try { engineRef.current?.dispose() } catch { /* closed */ } }, [])
  const ensureEngine = useCallback(() => {
    let e = engineRef.current
    if (!e || e.isClosed) { e = new DawEngine(); engineRef.current = e }
    e.updateProject(projectRef.current); return e
  }, [])
  const togglePlay = useCallback(async () => {
    if (playing) { engineRef.current?.stop(); setPlaying(false); return }
    const e = ensureEngine()
    e.loopStart = 0; e.loopEnd = Math.max(4, lenBeats); e.setLoopEnabled(true)
    try { await e.play(0); setPlaying(true) } catch { setPlaying(false) }
  }, [playing, lenBeats, ensureEngine])

  const exportWav = useCallback(async () => {
    const e = ensureEngine(); if (playing) { e.stop(); setPlaying(false) }
    const res = await e.renderWav({})
    const a = document.createElement('a'); a.href = res.master; a.download = `${name}.wav`; document.body.appendChild(a); a.click(); a.remove()
  }, [playing, name, ensureEngine])
  const exportMidi = useCallback(() => {
    const url = URL.createObjectURL(writeMidiFile(notes, tempo, name))
    const a = document.createElement('a'); a.href = url; a.download = `${name}.mid`; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [notes, tempo, name])
  const openStudio = useCallback(() => openSketchInStudio(notes, [], { tempo, name, voice: { instrument } }), [notes, tempo, name, instrument])

  return (
    <div data-editor="true" style={{ minHeight: '100dvh', background: 'var(--bg-base)', backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)' }}>
      <main id="main" className="max-w-2xl mx-auto" style={{ padding: '20px 18px 40px' }}>
        <header style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>100Lights</p>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>Transcribe</h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, maxWidth: '54ch' }}>
            Upload an audio file or record a line, and turn it into editable MIDI notes — hear them on any instrument, then open in the studio or export. Works best on a single melody line.
          </p>
        </header>

        <div style={{ display: 'flex', gap: 10, marginBottom: 2 }}>
          <div style={{ flex: 1 }}><UploadZone busy={busy} onFile={onFile} hasResult={has} /></div>
          <button type="button" onClick={recording ? stopRec : startRec} disabled={busy} aria-label={recording ? 'Stop recording' : 'Record'} style={{ display: 'grid', placeItems: 'center', gap: 6, width: 100, borderRadius: 16, border: '1.5px solid var(--border)', background: recording ? 'var(--accent)' : 'var(--bg-card)', color: recording ? '#0e0d12' : 'var(--text-secondary)', cursor: busy ? 'not-allowed' : 'pointer' }}>
            {recording ? <Square size={22} /> : <Mic size={22} />}
            <span style={{ fontSize: 12.5, fontWeight: 750 }}>{recording ? 'Stop' : 'Record'}</span>
          </button>
        </div>
        {error && <p style={{ color: '#f87171', fontSize: 13.5, margin: '14px 2px 0' }}>{error}</p>}

        {has && (
          <section style={{ marginTop: 24 }}>
            <PianoRoll notes={notes} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '18px 0' }}>
              <button type="button" onClick={togglePlay} aria-label={playing ? 'Stop' : 'Play'} style={{ display: 'grid', placeItems: 'center', width: 54, height: 54, borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#0e0d12', cursor: 'pointer', flexShrink: 0 }}>
                {playing ? <Square size={20} fill="#0e0d12" /> : <Play size={22} fill="#0e0d12" style={{ marginLeft: 2 }} />}
              </button>
              <div>
                <p style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>{playing ? 'Playing…' : 'Hear it'}</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{notes.length} notes · {tempo} BPM · loops</p>
              </div>
            </div>

            <Label>Detection sensitivity</Label>
            <input type="range" min={0.1} max={0.9} step={0.05} value={sensitivity} onChange={e => onSensitivity(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)', marginBottom: 18 }} />

            <Label>Instrument</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
              {INSTRUMENTS.map(i => { const active = inst === i; return <button key={i} type="button" onClick={() => setInst(i)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-card)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>{i}</button> })}
            </div>

            <Label>Tempo</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
              <input type="range" min={40} max={220} value={tempo} onChange={e => setTempo(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 56, textAlign: 'right' }}>{tempo} BPM</span>
            </div>

            <Label>Export</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <ExportBtn icon={<Sparkles size={15} />} label="Open in 100Lights" onClick={openStudio} primary />
              <ExportBtn icon={<Download size={15} />} label="WAV" onClick={exportWav} />
              <ExportBtn icon={<FileMusic size={15} />} label="MIDI" onClick={exportMidi} />
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function UploadZone({ busy, onFile, hasResult }: { busy: boolean; onFile: (f: File) => void; hasResult: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
      onClick={() => inputRef.current?.click()}
      style={{ display: 'grid', placeItems: 'center', gap: 8, minHeight: hasResult ? 92 : 150, padding: 18, borderRadius: 16, cursor: busy ? 'wait' : 'pointer', textAlign: 'center', border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`, background: drag ? 'var(--accent-subtle, var(--bg-card))' : 'var(--bg-card)', transition: 'border-color 120ms, background 120ms' }}
    >
      <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = '' }} />
      {busy ? (
        <><Loader2 size={24} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} /><span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Listening…</span></>
      ) : (
        <>
          <span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, borderRadius: 12, background: 'var(--accent-subtle, var(--bg-base))', color: 'var(--accent)' }}>{hasResult ? <Upload size={19} /> : <Music size={21} />}</span>
          <span style={{ fontSize: 14.5, fontWeight: 750, color: 'var(--text-primary)' }}>{hasResult ? 'Upload another' : 'Drop audio, or tap to choose'}</span>
          {!hasResult && <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>MP3 · WAV · M4A</span>}
        </>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function PianoRoll({ notes }: { notes: MidiNote[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const ctx = cv.getContext('2d'); if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = cv.clientWidth, H = 150
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)
    if (!notes.length) return
    const end = Math.max(...notes.map(n => n.startBeat + n.durationBeats), 1)
    const pits = notes.map(n => n.pitch)
    const lo = Math.min(...pits) - 1, hi = Math.max(...pits) + 1
    const span = Math.max(6, hi - lo)
    const accent = getComputedStyle(cv).getPropertyValue('--accent').trim() || '#3d8fef'
    const pad = 6
    for (const n of notes) {
      const x = pad + (n.startBeat / end) * (W - 2 * pad)
      const w = Math.max(2, (n.durationBeats / end) * (W - 2 * pad) - 1)
      const y = pad + (1 - (n.pitch - lo) / span) * (H - 2 * pad)
      ctx.fillStyle = accent
      ctx.fillRect(x, y - 3, w, 6)
    }
  }, [notes])
  return <canvas ref={ref} style={{ width: '100%', height: 150, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }} />
}

function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, var(--text-secondary))', margin: '0 0 9px' }}>{children}</p>
}
function ExportBtn({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderRadius: 11, fontSize: 13.5, fontWeight: 750, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--accent)' : 'var(--bg-card)', color: primary ? '#0e0d12' : 'var(--text-primary)' }}>
      {icon} {label}
    </button>
  )
}
