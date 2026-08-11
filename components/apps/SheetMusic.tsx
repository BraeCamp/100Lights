'use client'

// Hear Sheet Music — a complete standalone tool: upload a score (photo/PDF, or a MusicXML file),
// it's transcribed to notes (Claude vision via /api/sheet-music, or parsed locally for MusicXML),
// and you HEAR it — play it back on any instrument, see the notes on a mini piano-roll, then open
// it in the 100Lights studio, or export WAV / MIDI. Reuses the real audio engine + project model.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, Upload, Music, Loader2, Sparkles, Download, FileMusic, ChevronLeft } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { importSheetMusic, SHEET_MUSIC_ACCEPT } from '@/lib/sheet-music'
import { buildSketchProject, openSketchInStudio } from '@/lib/open-in-studio'
import { writeMidiFile } from '@/lib/midi-file'
import { DawEngine } from '@/lib/daw-engine'
import { POLY_PRESETS, type MidiNote, type TrackInstrument, defaultPolyInstrument } from '@/lib/daw-types'
import AppChrome from '@/components/apps/AppChrome'
import SheetMusicHome from '@/components/apps/SheetMusicHome'
import NoteEditor from '@/components/apps/NoteEditor'

const INSTRUMENTS = ['Default', 'Super Saw', 'Glass Pluck', 'Cold Pad', 'Brass Pad', 'Darkwave Lead']

export default function SheetMusic() {
  return (
    <AppChrome slug="sheetmusic">
      <SheetMusicShell />
    </AppChrome>
  )
}

// Bespoke Home first, then the tool (Home button in the wrapper; the tool is untouched).
function SheetMusicShell() {
  const [view, setView] = useState<'home' | 'tool'>('home')
  if (view === 'home') return <SheetMusicHome onStart={() => setView('tool')} />
  return (
    <>
      <div className="max-w-2xl mx-auto" style={{ padding: '14px 18px 0' }}>
        <button type="button" onClick={() => setView('home')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <ChevronLeft size={16} /> Home
        </button>
      </div>
      <SheetMusicApp />
    </>
  )
}

function SheetMusicApp() {
  const { isSignedIn } = useUser()
  const [notes, setNotes] = useState<MidiNote[]>([])
  const [tempo, setTempo] = useState(100)
  const [name, setName] = useState('Sheet music')
  const [inst, setInst] = useState('Default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)

  const instrument = useMemo<TrackInstrument>(
    () => (inst === 'Default' ? defaultPolyInstrument() : { type: 'poly', params: POLY_PRESETS[inst] }),
    [inst],
  )
  const project = useMemo(
    () => buildSketchProject(notes, [], { tempo, name, voice: { instrument } }),
    [notes, tempo, name, instrument],
  )
  const lenBeats = useMemo(() => Math.max(4, ...notes.map(n => n.startBeat + n.durationBeats), 4), [notes])
  const has = notes.length > 0

  const handleFile = useCallback(async (file: File) => {
    setBusy(true); setError(null); setPlaying(false)
    try {
      const parsed = await importSheetMusic(file)
      const withIds: MidiNote[] = (parsed.notes || []).map(n => ({ ...n, id: crypto.randomUUID() }))
      if (!withIds.length) throw new Error('No notes were recognized. Try a clearer, higher-contrast image.')
      setNotes(withIds)
      setTempo(Math.round(parsed.tempo || 100))
      setName(parsed.name || 'Sheet music')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/sign in/i.test(msg) ? 'Sign in to transcribe a photo or PDF (MusicXML files work without signing in).' : msg)
    } finally { setBusy(false) }
  }, [])

  // ── Playback (standalone engine) ───────────────────────────────────────────────
  const engineRef = useRef<DawEngine | null>(null)
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project; const e = engineRef.current; if (e && !e.isClosed) e.updateProject(project) }, [project])
  useEffect(() => () => { try { engineRef.current?.dispose() } catch { /* closed */ } }, [])

  const ensureEngine = useCallback(() => {
    let e = engineRef.current
    if (!e || e.isClosed) { e = new DawEngine(); engineRef.current = e }
    e.updateProject(projectRef.current)
    return e
  }, [])
  const togglePlay = useCallback(async () => {
    if (playing) { engineRef.current?.stop(); setPlaying(false); return }
    const e = ensureEngine()
    e.loopStart = 0; e.loopEnd = Math.max(4, lenBeats); e.setLoopEnabled(true)
    try { await e.play(0); setPlaying(true) } catch { setPlaying(false) }
  }, [playing, lenBeats, ensureEngine])

  const exportWav = useCallback(async () => {
    const e = ensureEngine()
    if (playing) { e.stop(); setPlaying(false) }
    const res = await e.renderWav({})
    const a = document.createElement('a'); a.href = res.master; a.download = `${name}.wav`
    document.body.appendChild(a); a.click(); a.remove()
  }, [playing, name, ensureEngine])

  const exportMidi = useCallback(() => {
    const blob = writeMidiFile(notes, tempo, name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${name}.mid`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [notes, tempo, name])

  const openStudio = useCallback(() => openSketchInStudio(notes, [], { tempo, name, voice: { instrument } }), [notes, tempo, name, instrument])

  return (
      <main id="main" className="max-w-2xl mx-auto" style={{ padding: '20px 18px 40px' }}>
        <header style={{ marginBottom: 22 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>100Lights</p>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>Hear Sheet Music</h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, maxWidth: '54ch' }}>
            Upload a photo, PDF, or MusicXML of a score and hear it played back — then tweak the sound, open it in the studio, or export it.
          </p>
        </header>

        <UploadZone busy={busy} onFile={handleFile} accept={SHEET_MUSIC_ACCEPT} hasResult={has} />
        {!isSignedIn && (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted, var(--text-secondary))', margin: '10px 2px 0' }}>
            Photos &amp; PDFs use AI transcription (sign in required). MusicXML files work without signing in.
          </p>
        )}
        {error && <p style={{ color: '#f87171', fontSize: 13.5, margin: '14px 2px 0' }}>{error}</p>}

        {has && (
          <section style={{ marginTop: 26 }}>
            <NoteEditor notes={notes} onChange={setNotes} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '18px 0' }}>
              <button type="button" onClick={togglePlay} aria-label={playing ? 'Stop' : 'Play'} style={{ display: 'grid', placeItems: 'center', width: 54, height: 54, borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#0e0d12', cursor: 'pointer', flexShrink: 0 }}>
                {playing ? <Square size={20} fill="#0e0d12" /> : <Play size={22} fill="#0e0d12" style={{ marginLeft: 2 }} />}
              </button>
              <div>
                <p style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>{playing ? 'Playing…' : 'Hear it'}</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{notes.length} notes · {tempo} BPM · loops</p>
              </div>
            </div>

            <Label>Instrument</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
              {INSTRUMENTS.map(i => {
                const active = inst === i
                return <button key={i} type="button" onClick={() => setInst(i)} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-card)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>{i}</button>
              })}
            </div>

            <Label>Tempo</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
              <input type="range" min={40} max={220} value={tempo} onChange={e => setTempo(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 56, textAlign: 'right' }}>{tempo} BPM</span>
            </div>

            <Label>Export</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <ExportBtn icon={<Sparkles size={15} />} label="Open in 100Lights" onClick={openStudio} subtle />
              <ExportBtn icon={<Download size={15} />} label="WAV" onClick={exportWav} />
              <ExportBtn icon={<FileMusic size={15} />} label="MIDI" onClick={exportMidi} />
            </div>
          </section>
        )}
      </main>
  )
}

function UploadZone({ busy, onFile, accept, hasResult }: { busy: boolean; onFile: (f: File) => void; accept: string; hasResult: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
      onClick={() => inputRef.current?.click()}
      style={{ display: 'grid', placeItems: 'center', gap: 8, minHeight: hasResult ? 92 : 168, padding: 20, borderRadius: 16, cursor: busy ? 'wait' : 'pointer', textAlign: 'center', border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`, background: drag ? 'var(--accent-subtle, var(--bg-card))' : 'var(--bg-card)', transition: 'border-color 120ms, background 120ms' }}
    >
      <input ref={inputRef} type="file" accept={accept} hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = '' }} />
      {busy ? (
        <><Loader2 size={26} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} /><span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Reading the score…</span></>
      ) : (
        <>
          <span style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, background: 'var(--accent-subtle, var(--bg-base))', color: 'var(--accent)' }}>{hasResult ? <Upload size={20} /> : <Music size={22} />}</span>
          <span style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)' }}>{hasResult ? 'Upload another score' : 'Drop a score, or tap to choose'}</span>
          {!hasResult && <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Photo · PDF · MusicXML</span>}
        </>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}


function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, var(--text-secondary))', margin: '0 0 9px' }}>{children}</p>
}
function ExportBtn({ icon, label, onClick, primary, subtle }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean; subtle?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderRadius: 11, fontSize: 13.5, fontWeight: subtle ? 650 : 750, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--accent)' : subtle ? 'transparent' : 'var(--bg-card)', color: primary ? '#0e0d12' : subtle ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
      {icon} {label}
    </button>
  )
}
