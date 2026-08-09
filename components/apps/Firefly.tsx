'use client'

// Firefly — a voice-first, extremely-simplified audio editor. Sing a melody, add a beat, then in
// the Sketch tab hear them TOGETHER (standalone DawEngine), balance the two tracks, pick a voice
// instrument, and export: a new 100Lights project · added to an EXISTING project · or a WAV. It
// composes the tuned capture surfaces (<VoiceMidi>, <BeatMaker>) + reuses the real audio engine
// and project model, wrapped in a themed mobile app shell. Supersedes the paused Flutter app.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Palette, Play, Square, VolumeX, Volume2, Download, FolderPlus, Sparkles, ChevronRight, FolderOpen, Save, Trash2 } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import VoiceMidi, { type RecNote } from '@/components/apps/VoiceMidi'
import BeatMaker from '@/components/apps/BeatMaker'
import { buildSketchProject, openSketchInStudio, type SketchOpts } from '@/lib/open-in-studio'
import { Sheet, CustomizeSheet } from '@/components/apps/AppChrome'
import { saveSketch, listSketches, getSketch, deleteSketch, type FireflySketch, type SketchMeta } from '@/lib/firefly-sketches'
import { DawEngine } from '@/lib/daw-engine'
import { defaultPolyInstrument, POLY_PRESETS, type MidiNote, type TrackInstrument } from '@/lib/daw-types'
import { WorkshopThemeProvider } from '@/components/editor/WorkshopThemeProvider'

type Tab = 'voice' | 'beat' | 'sketch'
const VOICE_INSTRUMENTS = ['Default', 'Super Saw', 'Glass Pluck', 'Cold Pad', 'Brass Pad', 'Darkwave Lead']

export default function Firefly() {
  return (
    <WorkshopThemeProvider>
      <FireflyApp />
    </WorkshopThemeProvider>
  )
}

function FireflyApp() {
  const [tab, setTab] = useState<Tab>('voice')
  const [melody, setMelody] = useState<RecNote[]>([])
  const [bpm, setBpm] = useState(100)
  const [beat, setBeat] = useState<MidiNote[]>([])
  const [voiceVol, setVoiceVol] = useState(0.85)
  const [voiceMute, setVoiceMute] = useState(false)
  const [voiceInst, setVoiceInst] = useState('Default')
  const [beatVol, setBeatVol] = useState(0.9)
  const [beatMute, setBeatMute] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sketchesOpen, setSketchesOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  // Restore signals pushed into the capture surfaces when a saved sketch is opened.
  const [voiceRestore, setVoiceRestore] = useState<{ notes: RecNote[]; bpm: number; nonce: number }>()
  const [beatRestore, setBeatRestore] = useState<{ notes: MidiNote[]; nonce: number }>()
  const restoreNonce = useRef(0)

  const onNotes = useCallback((notes: RecNote[], tempo: number) => { setMelody(notes); setBpm(tempo) }, [])
  const onPattern = useCallback((notes: MidiNote[]) => setBeat(notes), [])

  // Melody take (seconds) → beat-based MidiNotes at the take tempo.
  const melodyMidi = useMemo<MidiNote[]>(() => melody.map(m => ({
    id: crypto.randomUUID(), pitch: m.midi,
    startBeat: (m.startSec * bpm) / 60,
    durationBeats: Math.max(0.0625, (m.durSec * bpm) / 60),
    velocity: m.velocity <= 1 ? Math.max(1, Math.round(m.velocity * 127)) : Math.round(m.velocity),
  })), [melody, bpm])

  const voiceInstrument = useMemo<TrackInstrument>(
    () => (voiceInst === 'Default' ? defaultPolyInstrument() : { type: 'poly', params: POLY_PRESETS[voiceInst] }),
    [voiceInst],
  )
  const sketchOpts = useMemo<SketchOpts>(() => ({
    tempo: bpm, name: 'Firefly sketch',
    voice: { volume: voiceVol, mute: voiceMute, instrument: voiceInstrument },
    beat: { volume: beatVol, mute: beatMute },
  }), [bpm, voiceVol, voiceMute, voiceInstrument, beatVol, beatMute])

  const project = useMemo(() => buildSketchProject(melodyMidi, beat, sketchOpts), [melodyMidi, beat, sketchOpts])
  const lenBeats = useMemo(() => Math.max(4, ...project.arrangementClips.map(c => c.startBeat + c.durationBeats), 4), [project])
  const hasContent = melody.length > 0 || beat.length > 0
  const summary = useMemo(() => {
    const parts: string[] = []
    if (melody.length) parts.push(`${melody.length} note${melody.length === 1 ? '' : 's'}`)
    if (beat.length) parts.push(`${beat.length} hit${beat.length === 1 ? '' : 's'}`)
    return parts.join(' · ')
  }, [melody.length, beat.length])

  // ── Standalone playback engine (voice + beat together) ─────────────────────────
  const engineRef = useRef<DawEngine | null>(null)
  const projectRef = useRef(project)
  useEffect(() => {
    projectRef.current = project
    const e = engineRef.current
    if (e && !e.isClosed) e.updateProject(project)
  }, [project])
  useEffect(() => () => { try { engineRef.current?.dispose() } catch { /* closed */ } }, [])

  const ensureEngine = useCallback((): DawEngine => {
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

  // Stop playback when leaving the Sketch tab.
  useEffect(() => { if (tab !== 'sketch' && playing) { engineRef.current?.stop(); setPlaying(false) } }, [tab, playing])

  const exportWav = useCallback(async () => {
    const e = ensureEngine()
    if (playing) { e.stop(); setPlaying(false) }
    const res = await e.renderWav({})
    const a = document.createElement('a')
    a.href = res.master; a.download = 'firefly-sketch.wav'
    document.body.appendChild(a); a.click(); a.remove()
  }, [playing, ensureEngine])

  const openNew = useCallback(() => openSketchInStudio(melodyMidi, beat, sketchOpts), [melodyMidi, beat, sketchOpts])

  const saveCurrentSketch = useCallback(async (name: string) => {
    await saveSketch({
      id: crypto.randomUUID(), name: name.trim() || 'Untitled sketch', savedAt: Date.now(),
      bpm, melody, beat, settings: { voiceVol, voiceMute, voiceInst, beatVol, beatMute },
    })
  }, [bpm, melody, beat, voiceVol, voiceMute, voiceInst, beatVol, beatMute])

  const openSavedSketch = useCallback((sk: FireflySketch) => {
    restoreNonce.current += 1
    const nonce = restoreNonce.current
    setBpm(sk.bpm)
    setVoiceVol(sk.settings.voiceVol); setVoiceMute(sk.settings.voiceMute); setVoiceInst(sk.settings.voiceInst)
    setBeatVol(sk.settings.beatVol); setBeatMute(sk.settings.beatMute)
    setMelody(sk.melody); setBeat(sk.beat)
    setVoiceRestore({ notes: sk.melody, bpm: sk.bpm, nonce })  // push into <VoiceMidi>
    setBeatRestore({ notes: sk.beat, nonce })                 // push into <BeatMaker>
    setSketchesOpen(false); setTab('sketch')
  }, [])

  return (
    <div
      data-editor="true"
      style={{
        minHeight: '100dvh', background: 'var(--bg-base)',
        backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <header style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 10, background: 'color-mix(in srgb, var(--bg-base) 82%, transparent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span aria-hidden style={{ fontSize: 18, filter: 'drop-shadow(0 0 6px var(--accent))' }}>🔆</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Firefly</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setSketchesOpen(true)} aria-label="Saved sketches" style={iconBtn}>
            <FolderOpen size={18} />
          </button>
          <button type="button" onClick={() => setCustomizing(true)} aria-label="Customize appearance" style={iconBtn}>
            <Palette size={18} />
          </button>
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 6, padding: '12px 16px 4px' }}>
        {(['voice', 'beat', 'sketch'] as Tab[]).map(t => {
          const active = tab === t
          const label = t === 'voice' ? 'Sing' : t === 'beat' ? 'Beat' : 'Sketch'
          return (
            <button key={t} type="button" onClick={() => setTab(t)} style={{ flex: 1, padding: '11px 0', borderRadius: 11, border: '1px solid var(--border)', fontSize: 14.5, fontWeight: 750, cursor: 'pointer', transition: 'background 120ms, color 120ms', background: active ? 'var(--accent)' : 'var(--bg-card)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>
              {label}
            </button>
          )
        })}
      </nav>

      <main id="main" style={{ flex: 1, overflowX: 'hidden', padding: '10px 14px 96px' }}>
        <div style={{ display: tab === 'voice' ? 'block' : 'none' }}><VoiceMidi onNotes={onNotes} restore={voiceRestore} /></div>
        <div style={{ display: tab === 'beat' ? 'block' : 'none' }}><BeatMaker onPattern={onPattern} restore={beatRestore} /></div>
        {tab === 'sketch' && (
          <SketchTab
            hasContent={hasContent} summary={summary} bpm={bpm} playing={playing} onTogglePlay={togglePlay}
            voiceVol={voiceVol} setVoiceVol={setVoiceVol} voiceMute={voiceMute} setVoiceMute={setVoiceMute}
            voiceInst={voiceInst} setVoiceInst={setVoiceInst} hasVoice={melody.length > 0}
            beatVol={beatVol} setBeatVol={setBeatVol} beatMute={beatMute} setBeatMute={setBeatMute} hasBeat={beat.length > 0}
          />
        )}
      </main>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 15, borderTop: '1px solid var(--border)', background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)', backdropFilter: 'blur(10px)', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hasContent ? `Sketch: ${summary}` : 'Sing or tap a beat to start'}
        </span>
        <button type="button" onClick={() => setExporting(true)} disabled={!hasContent} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 18px', borderRadius: 11, border: 'none', fontSize: 14, fontWeight: 800, cursor: hasContent ? 'pointer' : 'not-allowed', background: hasContent ? 'var(--accent)' : 'var(--border)', color: hasContent ? '#0e0d12' : 'var(--text-muted, var(--text-secondary))' }}>
          <Download size={16} /> Export
        </button>
      </div>

      {sketchesOpen && <SketchesSheet onClose={() => setSketchesOpen(false)} hasContent={hasContent} onSave={saveCurrentSketch} onOpen={openSavedSketch} />}
      {customizing && <CustomizeSheet onClose={() => setCustomizing(false)} />}
      {exporting && (
        <ExportSheet
          onClose={() => setExporting(false)} onOpenNew={openNew} onExportWav={exportWav}
          buildAppendTracks={() => buildSketchProject(melodyMidi, beat, sketchOpts)}
        />
      )}
    </div>
  )
}

// ── Sketch (the simplified editor): play together + per-track mix + voice instrument ─────────
function SketchTab(props: {
  hasContent: boolean; summary: string; bpm: number; playing: boolean; onTogglePlay: () => void
  voiceVol: number; setVoiceVol: (v: number) => void; voiceMute: boolean; setVoiceMute: (v: boolean) => void
  voiceInst: string; setVoiceInst: (v: string) => void; hasVoice: boolean
  beatVol: number; setBeatVol: (v: number) => void; beatMute: boolean; setBeatMute: (v: boolean) => void; hasBeat: boolean
}) {
  if (!props.hasContent) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '40dvh', textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>
        <div>
          <Sparkles size={26} style={{ color: 'var(--accent)', marginBottom: 10 }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>Your sketch is empty</p>
          <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>Sing a melody or tap out a beat, then come back here to<br />play them together and mix.</p>
        </div>
      </div>
    )
  }
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '4px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '6px 0 20px' }}>
        <button type="button" onClick={props.onTogglePlay} aria-label={props.playing ? 'Stop' : 'Play sketch'} style={{ display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#0e0d12', cursor: 'pointer', flexShrink: 0 }}>
          {props.playing ? <Square size={22} fill="#0e0d12" /> : <Play size={24} fill="#0e0d12" style={{ marginLeft: 2 }} />}
        </button>
        <div>
          <p style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>{props.playing ? 'Playing…' : 'Play together'}</p>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{props.summary} · {props.bpm} BPM · loops</p>
        </div>
      </div>

      <TrackRow name="Voice" enabled={props.hasVoice} vol={props.voiceVol} setVol={props.setVoiceVol} mute={props.voiceMute} setMute={props.setVoiceMute}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {VOICE_INSTRUMENTS.map(i => {
            const active = props.voiceInst === i
            return (
              <button key={i} type="button" onClick={() => props.setVoiceInst(i)} style={{ padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-base)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>
                {i}
              </button>
            )
          })}
        </div>
      </TrackRow>
      <TrackRow name="Beat" enabled={props.hasBeat} vol={props.beatVol} setVol={props.setBeatVol} mute={props.beatMute} setMute={props.setBeatMute} />
    </div>
  )
}

function TrackRow({ name, enabled, vol, setVol, mute, setMute, children }: { name: string; enabled: boolean; vol: number; setVol: (v: number) => void; mute: boolean; setMute: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)', marginBottom: 12, opacity: enabled ? 1 : 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)', minWidth: 52 }}>{name}</span>
        <input type="range" min={0} max={1} step={0.01} value={vol} disabled={!enabled} onChange={e => setVol(Number(e.target.value))} aria-label={`${name} volume`} style={{ flex: 1, accentColor: 'var(--accent)' }} />
        <button type="button" onClick={() => setMute(!mute)} disabled={!enabled} aria-label={`${mute ? 'Unmute' : 'Mute'} ${name}`} style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 9, border: '1px solid var(--border)', background: mute ? 'var(--accent)' : 'var(--bg-base)', color: mute ? '#0e0d12' : 'var(--text-secondary)', cursor: enabled ? 'pointer' : 'not-allowed' }}>
          {mute ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </div>
      {enabled && children}
    </div>
  )
}

// ── Export sheet: new project · add to existing · WAV ────────────────────────────────────────
function ExportSheet({ onClose, onOpenNew, onExportWav, buildAppendTracks }: {
  onClose: () => void; onOpenNew: () => void; onExportWav: () => Promise<void>
  buildAppendTracks: () => { tracks: unknown[]; arrangementClips: unknown[] }
}) {
  const { isSignedIn } = useUser()
  const [picking, setPicking] = useState(false)
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const openPicker = useCallback(async () => {
    setPicking(true); setErr(null)
    try {
      const list = await fetch('/api/projects', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject(new Error('list failed')))
      setProjects((Array.isArray(list) ? list : []).map((p: { id: string; name?: string }) => ({ id: p.id, name: p.name || 'Untitled' })))
    } catch { setErr('Could not load your projects.'); setProjects([]) }
  }, [])

  const addTo = useCallback(async (pid: string) => {
    setBusy(pid); setErr(null)
    try {
      const cf = await fetch(`/api/projects/${pid}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      const sketch = buildAppendTracks()
      if (!cf.dawProject) cf.dawProject = sketch
      else {
        cf.dawProject.tracks = [...(cf.dawProject.tracks || []), ...sketch.tracks]
        cf.dawProject.arrangementClips = [...(cf.dawProject.arrangementClips || []), ...sketch.arrangementClips]
      }
      if (!Array.isArray(cf.modules) || !cf.modules.includes('audio')) cf.modules = [...(cf.modules || []), 'audio']
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cf) })
      if (!r.ok) throw new Error('save failed')
      window.location.assign(`/projects/${pid}`)
    } catch { setErr('Could not add to that project.'); setBusy(null) }
  }, [buildAppendTracks])

  return (
    <Sheet onClose={onClose} title="Export sketch">
      {!picking ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ExportRow icon={<Sparkles size={18} />} title="New 100Lights project" sub="Open the sketch in the studio to finish it" onClick={() => { onClose(); onOpenNew() }} />
          <ExportRow
            icon={<FolderPlus size={18} />} title="Add to an existing project"
            sub={isSignedIn ? 'Append the voice + beat to a saved project' : 'Sign in to add to a project'}
            disabled={!isSignedIn} onClick={openPicker}
          />
          <ExportRow icon={<Download size={18} />} title="Export WAV" sub="Bounce the mix to an audio file" onClick={async () => { await onExportWav(); onClose() }} />
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setPicking(false)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '0 0 12px' }}>← Back</button>
          {projects === null ? <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>Loading your projects…</p>
            : projects.length === 0 ? <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>No projects yet — create one from the studio first.</p>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46dvh', overflowY: 'auto' }}>
                  {projects.map(p => (
                    <button key={p.id} type="button" disabled={!!busy} onClick={() => addTo(p.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14.5, fontWeight: 650, cursor: busy ? 'wait' : 'pointer', textAlign: 'left' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{busy === p.id ? 'Adding…' : <ChevronRight size={17} />}</span>
                    </button>
                  ))}
                </div>
              )}
        </div>
      )}
      {err && <p style={{ color: '#f87171', fontSize: 12.5, marginTop: 12 }}>{err}</p>}
    </Sheet>
  )
}

function ExportRow({ icon, title, sub, onClick, disabled }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-base)', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: disabled ? 0.55 : 1 }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--accent-subtle, var(--bg-card))', color: 'var(--accent)', flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 750, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 1 }}>{sub}</span>
      </span>
    </button>
  )
}

// ── Sketches: a local saved-sketch library (persistence) ─────────────────────────────────────
function SketchesSheet({ onClose, hasContent, onSave, onOpen }: {
  onClose: () => void; hasContent: boolean
  onSave: (name: string) => Promise<void>; onOpen: (sk: FireflySketch) => void
}) {
  const [list, setList] = useState<SketchMeta[] | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const refresh = useCallback(() => { listSketches().then(setList) }, [])
  useEffect(() => { refresh() }, [refresh])

  const save = async () => {
    if (!hasContent || saving) return
    setSaving(true)
    try { await onSave(name); setName('') ; refresh() } finally { setSaving(false) }
  }
  const open = async (id: string) => { const sk = await getSketch(id); if (sk) onOpen(sk) }
  const del = async (id: string) => { await deleteSketch(id); refresh() }

  return (
    <Sheet onClose={onClose} title="Sketches">
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder="Name this sketch"
          onKeyDown={e => { if (e.key === 'Enter') void save() }}
          style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14 }}
        />
        <button type="button" onClick={() => void save()} disabled={!hasContent || saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 15px', borderRadius: 10, border: 'none', background: hasContent ? 'var(--accent)' : 'var(--border)', color: hasContent ? '#0e0d12' : 'var(--text-muted, var(--text-secondary))', fontSize: 13.5, fontWeight: 750, cursor: hasContent && !saving ? 'pointer' : 'not-allowed' }}>
          <Save size={15} /> Save
        </button>
      </div>
      {!hasContent && <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '-10px 0 16px' }}>Record a melody or make a beat to save a sketch.</p>}
      {list === null ? <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>Loading…</p>
        : list.length === 0 ? <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>No saved sketches yet.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '52dvh', overflowY: 'auto' }}>
              {list.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--bg-base)' }}>
                  <button type="button" onClick={() => void open(s.id)} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
                      {[s.notes ? `${s.notes} notes` : '', s.hits ? `${s.hits} hits` : ''].filter(Boolean).join(' · ') || 'empty'}
                    </span>
                  </button>
                  <button type="button" onClick={() => void del(s.id)} aria-label={`Delete ${s.name}`} style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
    </Sheet>
  )
}

const iconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }
