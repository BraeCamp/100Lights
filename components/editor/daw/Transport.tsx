'use client'

import { uploadRecordingBlob } from '@/lib/record-upload'
import { useRegisterCommands } from '@/lib/commands'
import Knob from './Knob'
import { type MonitorFx, type DawEngine } from '@/lib/daw-engine'
import { useCallback, useEffect, useRef, useState, type ReactNode, type Dispatch } from 'react'
import { useAppear } from '@/components/ui/Appear'
import nextDynamic from 'next/dynamic'

// Lazy at module scope: the menu pulls in the plugin registry, which scans for
// built-in manifests and talks to the Beacon Bridge. None of that belongs in
// the transport bar's first paint.
const PluginMenu = nextDynamic(() => import('./PluginMenu'), { ssr: false })
// Lazy: it pulls in speech recognition and the command executor, neither of
// which belongs in the transport bar's first paint.
// ⚠️ Light is NOT mounted here any more. It lives in the app layout so that
// navigating cannot destroy it mid-conversation — see components/LightMount.
// This file now only says WHERE its button belongs; Light portals into the slot,
// so it still sits in the transport bar exactly as before.
import { setLightSlot } from '@/lib/voice/light-slot'
import { createPortal } from 'react-dom'
import { Play, Square, Circle, SkipBack, Repeat, Gauge, Volume2, Camera, Video, ChevronDown, History, Upload, X, Headphones, Zap, RotateCcw, LogIn, LogOut } from 'lucide-react'
import { TbMetronome } from 'react-icons/tb'
import { apIcon, apIconOn, apDivider } from './apollo-chrome'
import { captureScreenshot, screenshotSupported } from '@/lib/screen-recorder'
import { usePlan } from '@/hooks/usePlan'
import { useDaw, formatBeat, makeAudioClip, migrateProject, type DawAction } from '@/lib/daw-state'
import { tempoSegments, tempoAt, clampBpm } from '@/lib/tempo-map'
import { planPunch, describePunch, punchArmed } from '@/lib/punch'
import { useMetronomeSettings, setMetronomeSettings, countInPosition, describeMetronome, CLICK_SOUNDS, CLICK_RHYTHMS, type ClickSound, type ClickRhythm } from '@/lib/metronome'
import { RECORD_GRIDS, DEFAULT_RECORD_GRID, recordGridLabel, type RecordGrid } from '@/lib/record-quantize'
import type { DawProject } from '@/lib/daw-types'
import { openProjectInStudio } from '@/lib/open-in-studio'
import { useElectronChrome } from '@/lib/use-electron-chrome'
import { useUITierOptional } from '../UITierProvider'
import dynamic from 'next/dynamic'
import AdminMenu from '@/components/editor/daw/AdminMenu'

const PadTuner    = dynamic(() => import('./PadTuner'),    { ssr: false })
// Screen capture pulls in MediaRecorder plumbing nobody needs until they record.
const ScreenRecorderPanel = dynamic(() => import('./ScreenRecorder'), { ssr: false })
// The annotate-screenshot editor is heavy (canvas tools + colour picker) and
// only needed the moment a shot is taken — load its chunk on demand.
const ScreenshotAnnotator = dynamic(() => import('./ScreenshotAnnotator'), { ssr: false })
const MaskingPanel = dynamic(() => import('./MaskingPanel'), { ssr: false })

function fmtHMS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const REC_FX_DEFS: Record<MonitorFx['type'], { label: string; min: number; max: number; step: number; def: number; fmt: (v: number) => string }> = {
  volume:     { label: 'Volume',     min: 0,   max: 2,     step: 0.01, def: 1,    fmt: v => `${Math.round(v * 100)}%` },
  filter:     { label: 'Filter',     min: 200, max: 12000, step: 10,   def: 6000, fmt: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz` },
  reverb:     { label: 'Reverb',     min: 0,   max: 1,     step: 0.01, def: 0.3,  fmt: v => `${Math.round(v * 100)}%` },
  delay:      { label: 'Delay',      min: 0,   max: 1,     step: 0.01, def: 0.3,  fmt: v => `${Math.round(v * 100)}%` },
  distortion: { label: 'Distortion', min: 0,   max: 1,     step: 0.01, def: 0.3,  fmt: v => `${Math.round(v * 100)}%` },
  tremolo:    { label: 'Tremolo',    min: 0,   max: 1,     step: 0.01, def: 0.5,  fmt: v => `${Math.round(v * 100)}%` },
}

// Momentary performance-FX pad: hold to apply on the master, release to reset.
// Shared engine.perfFX with the mobile transport, so both platforms match.
function FxPad({ label, mode, engine, color }: { label: string; mode: 'lp' | 'hp' | 'duck'; engine: DawEngine; color: string }) {
  const [on, setOn] = useState(false)
  const down = () => { setOn(true); engine.perfFX(mode) }
  const up = () => { setOn(false); engine.perfFX('off') }
  return (
    <button onPointerDown={e => { e.preventDefault(); down() }} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
      style={{ padding: '4px 9px', borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${on ? color : 'var(--border)'}`, background: on ? `${color}30` : 'var(--bg-card)', color: on ? color : 'var(--text-muted)' }}>
      {label}
    </button>
  )
}

interface TransportProps {
  /** Persist a project rename to the API + refresh the slug/URL (from ProjectEditor). */
  onCommitName?: (name: string) => void
}

export default function Transport({ onCommitName }: TransportProps = {}) {
  const { project, dispatch, engine, playing, recording, setPosition, metronome, setMetronome, audioMode, triggerBlink, loopToolArmed, setLoopToolArmed, selectedTrackId, setApolloRack } = useDaw()

  // The track the plugin menu acts on: whatever is selected, else the first.
  const pluginTrack = project.tracks.find(t => t.id === selectedTrackId) ?? project.tracks[0]

  /** A new project has no tracks at all, and this is the first control a new
   *  user reaches for — it has to open something rather than sit there doing
   *  nothing. So choosing anything from the menu gives it a track to live on. */
  const ensurePluginTrack = useCallback((): string => {
    const existing = project.tracks.find(t => t.id === selectedTrackId) ?? project.tracks[0]
    if (existing) return existing.id
    const id = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id, name: 'Apollo' })
    return id
  }, [project.tracks, selectedTrackId, dispatch])
  // Editable project title shown in the toolbar (the DAW previously showed none).
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput]     = useState('')
  function commitProjectName() {
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== project.name) {
      dispatch({ type: 'PATCH_PROJECT', patch: { name: trimmed } }) // update the in-editor blob
      onCommitName?.(trimmed)                                        // persist + regen slug/URL
    }
    setEditingName(false)
  }
  const { isPro } = usePlan()
  const { padTrafficLights } = useElectronChrome()

  // ── Refs ────────────────────────────────────────────────────────────────────
  const posRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number | undefined>(undefined)

  // Podcast wall-clock tracking
  const wallSecsRef    = useRef(0)
  const lastFrameRef   = useRef<number | undefined>(undefined)
  const isPlayingRef   = useRef(playing)
  const podcastPosRef  = useRef<HTMLSpanElement>(null)

  // ── State (music mode only) ─────────────────────────────────────────────────
  const [editingBpm, setEditingBpm] = useState(false)
  const [bpmDraft, setBpmDraft] = useState('')
  const [fxOpen, setFxOpen] = useState(false)
  const fxA = useAppear(fxOpen, 'pop-up')
  const [metroMenu, setMetroMenu] = useState(false)
  const metroA = useAppear(metroMenu, 'pop-up')
  const [editingTimeSig, setEditingTimeSig] = useState(false)
  const [showTuner, setShowTuner] = useState(false)
  const [showRecorder, setShowRecorder] = useState(false)
  const [recorderMode, setRecorderMode] = useState<'screen' | 'history'>('screen')
  const [captureOpen, setCaptureOpen] = useState(false)
  const captureA = useAppear(captureOpen, 'pop')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Open a .cfproj project file straight into the studio (mirrors the projects
  // dashboard upload). Loads via the studio seed so the project's recorded
  // construction history rides along intact — replay plays the real history.
  async function handleOpenFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Standard MIDI File (.mid/.midi): import notes + tempo/meter (incl. changes)
    // as a project. MIDI has no audio and no synth patches by nature of the
    // format, so the confirm dialog says so upfront.
    if (/\.midi?$/i.test(file.name)) {
      try {
        const { parseMidiFile } = await import('@/lib/midi-import')
        const { project, report } = await parseMidiFile(file)
        if (report.tracks === 0) {
          window.alert('No notes were found in that MIDI file.')
          return
        }
        const changes = (report.tempoChanges || report.meterChanges)
          ? ` (with ${report.tempoChanges} tempo + ${report.meterChanges} time-signature change${report.tempoChanges + report.meterChanges === 1 ? '' : 's'})`
          : ''
        const summary = [
          `Import “${report.projectName}” from MIDI?`, '',
          `• ${report.tracks} track${report.tracks === 1 ? '' : 's'}, ${report.notes} note${report.notes === 1 ? '' : 's'}`,
          `• ${report.tempo} BPM · ${report.timeSignature}${changes}`,
          ...report.warnings.map(w => `• ${w}`),
        ].join('\n')
        if (window.confirm(summary)) openProjectInStudio(project)
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Could not read that MIDI file.')
      }
      return
    }
    try {
      const cf = JSON.parse(await file.text())
      const dp = cf?.dawProject ?? (Array.isArray(cf?.tracks) ? cf : null)
      if (!dp || !Array.isArray(dp.tracks)) throw new Error('not a project')
      openProjectInStudio(migrateProject(dp))
    } catch {
      window.alert('That doesn’t look like a 100Lights project (.cfproj) or MIDI file (.mid).')
    }
  }
  const [shotBusy, setShotBusy] = useState(false)
  const [shotBlob, setShotBlob] = useState<Blob | null>(null)
  const captureRef = useRef<HTMLDivElement>(null)
  const [tsDraft, setTsDraft] = useState({ num: project.timeSignatureNum, den: project.timeSignatureDen })
  const [varispeed, setVarispeed] = useState(100)  // 25–200 percent
  const [micError, setMicError] = useState('')
  const micA = useAppear(!!micError, 'fade')
  const [showMask, setShowMask] = useState(false)
  // Toolbar overflow (item 14) — the less-used full-tier controls (swing, speed,
  // masking) live in a "More" popover so the bar isn't a wall of sliders.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreA = useAppear(moreOpen, 'pop')
  const uiTier = useUITierOptional()
  const showMore = (uiTier?.tier ?? 'full') === 'full'

  // Inject keyframes for recording pulse + guide blink (once per page)
  useEffect(() => {
    const id = 'daw-anim-styles'
    if (typeof document !== 'undefined' && !document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = [
        '@keyframes dawRecPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }',
        '@keyframes dawBlink { 0%, 100% { box-shadow: 0 0 0 0 rgba(250,204,21,0); } 50% { box-shadow: 0 0 0 3px rgba(250,204,21,0.9); } }',
      ].join('\n')
      document.head.appendChild(style)
    }
  }, [])

  // Close the Capture menu on an outside click or Escape
  useEffect(() => {
    if (!captureOpen) return
    function onDown(e: MouseEvent) {
      if (captureRef.current && !captureRef.current.contains(e.target as Node)) setCaptureOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCaptureOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [captureOpen])

  // Grab a still of the studio, then open the annotator to crop / draw / save.
  async function takeScreenshot() {
    setCaptureOpen(false)
    if (shotBusy) return
    setShotBusy(true)
    try {
      const blob = await captureScreenshot(!isPro)
      if (blob) setShotBlob(blob)   // opens the lazy-loaded annotator
    } catch (err) {
      // A capture that fails used to fail into nothing — an unhandled
      // rejection and a button that seemed dead.
      console.error('[capture] screenshot failed:', err)
      setMicError('Screenshot failed — try again')
    } finally {
      setShotBusy(false)
    }
  }

  // Keep isPlayingRef in sync for the RAF closure
  useEffect(() => { isPlayingRef.current = playing }, [playing])

  // ⚠️ The R key comes through HERE, not straight to the engine. The studio's
  // keydown used to call engine.startRecording() itself, skipping the arm and
  // input guards, the count-in, and the error notice — so R with nothing armed
  // did nothing at all, silently. The one recording flow is this component's.
  useEffect(() => {
    const on = () => { void handleRecord() }
    window.addEventListener('100lights:record-toggle', on)
    return () => window.removeEventListener('100lights:record-toggle', on)
  })

  // The click's sound, rhythm, count-in and only-while-recording all live in
  // the workspace (lib/metronome.ts) — preferences about how you work, not part
  // of the song, since the click is never in the render.
  const metro = useMetronomeSettings()

  // RAF loop — music mode: render beats; podcast mode: render wall-clock time
  useEffect(() => {
    if (audioMode === 'podcast') {
      function podcastFrame(nowMs: number) {
        if (isPlayingRef.current) {
          if (lastFrameRef.current !== undefined) {
            wallSecsRef.current += (nowMs - lastFrameRef.current) / 1000
          }
          lastFrameRef.current = nowMs
        } else {
          lastFrameRef.current = undefined
        }
        if (podcastPosRef.current) {
          podcastPosRef.current.textContent = fmtHMS(wallSecsRef.current)
        }
        rafRef.current = requestAnimationFrame(podcastFrame)
      }
      rafRef.current = requestAnimationFrame(podcastFrame)
    } else {
      const num = project.timeSignatureNum
      function musicFrame() {
        if (posRef.current) {
          // During a count-in the display reads NEGATIVE bars ticking down to
          // the take. Counting up from zero would show 1.1.1 while the song has
          // not started, and the number a player watches to come in on would be
          // the same one they see once they are already late (lib/metronome.ts).
          const c = engine.countInProgress
          posRef.current.textContent =
            (c && countInPosition(c.elapsed, c.total, num)) ?? formatBeat(engine.currentBeat, num)
        }
        rafRef.current = requestAnimationFrame(musicFrame)
      }
      rafRef.current = requestAnimationFrame(musicFrame)
    }
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, project.timeSignatureNum, audioMode])

  // The click's sound, rhythm and only-while-recording live in the workspace
  // (lib/metronome.ts); the engine is told, it never reads them itself.
  useEffect(() => {
    engine.setMetronomeSettings({ sound: metro.sound, rhythm: metro.rhythm, onlyWhileRecording: metro.onlyWhileRecording })
  }, [engine, metro.sound, metro.rhythm, metro.onlyWhileRecording])

  // ── Common handlers ─────────────────────────────────────────────────────────

  function handlePlayStop() {
    if (playing) {
      engine.stop()
    } else {
      engine.play()
    }
  }

  // Record-setup box: monitor the input (with effects) before rolling
  const [recordSetup, setRecordSetup] = useState(false)
  const [monitorOn, setMonitorOn] = useState(false)
  const [recFx, setRecFx] = useState<MonitorFx[]>([])
  const [latencyMs, setLatencyMs] = useState<number>(() => {
    try {
      const s = typeof localStorage !== 'undefined' ? localStorage.getItem('100lights-rec-latency-ms') : null
      if (s !== null) return Number(s)
    } catch { /* ok */ }
    return -1  // -1 = auto
  })
  function commitLatency(v: number) {
    setLatencyMs(v)
    try {
      if (v < 0) localStorage.removeItem('100lights-rec-latency-ms')
      else localStorage.setItem('100lights-rec-latency-ms', String(v))
    } catch { /* ok */ }
  }

  function recordableInput(): string | null {
    const t = project.tracks.find(t => t.type === 'audio' && t.armed && t.inputSource)
    return t?.inputSource ?? null
  }

  function closeRecordSetup() {
    engine.stopMonitor()
    setMonitorOn(false)
    setRecordSetup(false)
  }

  async function toggleMonitor() {
    if (monitorOn) {
      engine.stopMonitor()
      setMonitorOn(false)
      return
    }
    const input = recordableInput()
    if (!input) return
    try {
      await engine.startMonitor(input, recFx)
      setMonitorOn(true)
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Mic permission denied — allow access in system settings'
        : err instanceof Error ? err.message : 'Input access failed'
      setMicError(msg)
      setTimeout(() => setMicError(''), 8000)
    }
  }

  function patchRecFx(next: MonitorFx[]) {
    setRecFx(next)
    engine.updateMonitorFx(next)
  }

  async function startRecordingNow() {
    engine.stopMonitor()
    setMonitorOn(false)
    setRecordSetup(false)
    try {
      if (metro.countInBars > 0) {
        setMicError(`Count-in — ${metro.countInBars} bar${metro.countInBars > 1 ? 's' : ''}…`)
        // The count-in clicks at the tempo of the section the take starts in,
        // not the opening bpm — after a tempo change those differ.
        await engine.countIn(metro.countInBars * project.timeSignatureNum, tempoAt(engine.currentBeat, tempoSegments(project)))
        setMicError('')
      }
      // Punch in / out (lib/punch.ts). With a punch armed the engine drives the
      // recorder off the transport clock; this only opens the inputs and rolls.
      const punch = planPunch(project, engine.currentBeat, project.timeSignatureNum)
      if (punch.refused) {
        setMicError(punch.refused)
        setTimeout(() => setMicError(''), 8000)
        return
      }
      const armedTracks = project.tracks.filter(t => t.type === 'audio' && t.armed && t.inputSource)
      engine.setPendingRecordFx(recFx)
      await Promise.all(armedTracks.map(t => engine.startMicInput(t.id, t.inputSource ?? 'mic')))
      if (punch.startAt != null || punch.stopAt != null) engine.armPunch(punch)
      else engine.disarmPunch()
      if (!playing) engine.play()
      // A punch-in that has not come round yet: the tick starts the take at the
      // brace. Anything else rolls now — including a punch-out on its own.
      if (punch.startAt == null) await engine.startRecording()
      setMicError(punch.startAt != null
        ? `Waiting for bar ${Math.floor(punch.startAt / (project.timeSignatureNum || 4)) + 1} — punching in…`
        : '')
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Mic permission denied — allow access in system settings'
        : err instanceof Error ? err.message : 'Microphone access failed'
      setMicError(msg)
      setTimeout(() => setMicError(''), 12000)
    }
  }

  async function handleRecord() {
    // Armed and waiting for the punch-in bar: pressing record again calls it off,
    // rather than dropping into the setup box behind a take that is about to start.
    if (!recording && engine.punchWaiting) {
      engine.disarmPunch()
      engine.stopAllMicInputs()
      if (playing) engine.stop()
      setMicError('')
      return
    }
    if (recording) {
      if (playing) engine.stop()
      engine.disarmPunch()
      await engine.stopRecording()
    } else if (recordSetup) {
      closeRecordSetup()
    } else {
      const audioTracks = project.tracks.filter(t => t.type === 'audio')
      const armedTracks = audioTracks.filter(t => t.armed)

      // No tracks at all → blink the +Track button
      if (project.tracks.length === 0) {
        triggerBlink(['add-track'])
        return
      }

      // Tracks exist but none armed → blink all arm buttons
      if (armedTracks.length === 0) {
        const inputTracks = audioTracks.filter(t => t.inputSource)
        triggerBlink(
          (inputTracks.length > 0 ? inputTracks : audioTracks).map(t => `arm:${t.id}`)
        )
        setMicError(inputTracks.length > 0
          ? `Arm a track to record — click ● on "${inputTracks[0].name}"`
          : 'Arm a track to record — click ● on a track')
        setTimeout(() => setMicError(''), 5000)
        return
      }

      // Every armed track lacks an input → nothing can actually record.
      // Blink the input pickers and stay stopped instead of rolling.
      const armedWithoutInput = armedTracks.filter(t => !t.inputSource)
      if (armedWithoutInput.length === armedTracks.length) {
        triggerBlink(armedWithoutInput.map(t => `input:${t.id}`))
        setMicError('Pick an input on an armed track first — click its input selector')
        setTimeout(() => setMicError(''), 5000)
        return
      }

      // Guards pass — open the setup box: test the sound, add effects,
      // then start the take from there.
      setRecordSetup(true)
    }
  }

  const armedReady = project.tracks.filter(t => t.type === 'audio' && t.armed && t.inputSource)
  const recordSetupPanel = recordSetup && typeof document !== 'undefined' ? createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) closeRecordSetup() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', width: 'min(400px,92vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>● Record — set your sound</span>
          <button onClick={closeRecordSetup} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          Recording to: {armedReady.map(t => t.name).join(', ') || '—'}. Toggle the monitor to hear yourself with the effects before the take.
        </p>

        <button
          onClick={() => void toggleMonitor()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            padding: '9px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
            border: monitorOn ? '1px solid rgba(34,197,94,0.6)' : '1px solid #2e2e2e',
            background: monitorOn ? 'rgba(34,197,94,0.14)' : '#1e1e1e',
            color: monitorOn ? '#4ade80' : 'var(--text-secondary)',
          }}
        >
          <Headphones size={14} /> Monitor {monitorOn ? 'ON — you should hear yourself' : 'off'}
        </button>
        <p style={{ fontSize: 9, color: 'var(--text-muted)', margin: '-4px 0 0', lineHeight: 1.4 }}>
          Use wired headphones for the tightest monitoring — Bluetooth adds delay no software can remove.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>EFFECTS ON THE TAKE</span>
            <select
              value=""
              onChange={e => {
                const type = e.target.value as MonitorFx['type']
                if (!type) return
                patchRecFx([...recFx, { type, value: REC_FX_DEFS[type].def }])
              }}
              style={{ fontSize: 10, padding: '2px 5px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <option value="">+ Add effect</option>
              {(Object.keys(REC_FX_DEFS) as MonitorFx['type'][]).map(t => <option key={t} value={t}>{REC_FX_DEFS[t].label}</option>)}
            </select>
          </div>
          {recFx.length === 0 && (
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              None yet — the take records clean. Anything you add here is heard in the monitor and lands as FX bars under the recording.
            </p>
          )}
          {recFx.map((fx, i) => {
            const def = REC_FX_DEFS[fx.type]
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 62, flexShrink: 0 }}>{def.label}</span>
                <Knob
                  value={fx.value} min={def.min} max={def.max} defaultValue={fx.value} size={26} color="#dc2626"
                  spec={{ label: `Record ${def.label}`, min: def.min, max: def.max }}
                  bipolar={def.min < 0 && def.max > 0}
                  onChange={v => patchRecFx(recFx.map((f, j) => j === i ? { ...f, value: v } : f))}
                  format={def.fmt}
                />
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 9.5, color: 'var(--text-primary)', width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{def.fmt(fx.value)}</span>
                <button onClick={() => patchRecFx(recFx.filter((_, j) => j !== i))} aria-label="Remove effect"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={12} /></button>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 62, flexShrink: 0 }}>Timing</span>
          <Knob
            value={latencyMs} min={-1} max={250} defaultValue={-1} size={26} color="#dc2626"
            spec={{ label: 'Recording latency', min: -1, max: 250, unit: 'ms' }}
            onChange={v => commitLatency(Math.round(v))}
            format={v => (v < 0 ? 'auto' : `${Math.round(v)}ms`)}
          />
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 9.5, color: 'var(--text-primary)', width: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {latencyMs < 0 ? `auto ${Math.round(engine.recordLatencySec() * 1000)}ms` : `${latencyMs}ms`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Count-in</span>
          {[0, 1, 2, 4].map(b => (
            <button key={b} data-help-id={b === 0 ? 'count-in' : undefined} onClick={() => setMetronomeSettings({ countInBars: b })}
              style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontWeight: 700,
                border: metro.countInBars === b ? '1px solid rgba(220,38,38,0.6)' : '1px solid #2e2e2e',
                background: metro.countInBars === b ? 'rgba(220,38,38,0.14)' : '#1e1e1e',
                color: metro.countInBars === b ? '#f87171' : 'var(--text-muted)',
              }}
            >{b === 0 ? 'Off' : `${b} bar${b > 1 ? 's' : ''}`}</button>
          ))}
        </div>

        {/* Record Quantization (lib/record-quantize.ts) — the grid a take lands
            on as it is played. Only note starts move; the lengths are kept. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Quantize as played</span>
          <select
            data-help-id="record-quantize"
            aria-label="Record quantization"
            value={project.recordQuantize ?? DEFAULT_RECORD_GRID}
            title={`Recorded notes land on this grid as you play them. Only the starts move — the lengths are kept exactly as held. Now: ${recordGridLabel(project.recordQuantize)}.`}
            onChange={e => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: e.target.value as RecordGrid })}
            style={{ fontSize: 10, padding: '3px 6px', borderRadius: 5, background: '#1e1e1e', color: 'var(--text-primary)', border: '1px solid #2e2e2e', cursor: 'pointer' }}
          >
            {RECORD_GRIDS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={closeRecordSetup}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
            Cancel
          </button>
          <button onClick={() => void startRecordingNow()}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Circle size={13} fill="currentColor" /> Start recording
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  function handleRewind() {
    engine.seek(0)
    setPosition(0)
  }

  function handlePodcastRewind() {
    engine.seek(0)
    setPosition(0)
    wallSecsRef.current = 0
    lastFrameRef.current = undefined
  }

  function handleLoopToggle() {
    if (project.loopEnabled) {
      dispatch({ type: 'SET_LOOP_ENABLED', enabled: false })
      setLoopToolArmed(false)
      return
    }
    // Arm the loop tool — the region appears once you drag it across the
    // ruler or the track lanes. Double-click loops the whole project instead.
    setLoopToolArmed(!loopToolArmed)
  }

  function handleLoopFullSpan() {
    const clips = project.arrangementClips
    if (clips.length === 0) return
    const start = Math.min(...clips.map(c => c.startBeat))
    const end   = Math.max(...clips.map(c => c.startBeat + c.durationBeats))
    dispatch({ type: 'SET_LOOP', start, end })
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: true })
    setLoopToolArmed(false)
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })
    engine.setMasterVolume(parseFloat(e.target.value))
  }

  // ── Palette commands owned by the transport ─────────────────────────────────
  //
  // These are registered HERE rather than centrally in AudioEditor because each
  // one needs something only this component has. Recording is a flow — mic
  // permission, count-in, the guards that blink at the arm button you forgot —
  // and a second copy of it in the palette would be a second copy that drifts
  // out of step. Looping has to disarm the loop tool as well as clear the flag.
  // The rule this follows: if the palette cannot reach an action without
  // reimplementing it, the component that owns the action registers it.
  useRegisterCommands([
    { id: 'transport.record', group: 'Transport', label: recording ? 'Stop recording' : 'Record a take',
      keywords: 'mic input arm capture take microphone sing play in overdub',
      run: () => { void handleRecord() } },
    { id: 'transport.loop', group: 'Transport', label: project.loopEnabled ? 'Turn looping off' : 'Turn looping on',
      keywords: 'cycle repeat region brace loop',
      run: handleLoopToggle },
    { id: 'transport.loopAll', group: 'Transport', label: 'Loop the whole song',
      keywords: 'cycle everything full span entire repeat',
      when: () => project.arrangementClips.length > 0,
      run: handleLoopFullSpan },
    // Punch in / out (lib/punch.ts) — the recorder starting and stopping at the
    // loop brace by itself, so a fix in the middle of a take cannot eat what is
    // either side of it.
    { id: 'transport.punchIn', group: 'Transport', label: project.punchIn ? 'Punch in off — record as soon as you press record' : 'Punch in — start recording at the loop brace',
      keywords: 'punch in record start brace loop drop fix overdub replace',
      run: () => dispatch({ type: 'SET_PUNCH', punchIn: !project.punchIn }) },
    { id: 'transport.punchOut', group: 'Transport', label: project.punchOut ? 'Punch out off — record until you press stop' : 'Punch out — stop recording at the end of the loop brace',
      keywords: 'punch out record stop brace loop end fix overdub replace',
      run: () => dispatch({ type: 'SET_PUNCH', punchOut: !project.punchOut }) },
    // Record Quantization (lib/record-quantize.ts) — the grid a take lands on
    // as it is played.
    //
    // ⚠️ Spelled out one command per grid rather than mapped over the list, for
    // the same reason as the crossfader curves below: the discoverability check
    // reads these labels literally out of the source, and a label built by
    // interpolation is a label it cannot see. It is also what a person wants —
    // you pick a grid, you do not step through nine.
    { id: 'transport.recordQuantize.none', group: 'Transport', label: 'Record quantization: None — takes keep their own timing',
      keywords: 'record quantization quantize grid snap timing as played input off none straight', when: () => (project.recordQuantize ?? DEFAULT_RECORD_GRID) !== 'none',
      run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'none' }) },
    { id: 'transport.recordQuantize.quarter', group: 'Transport', label: 'Record quantization: 1/4 — notes land on the beat as you play',
      keywords: 'record quantization quantize grid snap timing as played input quarter beat', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'quarter' }) },
    { id: 'transport.recordQuantize.eighth', group: 'Transport', label: 'Record quantization: 1/8 — notes land on eighths as you play',
      keywords: 'record quantization quantize grid snap timing as played input eighth 8th', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'eighth' }) },
    { id: 'transport.recordQuantize.eighthT', group: 'Transport', label: 'Record quantization: 1/8 triplets — notes land on eighth triplets',
      keywords: 'record quantization quantize grid snap timing as played input eighth triplet swing', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'eighthT' }) },
    { id: 'transport.recordQuantize.eighthBoth', group: 'Transport', label: 'Record quantization: 1/8 and 1/8T — whichever line is nearer',
      keywords: 'record quantization quantize grid snap timing as played input eighth triplet both straight nearer', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'eighthBoth' }) },
    { id: 'transport.recordQuantize.sixteenth', group: 'Transport', label: 'Record quantization: 1/16 — notes land on sixteenths as you play',
      keywords: 'record quantization quantize grid snap timing as played input sixteenth 16th', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'sixteenth' }) },
    { id: 'transport.recordQuantize.sixteenthT', group: 'Transport', label: 'Record quantization: 1/16 triplets — notes land on sixteenth triplets',
      keywords: 'record quantization quantize grid snap timing as played input sixteenth triplet', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'sixteenthT' }) },
    { id: 'transport.recordQuantize.sixteenthBoth', group: 'Transport', label: 'Record quantization: 1/16 and 1/16T — whichever line is nearer',
      keywords: 'record quantization quantize grid snap timing as played input sixteenth triplet both straight nearer', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'sixteenthBoth' }) },
    { id: 'transport.recordQuantize.thirtysecond', group: 'Transport', label: 'Record quantization: 1/32 — notes land on thirty-seconds',
      keywords: 'record quantization quantize grid snap timing as played input thirty-second 32nd', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'thirtysecond' }) },
    { id: 'transport.recordQuantize.half', group: 'Transport', label: 'Record quantization: 1/2 — notes land on half notes',
      keywords: 'record quantization quantize grid snap timing as played input half two beats', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'half' }) },
    { id: 'transport.recordQuantize.whole', group: 'Transport', label: 'Record quantization: 1/1 — notes land on the bar',
      keywords: 'record quantization quantize grid snap timing as played input whole bar', run: () => dispatch({ type: 'SET_RECORD_QUANTIZE', grid: 'whole' }) },
    // The click's sound and rhythm (lib/metronome.ts). Behind a right-click on
    // the metronome button, which nobody discovers, so they are spelled out
    // here — one per sound, for the same reason as the grids above.
    { id: 'transport.click.click', group: 'Transport', label: 'Metronome sound: Click — a short high ping', keywords: 'metronome click sound tick tone ping cut through', run: () => setMetronomeSettings({ sound: 'click' }) },
    { id: 'transport.click.beep', group: 'Transport', label: 'Metronome sound: Beep — the most audible, the least pleasant', keywords: 'metronome click sound beep tone loud audible', run: () => setMetronomeSettings({ sound: 'beep' }) },
    { id: 'transport.click.stick', group: 'Transport', label: 'Metronome sound: Stick — broadband, survives a busy mix', keywords: 'metronome click sound stick sticks crack noise busy mix', run: () => setMetronomeSettings({ sound: 'stick' }) },
    { id: 'transport.click.wood', group: 'Transport', label: 'Metronome sound: Wood — a wood block, easy over long sessions', keywords: 'metronome click sound wood block dry mid', run: () => setMetronomeSettings({ sound: 'wood' }) },
    { id: 'transport.click.cowbell', group: 'Transport', label: 'Metronome sound: Cowbell — metallic, sits above a kit', keywords: 'metronome click sound cowbell metallic bell drums', run: () => setMetronomeSettings({ sound: 'cowbell' }) },
    { id: 'transport.click.rimshot', group: 'Transport', label: 'Metronome sound: Rimshot — a crack with body under it', keywords: 'metronome click sound rimshot rim crack snare', run: () => setMetronomeSettings({ sound: 'rimshot' }) },
    ...CLICK_RHYTHMS.filter(r => r.id !== metro.rhythm).map(r => ({
      id: `transport.clickRhythm.${r.id}`, group: 'Transport',
      label: r.id === 'auto' ? 'Metronome rhythm: Auto — subdivides when the beat is far apart' : `Metronome rhythm: ${r.label}`,
      keywords: `metronome click rhythm how often subdivision grid ${r.label.toLowerCase()}`,
      run: () => setMetronomeSettings({ rhythm: r.id }),
    })),
    { id: 'transport.clickOnlyRecording', group: 'Transport',
      label: metro.onlyWhileRecording ? 'Metronome on for playback too' : 'Metronome only while recording',
      keywords: 'metronome click only while recording takes playback silent enable',
      run: () => setMetronomeSettings({ onlyWhileRecording: !metro.onlyWhileRecording }) },
    // Count-in is four unlabelled number buttons inside the record setup box —
    // you cannot find it unless you are already recording.
    ...[0, 1, 2, 4].filter(b => b !== metro.countInBars).map(b => ({
      id: `transport.countin.${b}`, group: 'Transport',
      label: b === 0 ? 'No count-in before recording' : `Count in ${b} bar${b > 1 ? 's' : ''} before recording`,
      keywords: 'countin count in lead pre roll click bars metronome record',
      run: () => setMetronomeSettings({ countInBars: b }),
    })),
    // Tempo goes through applyTempo because a project with tempo markers must
    // retempo the segment under the playhead, not stamp one global BPM over a
    // map somebody built deliberately. Swing has to reach the live engine too —
    // dispatching alone stores the value and changes nothing you can hear.
    { id: 'transport.tempo', group: 'Project', label: `Change the tempo (now ${project.tempo} BPM)`,
      keywords: 'bpm tempo speed faster slower pace',
      run: () => {
        const v = window.prompt('Tempo in BPM', String(project.tempo))
        const n = v ? Number(v) : NaN
        if (Number.isFinite(n) && n >= 20 && n <= 300) applyTempo(n)
      } },
    { id: 'transport.swing', group: 'Project', label: `Change the swing (now ${Math.round((project.swing ?? 0) * 100)}%)`,
      keywords: 'swing groove shuffle feel laid back timing straight',
      run: () => {
        const v = window.prompt('Swing, 0 to 50%', String(Math.round((project.swing ?? 0) * 100)))
        const n = v ? Number(v) : NaN
        if (!Number.isFinite(n) || n < 0 || n > 50) return
        const swing = n / 100
        dispatch({ type: 'SET_SWING', swing })
        engine.swing = swing
      } },
    // Master volume, like swing, has to reach the engine as well as the project.
    { id: 'transport.master', group: 'Project', label: `Set the master volume (now ${Math.round((project.masterVolume ?? 1) * 100)}%)`,
      keywords: 'master volume output level overall loudness main',
      run: () => {
        const v = window.prompt('Master volume, 0 to 100%', String(Math.round((project.masterVolume ?? 1) * 100)))
        const n = v ? Number(v) : NaN
        if (!Number.isFinite(n) || n < 0 || n > 100) return
        dispatch({ type: 'SET_MASTER_VOLUME', volume: n / 100 })
        engine.setMasterVolume(n / 100)
      } },
    { id: 'transport.screenrec', group: 'Share', label: 'Record the screen',
      keywords: 'capture video clip screencast demo share timelapse',
      run: () => { setRecorderMode('screen'); setShowRecorder(true) } },
    { id: 'transport.historyrec', group: 'Share', label: 'Record how this project gets built',
      keywords: 'history timelapse replay capture session process',
      run: () => { setRecorderMode('history'); setShowRecorder(true) } },
  ], [recording, project.loopEnabled, project.arrangementClips.length, project.tempo, project.swing, metro.countInBars, loopToolArmed, project.punchIn, project.punchOut, project.recordQuantize, metro.rhythm, metro.onlyWhileRecording])

  // ── Music-only handlers ─────────────────────────────────────────────────────

  function applyTempo(n: number) {
    const markers = project.tempoMarkers ?? []
    if (markers.length === 0) {
      // No tempo map: a plain global tempo change. SET_TEMPO also rescales
      // non-warped audio clips so they keep their absolute (second) length.
      dispatch({ type: 'SET_TEMPO', tempo: n })
      return
    }
    // Tempo map in play: retempo only the segment the playhead sits in — leave the
    // other sections (and audio-clip geometry) alone. Keep the global tempo in sync
    // when editing the opening (beat-0) segment so the transport read-out matches.
    const beat = engine.currentBeat
    const active = [...markers].filter(m => m.beat <= beat + 0.001).sort((a, b) => b.beat - a.beat)[0] ?? markers[0]
    dispatch({ type: 'UPDATE_TEMPO_MARKER', markerId: active.id, tempo: n })
    if (active.beat < 0.01) dispatch({ type: 'PATCH_PROJECT', patch: { tempo: Math.max(40, Math.min(300, n)) } })
  }

  function handleBpmCommit(value: string) {
    const n = parseFloat(value)
    // Commit only a real number; clamp to the app's tempo range (40–300).
    // Invalid/empty input reverts (the readout falls back to the current tempo).
    if (Number.isFinite(n)) applyTempo(clampBpm(n))
    setEditingBpm(false)
  }

  function handleTap() {
    const bpm = engine.tap()
    if (bpm !== null) applyTempo(bpm)
  }

  function handleMetronomeToggle() {
    const next = !metronome
    setMetronome(next)
    engine.setMetronome(next)
  }

  function handleTimeSigCommit() {
    dispatch({ type: 'SET_TIME_SIG', num: tsDraft.num, den: tsDraft.den })
    setEditingTimeSig(false)
  }

  function handleCapture() {
    const blob = engine.captureJam(30)
    if (!blob) {
      setMicError('No buffer yet — press Play first to fill the jam buffer')
      setTimeout(() => setMicError(''), 3000)
      return
    }
    const audioTracks = project.tracks.filter(t => t.type === 'audio')
    if (audioTracks.length === 0) {
      setMicError('Add an audio track to capture to')
      setTimeout(() => setMicError(''), 3000)
      return
    }
    const target = audioTracks.find(t => t.armed) ?? audioTracks[0]
    const url = URL.createObjectURL(blob)
    const durationBeats = 30 * (project.tempo / 60)
    const startBeat = Math.max(0, engine.currentBeat - durationBeats)
    const clip = makeAudioClip(target.id, 'Jam Capture', startBeat, durationBeats, { audioUrl: url })
    dispatch({ type: 'ADD_CLIP', clip })
    void uploadRecordingBlob(blob, clip.id).then(key => {
      if (key) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } })
    })
  }

  // ── Podcast-only handlers ───────────────────────────────────────────────────

  const voiceTracks = project.tracks.filter(t => t.type === 'audio' && t.name !== 'Music Bed')
  const allVoiceArmed = voiceTracks.length > 0 && voiceTracks.every(t => t.armed)

  function handleRecAllVoice() {
    const arm = !allVoiceArmed
    for (const t of voiceTracks) {
      dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { armed: arm } })
    }
  }

  // ── Style objects ───────────────────────────────────────────────────────────

  // Apollo grammar: 26px square, 5px radius, quiet until engaged.
  const base: React.CSSProperties = { ...apIcon }

  // Auto-contrast (--accent-contrast) keeps the icon legible on any accent.
  const active: React.CSSProperties = { ...apIconOn }

  const divider: React.CSSProperties = { ...apDivider }

  const monoDisplay: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '3px 8px',
    lineHeight: 1.4,
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--accent)',
    borderRadius: 3,
    color: 'var(--text-primary)',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    textAlign: 'center',
    padding: '2px 4px',
  }

  const wrapStyle: React.CSSProperties = {
    height: 48,
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    paddingLeft: padTrafficLights ? 80 : 10,
    paddingRight: 10,
    flexShrink: 0,
  }

  const wrapClass = 'electron-drag-container'

  // ── Podcast transport ───────────────────────────────────────────────────────

  if (audioMode === 'podcast') {
    return (
      <div style={wrapStyle} className={wrapClass}>
        {recordSetupPanel}
        {/* Transport controls */}
        <button style={base} onClick={handlePodcastRewind} title="Rewind to start" data-help-id="rewind">
          <SkipBack size={13} />
        </button>

        <button
          className={playing ? 'transport-live' : undefined}
          style={playing ? active : base}
          onClick={handlePlayStop}
          title="Play / Stop (Space)"
          data-help-id="play"
        >
          {playing
            ? <Square size={11} fill="currentColor" />
            : <Play size={13} fill="currentColor" />
          }
        </button>

        <button
          style={{
            ...base,
            color: recording ? '#ff3b3b' : 'var(--text-secondary)',
            border: recording ? '1px solid #ff3b3b' : '1px solid var(--border)',
            background: recording ? 'rgba(255,59,59,0.14)' : '#1e1e1e',
            animation: recording ? 'dawRecPulse 1s infinite' : undefined,
          }}
          onClick={handleRecord}
          title="Record (R)"
          data-help-id="record"
        >
          <Circle size={11} fill={recording ? '#ff3b3b' : 'transparent'} color={recording ? '#ff3b3b' : 'currentColor'} />
        </button>

        {micA.mounted && (
          <span className={micA.cls} style={{ fontSize: 9, color: '#ff3b3b', maxWidth: 140, lineHeight: 1.2 }}>{micError}</span>
        )}

        <button
          style={project.loopEnabled ? active : loopToolArmed ? { ...base, border: '1px solid rgb(var(--accent-rgb) / 0.7)', color: 'var(--accent-light)' } : base}
          onClick={handleLoopToggle}
          onDoubleClick={handleLoopFullSpan}
          title="Loop — click, then drag across the timeline to set the region. Double-click to loop the whole project."
          data-help-id="loop"
        >
          <Repeat size={13} />
        </button>

        <div style={divider} />

        {/* HH:MM:SS position */}
        <div style={{
          ...monoDisplay,
          cursor: 'default',
          fontSize: 14,
          letterSpacing: '0.06em',
          minWidth: 88,
          textAlign: 'center',
          padding: '3px 10px',
          userSelect: 'none',
        }}>
          <span ref={podcastPosRef}>00:00:00</span>
        </div>

        <div style={divider} />

        {/* Arm all voice tracks */}
        <button
          onClick={handleRecAllVoice}
          title="Arm / disarm all voice tracks for recording"
          data-help-id="rec-all-voice"
          style={{
            ...base,
            width: 'auto',
            padding: '0 10px',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: '0.06em',
            background: allVoiceArmed ? 'rgba(239,68,68,0.15)' : '#1e1e1e',
            border: allVoiceArmed ? '1px solid #ef4444' : '1px solid var(--border)',
            color: allVoiceArmed ? '#ef4444' : 'var(--text-secondary)',
          }}
        >
          REC ALL VOICE
        </button>

        <div style={{ flex: 1 }} />

        {/* Master volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} data-help-id="master-volume">
          <Volume2 size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <Knob
            value={project.masterVolume} min={0} max={1} defaultValue={0.85} size={26}
            spec={{ label: 'Master volume', min: 0, max: 1, unit: '%' }}
            onChange={v => { dispatch({ type: 'SET_MASTER_VOLUME', volume: v }); engine.setMasterVolume(v) }}
            format={v => `${Math.round(v * 100)}%`}
          />
        </div>
      </div>
    )
  }

  // ── Music transport (original) ──────────────────────────────────────────────

  return (
    <div style={wrapStyle} className={wrapClass}>
      {recordSetupPanel}
      {/* Editable project title — click to rename (updates the name + URL slug) */}
      {editingName ? (
        <input
          autoFocus
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onBlur={commitProjectName}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') commitProjectName()
            else if (e.key === 'Escape') { setNameInput(project.name); setEditingName(false) }
          }}
          aria-label="Project name"
          style={{ ...inputStyle, textAlign: 'left', width: 160, fontSize: 13 }}
        />
      ) : (
        <button
          onClick={() => { setNameInput(project.name); setEditingName(true) }}
          title="Rename project"
          style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'text', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 4px', flexShrink: 1, textAlign: 'left' }}
        >
          {project.name || 'Untitled'}
        </button>
      )}
      <div style={divider} />
      {/* Transport controls */}
      <button style={base} onClick={handleRewind} title="Rewind to start" data-help-id="rewind">
        <SkipBack size={13} />
      </button>

      <button
        style={playing ? active : base}
        onClick={handlePlayStop}
        title="Play / Stop (Space)"
        data-help-id="play"
      >
        {playing
          ? <Square size={11} fill="currentColor" />
          : <Play size={13} fill="currentColor" />
        }
      </button>

      <button
        style={{
          ...base,
          color: recording ? '#ff3b3b' : 'var(--text-secondary)',
          border: recording ? '1px solid #ff3b3b' : '1px solid var(--border)',
          background: recording ? 'rgba(255,59,59,0.14)' : '#1e1e1e',
          animation: recording ? 'dawRecPulse 1s infinite' : undefined,
        }}
        onClick={handleRecord}
        title="Record (R)"
        data-help-id="record"
      >
        <Circle size={11} fill={recording ? '#ff3b3b' : 'transparent'} color={recording ? '#ff3b3b' : 'currentColor'} />
      </button>

      <button
        onClick={handleCapture}
        title="Capture last 30s from jam buffer (starts on first Play)"
        data-help-id="jam"
        style={{
          ...base,
          width: 'auto', padding: '0 8px',
          fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em',
          color: engine.isJamActive ? 'var(--accent-light)' : 'var(--text-muted)',
          border: engine.isJamActive ? '1px solid rgb(var(--accent-rgb) / 0.4)' : '1px solid var(--border)',
          background: engine.isJamActive ? 'rgb(var(--accent-rgb) / 0.08)' : '#1e1e1e',
        }}
      >
        JAM
      </button>

      {micError && (
        <span
          title={micError}
          style={{ fontSize: 9, color: '#ff3b3b', maxWidth: 260, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
        >{micError}</span>
      )}

      <button
        style={project.loopEnabled ? active : loopToolArmed ? { ...base, border: '1px solid rgb(var(--accent-rgb) / 0.7)', color: 'var(--accent-light)' } : base}
        onClick={handleLoopToggle}
        onDoubleClick={handleLoopFullSpan}
        title="Loop — click, then drag across the timeline to set the region. Double-click to loop the whole project."
        data-help-id="loop"
      >
        <Repeat size={13} />
      </button>

      {/* Punch in / out — recording that starts and stops at the loop brace by
          itself, so a fix in the middle of a take never risks what is either
          side of it (lib/punch.ts). */}
      <button
        style={project.punchIn ? active : base}
        onClick={() => dispatch({ type: 'SET_PUNCH', punchIn: !project.punchIn })}
        title={`Punch in — the recorder waits for the start of the loop brace. ${describePunch(project, project.timeSignatureNum)}.`}
        data-help-id="punch-in"
        aria-pressed={Boolean(project.punchIn)}
      >
        <LogIn size={13} />
      </button>
      <button
        style={project.punchOut ? active : base}
        onClick={() => dispatch({ type: 'SET_PUNCH', punchOut: !project.punchOut })}
        title={`Punch out — the recorder stops at the end of the loop brace. ${describePunch(project, project.timeSignatureNum)}.`}
        data-help-id="punch-out"
        aria-pressed={Boolean(project.punchOut)}
      >
        <LogOut size={13} />
      </button>

      {/* Performance FX — parity with the mobile ⚡ hold-FX */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setFxOpen(o => !o)} style={fxOpen ? active : base} title="Performance FX — hold a pad to sweep the master" data-help-id="perf-fx">
          <Zap size={15} />
        </button>
        {fxA.mounted && (
          <div className={fxA.cls} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, display: 'flex', gap: 5, padding: 6, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 1000, boxShadow: '0 6px 20px rgba(0,0,0,0.5)' }}>
            <FxPad label="LPF" mode="lp" engine={engine} color="#8b5cf6" />
            <FxPad label="HPF" mode="hp" engine={engine} color="#3b82f6" />
            <FxPad label="DUCK" mode="duck" engine={engine} color="#f59e0b" />
          </div>
        )}
      </div>

      <div style={divider} />

      {/* Position */}
      <div style={{
        ...monoDisplay,
        cursor: 'default',
        fontSize: 14,
        letterSpacing: '0.04em',
        minWidth: 78,
        textAlign: 'center',
        padding: '3px 8px',
        userSelect: 'none',
      }}>
        <span ref={posRef}>1.1.1</span>
      </div>

      <div style={divider} />

      {/* BPM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }} data-help-id="bpm">
        {tempoSegments(project).length > 1 ? (
          // Multiple tempos (a tempo map is in play): the single field becomes a
          // per-section dropdown so each section's BPM is editable in one place.
          <BpmSectionMenu project={project} dispatch={dispatch} engine={engine} monoDisplay={monoDisplay} inputStyle={inputStyle} />
        ) : editingBpm ? (
          <input
            autoFocus
            type="number"
            min={40}
            max={300}
            value={bpmDraft}
            onChange={e => setBpmDraft(e.target.value)}
            onFocus={e => e.currentTarget.select()}
            onBlur={() => handleBpmCommit(bpmDraft)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleBpmCommit(bpmDraft)
              if (e.key === 'Escape') setEditingBpm(false)
              e.stopPropagation()
            }}
            style={{ ...inputStyle, width: 52 }}
          />
        ) : (
          <button
            onClick={() => { setBpmDraft(String(project.tempo)); setEditingBpm(true) }}
            style={{ ...monoDisplay, minWidth: 52, textAlign: 'center' }}
            title="Click to edit BPM"
          >
            {project.tempo}
          </button>
        )}
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', userSelect: 'none' }}>BPM</span>
        <button
          onClick={handleTap}
          data-ui-el="tap-tempo"
          style={{ ...base, width: 'auto', padding: '0 7px', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em' }}
          title="Tap tempo"
        >
          TAP
        </button>
      </div>

      {/* Time signature */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} data-help-id="time-sig">
        {editingTimeSig ? (
          <>
            <input
              autoFocus
              type="number"
              min={1}
              max={16}
              value={tsDraft.num}
              onChange={e => setTsDraft(d => ({ ...d, num: Math.max(1, parseInt(e.target.value) || d.num) }))}
              onBlur={handleTimeSigCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleTimeSigCommit(); e.stopPropagation() }}
              style={{ ...inputStyle, width: 28 }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/</span>
            <input
              type="number"
              min={1}
              max={16}
              value={tsDraft.den}
              onChange={e => setTsDraft(d => ({ ...d, den: Math.max(1, parseInt(e.target.value) || d.den) }))}
              onBlur={handleTimeSigCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleTimeSigCommit(); e.stopPropagation() }}
              style={{ ...inputStyle, width: 28 }}
            />
          </>
        ) : (
          <button
            onClick={() => {
              setTsDraft({ num: project.timeSignatureNum, den: project.timeSignatureDen })
              setEditingTimeSig(true)
            }}
            style={{ ...monoDisplay, fontSize: 12, padding: '3px 8px' }}
            title="Click to edit time signature"
          >
            {project.timeSignatureNum}/{project.timeSignatureDen}
          </button>
        )}
      </div>

      <div style={divider} />

      {/* The instrument for whatever track is selected. Apollo sits at the top
          of this menu — it is Beacon's built-in instrument plugin, not a rival
          category — and everything the plugin registry knows about follows it,
          ending in "Add Plugin…" for the player's own.

          Opening Apollo is unchanged: a non-modal window that follows the
          selection, so you can leave it up and keep picking sounds in Beacon. */}
      <PluginMenu
        instrType={pluginTrack?.instrument?.type}
        instrument={pluginTrack?.instrument}
        fallbackLabel={'\u2600 APOLLO'}
        buttonStyle={{ ...base, width: 'auto', padding: '0 9px', fontSize: 10, fontWeight: 800, letterSpacing: 0.4 }}
        onPickApollo={() => setApolloRack({ trackId: ensurePluginTrack(), seed: null, follow: true })}
        onPickPlugin={d => {
          dispatch({
            type: 'SET_INSTRUMENT', trackId: ensurePluginTrack(),
            instrument: { type: 'plugin', params: { pluginId: d.id, values: {}, displayName: d.name } },
          })
        }}
      />

      {/* Say what you want done. Hold (or toggle) and speak — "loop bass 2
          three more times". Next to the plugin menu because both answer the
          same question: what is making this sound, and what should it do. */}
      <div ref={setLightSlot} style={{ display: 'inline-flex', alignItems: 'center' }} />

      {/* Admin-only tools. Renders nothing for anyone else, so it costs the
          toolbar no space for normal users. */}
      <AdminMenu />

      <div style={divider} />

      {/* Re-enable automation — only visible while some lane is overridden by a
          hand-moved control (Ableton's amber button). Clicking hands playback
          back to the written curves. */}
      {project.automationLanes.some(l => l.overridden) && (
        <button
          style={{ ...active, background: '#e0a03a', color: '#20160a' }}
          onClick={() => dispatch({ type: 'REENABLE_ALL_AUTOMATION' })}
          title="Automation was overridden by hand - click to follow the written curves again"
        >
          <RotateCcw size={14} />
        </button>
      )}

      {/* Metronome. Right-click opens what it sounds like and how often — the
          click has to cut through what you are playing, and which sound does
          that depends entirely on the music (lib/metronome.ts). */}
      <div style={{ position: 'relative' }}>
        <button
          style={metronome ? active : base}
          onClick={handleMetronomeToggle}
          onContextMenu={e => { e.preventDefault(); setMetroMenu(o => !o) }}
          title={`Toggle metronome (M). Right-click for the click's sound and rhythm — ${describeMetronome(metro)}.`}
          aria-pressed={metronome}
          data-help-id="metronome"
        >
          <TbMetronome size={15} />
        </button>
        {metroA.mounted && (
          <div className={metroA.cls} data-help-id="metronome-settings"
            style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, padding: 10, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 1000, boxShadow: '0 6px 20px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 46 }}>Sound</span>
              <select value={metro.sound} aria-label="Metronome sound" data-help-id="metronome-sound"
                title={CLICK_SOUNDS.find(x => x.id === metro.sound)?.hint}
                onChange={e => setMetronomeSettings({ sound: e.target.value as ClickSound })}
                style={{ flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 5, background: '#1e1e1e', color: 'var(--text-primary)', border: '1px solid #2e2e2e', cursor: 'pointer' }}>
                {CLICK_SOUNDS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 46 }}>Rhythm</span>
              <select value={metro.rhythm} aria-label="Metronome rhythm" data-help-id="metronome-rhythm"
                title="Auto subdivides when the beat is too far apart to play to, and thins out when it would be a buzz."
                onChange={e => setMetronomeSettings({ rhythm: e.target.value as ClickRhythm })}
                style={{ flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 5, background: '#1e1e1e', color: 'var(--text-primary)', border: '1px solid #2e2e2e', cursor: 'pointer' }}>
                {CLICK_RHYTHMS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={metro.onlyWhileRecording} data-help-id="metronome-only-recording"
                onChange={e => setMetronomeSettings({ onlyWhileRecording: e.target.checked })} />
              Only while recording
            </label>
          </div>
        )}
      </div>

      {showMore && <div style={divider} />}

      {/* More (item 14) — swing, tape speed, and the masking detector fold into
          one popover so the bar isn't a wall of sliders. Full tier only (these
          are all full-tier controls); frequent tools stay one click away. */}
      {showMore && (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setMoreOpen(o => !o)}
            title="More — swing, tape speed, masking"
            style={{ ...base, width: 'auto', padding: '0 9px', gap: 3, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', background: moreOpen ? 'var(--accent-subtle)' : '#1e1e1e', border: moreOpen ? '1px solid var(--accent)' : '1px solid var(--border)', color: moreOpen ? 'var(--accent-light)' : 'var(--text-secondary)' }}
          >More<ChevronDown size={11} /></button>
          {moreA.mounted && (
            <>
              <div onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1400 }} />
              <div className={moreA.cls} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 1401, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, boxShadow: '0 14px 34px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 232 }}>
                {/* Swing */}
                <div data-help-id="swing" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    onClick={() => {
                      const GROOVES = [0, 0.12, 0.25, 0.33, 0.5]
                      const cur = project.swing ?? 0
                      const idx = GROOVES.findIndex(g => Math.abs(g - cur) < 0.03)
                      const next = GROOVES[(idx + 1) % GROOVES.length] ?? 0
                      dispatch({ type: 'SET_SWING', swing: next })
                      engine.swing = next
                    }}
                    title="Click to cycle groove presets: straight → light → classic swing → triplet feel → hard shuffle"
                    style={{ fontSize: 9, width: 42, color: 'var(--text-muted)', letterSpacing: '0.06em', cursor: 'pointer', flexShrink: 0 }}
                  >SWING</span>
                  <Knob
                    value={project.swing ?? 0} min={0} max={0.5} defaultValue={0} size={26}
                    spec={{ label: 'Swing', min: 0, max: 0.5, unit: '%' }}
                    onChange={v => { dispatch({ type: 'SET_SWING', swing: v }); engine.swing = v }}
                    format={v => `${Math.round(v * 100)}%`}
                  />
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', width: 30, textAlign: 'right', flexShrink: 0 }}>{Math.round((project.swing ?? 0) * 100)}%</span>
                </div>
                {/* Varispeed (tape mode) */}
                <div data-help-id="varispeed" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9, width: 42, color: varispeed !== 100 ? '#f59e0b' : 'var(--text-muted)', letterSpacing: '0.06em', flexShrink: 0 }} title="Tape speed — pitch follows speed">SPEED</span>
                  <Knob
                    value={varispeed} min={25} max={200} defaultValue={100} size={26}
                    spec={{ label: 'Varispeed', min: 25, max: 200, unit: '%' }}
                    color={varispeed !== 100 ? '#f59e0b' : 'var(--accent)'}
                    onChange={v => { const pct = Math.round(v); setVarispeed(pct); engine.setPlaybackRate(pct / 100) }}
                    format={v => `${Math.round(v)}%`}
                  />
                  <span style={{ fontSize: 9, color: varispeed !== 100 ? '#f59e0b' : 'var(--text-muted)', fontFamily: 'monospace', width: 30, textAlign: 'right', flexShrink: 0 }}>{varispeed}%</span>
                  {varispeed !== 100 && (
                    <button onClick={() => { setVarispeed(100); engine.setPlaybackRate(1.0) }} title="Reset speed to 100%"
                      style={{ ...base, width: 'auto', padding: '0 5px', fontSize: 8, fontFamily: 'monospace', background: 'rgba(245,158,11,0.15)', border: '1px solid #f59e0b', color: '#f59e0b', flexShrink: 0 }}><RotateCcw size={12} /></button>
                  )}
                </div>
                {/* Delay compensation (lib/latency.ts) */}
                <button
                  onClick={() => { const on = project.delayCompensation === false; dispatch({ type: 'SET_DELAY_COMPENSATION', on }); engine.setDelayCompensation(on) }}
                  data-help-id="delay-compensation"
                  aria-pressed={project.delayCompensation !== false}
                  title="Delay compensation — every track is delayed to match the slowest one's devices, so they all arrive together"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', textAlign: 'left', background: project.delayCompensation !== false ? 'rgb(var(--accent-rgb) / 0.12)' : 'var(--bg-card)', border: project.delayCompensation !== false ? '1px solid var(--accent)' : '1px solid var(--border-light)', color: project.delayCompensation !== false ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 10, fontWeight: 700 }}>
                  <span style={{ letterSpacing: '0.06em' }}>PDC</span>
                  <span style={{ fontSize: 8.5, fontWeight: 400, color: 'var(--text-muted)' }}>delay compensation {project.delayCompensation !== false ? 'on' : 'off'}</span>
                </button>
                {/* Masking detector */}
                <button
                  onClick={() => setShowMask(v => !v)}
                  data-help-id="masking"
                  title="Frequency masking detector — shows which tracks compete in the same bands"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', textAlign: 'left', background: showMask ? 'rgba(239,68,68,0.12)' : 'var(--bg-card)', border: showMask ? '1px solid rgba(239,68,68,0.5)' : '1px solid var(--border-light)', color: showMask ? '#ef4444' : 'var(--text-secondary)', fontSize: 10, fontWeight: 700 }}>
                  <span style={{ letterSpacing: '0.06em' }}>MASK</span>
                  <span style={{ fontSize: 8.5, fontWeight: 400, color: 'var(--text-muted)' }}>frequency masking detector</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div style={divider} />

      {/* Key / Scale */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }} data-help-id="key-scale">
        <select
          value={project.key ?? 0}
          onChange={e => dispatch({ type: 'SET_KEY_SCALE', key: parseInt(e.target.value), scale: project.scale ?? 'major' })}
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 3, padding: '2px 3px', cursor: 'pointer' }}
          title="Root note"
        >
          {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map((n, i) => (
            <option key={i} value={i}>{n}</option>
          ))}
        </select>
        <select
          value={project.scale ?? 'major'}
          onChange={e => dispatch({ type: 'SET_KEY_SCALE', key: project.key ?? 0, scale: e.target.value })}
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 3, padding: '2px 3px', cursor: 'pointer' }}
          title="Scale"
        >
          {['major','minor','penta-maj','penta-min','dorian','chromatic'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={divider} />

      {/* Master volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} data-help-id="master-volume">
        <Volume2 size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <Knob
          value={project.masterVolume} min={0} max={1} defaultValue={0.85} size={26}
            spec={{ label: 'Master volume', min: 0, max: 1, unit: '%' }}
          onChange={v => { dispatch({ type: 'SET_MASTER_VOLUME', volume: v }); engine.setMasterVolume(v) }}
          format={v => `${Math.round(v * 100)}%`}
        />
      </div>

      <div style={divider} />

      {/* Tuner toggle */}
      <button
        onClick={() => setShowTuner(v => !v)}
        title="Open tuner"
        data-help-id="tuner"
        style={{
          ...base,
          width: 'auto', padding: '0 9px',
          fontSize: 12,
          background: showTuner ? 'var(--accent)' : '#1e1e1e',
          border: showTuner ? '1px solid var(--accent)' : '1px solid var(--border)',
          color: showTuner ? 'var(--accent-contrast)' : 'var(--text-secondary)',
        }}
      >
        <Gauge size={14} />
      </button>

      {/* (MASK moved into the "More" popover — item 14.) */}

      <input ref={fileInputRef} type="file" accept=".cfproj,.mid,.midi,application/json" onChange={handleOpenFile} style={{ display: 'none' }} />
      <button
        onClick={() => fileInputRef.current?.click()}
        title="Open a project (.cfproj) or import a MIDI file (.mid)"
        style={{ ...base, width: 'auto', padding: '0 9px', gap: 4, fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}
      >
        <Upload size={13} /> Open
      </button>

      {/* Capture dropdown — screenshot + session recorder, grouped on the
          right next to the invite/Share button. The auto margin lives here so
          this pair floats to the far end of the transport row. */}
      <div ref={captureRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setCaptureOpen(v => !v)}
          title="Capture the studio — take a screenshot or record a session"
          data-help-id="capture"
          aria-haspopup="menu"
          aria-expanded={captureOpen}
          style={{
            ...base,
            width: 'auto', padding: '0 9px', gap: 4,
            fontSize: 11,
            display: 'flex', alignItems: 'center',
            background: (captureOpen || showRecorder) ? '#2a2a2a' : '#1e1e1e',
            border: (captureOpen || showRecorder) ? '1px solid var(--text-muted)' : '1px solid var(--border)',
            color: showRecorder ? '#dc2626' : 'var(--text-secondary)',
          }}
        >
          <Camera size={13} />
          Capture
          <ChevronDown size={12} style={{ opacity: 0.7 }} />
        </button>

        {captureA.mounted && (
          <div
            className={captureA.cls}
            role="menu"
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60,
              minWidth: 190, padding: 5,
              background: '#161616', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}
          >
            <CaptureItem
              icon={<Camera size={14} />}
              label={shotBusy ? 'Preparing…' : 'Screenshot'}
              hint="Grab a still PNG"
              disabled={shotBusy || !screenshotSupported()}
              onClick={takeScreenshot}
            />
            <CaptureItem
              icon={<Video size={14} />}
              label="Record session"
              hint="Screen + studio audio"
              active={showRecorder && recorderMode === 'screen'}
              onClick={() => { setCaptureOpen(false); setRecorderMode('screen'); setShowRecorder(true) }}
            />
            <CaptureItem
              icon={<History size={14} />}
              label="History"
              hint="Watch this project get made"
              active={showRecorder && recorderMode === 'history'}
              onClick={() => { setCaptureOpen(false); setRecorderMode('history'); setShowRecorder(true) }}
            />
          </div>
        )}
      </div>

      {/* Collab slot — CollabLayer portals the avatars + invite button here
          so they live in the transport row instead of their own bar */}
      <div id="transport-collab-slot" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} />

      {showRecorder && typeof document !== 'undefined' && createPortal(
        <ScreenRecorderPanel initialMode={recorderMode} onClose={() => setShowRecorder(false)} />,
        document.body,
      )}

      {shotBlob && (
        <ScreenshotAnnotator
          blob={shotBlob}
          defaultName={`100lights-${(project.name || 'session').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
          onClose={() => setShotBlob(null)}
        />
      )}

      {/* Floating tuner panel */}
      {showTuner && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 56, right: 12, zIndex: 9998,
          width: 290, background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>♩ Tuner</span>
            <button onClick={() => setShowTuner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 2px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={16} /></button>
          </div>
          <PadTuner />
        </div>,
        document.body
      )}

      {/* Floating masking panel */}
      {showMask && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 56, right: showTuner ? 314 : 12, zIndex: 9997,
          width: 290, background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Masking Detector</span>
            <button onClick={() => setShowMask(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 2px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={16} /></button>
          </div>
          <MaskingPanel />
        </div>,
        document.body
      )}
    </div>
  )
}

// Clean numeric BPM field: a free-typed string draft (no clamping mid-type),
// select-all on focus so typing replaces instead of appends, and clamp+commit
// only on blur / Enter. Invalid or empty input at commit reverts to `value`.
function BpmField({ value, onCommit, style, title, ariaLabel }: {
  value: number
  onCommit: (bpm: number) => void
  style?: React.CSSProperties
  title?: string
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  function commit() {
    if (draft !== null) {
      const n = parseFloat(draft)
      if (Number.isFinite(n)) onCommit(clampBpm(n))
    }
    setDraft(null)
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      title={title}
      aria-label={ariaLabel}
      onChange={e => setDraft(e.target.value)}
      onFocus={e => { setDraft(String(value)); e.currentTarget.select() }}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
      }}
      style={style}
    />
  )
}

// Per-section tempo dropdown — shown in place of the single BPM field whenever a
// tempo map is in play (project.tempoMarkers present). Each row edits one segment
// from tempoSegments(): the synthesized beat-0 segment (no marker) drives the
// global tempo via SET_TEMPO; a segment matching a marker edits/removes that
// marker. The section under the playhead is highlighted.
function BpmSectionMenu({ project, dispatch, engine, monoDisplay, inputStyle }: {
  project: DawProject
  dispatch: Dispatch<DawAction>
  engine: DawEngine
  monoDisplay: React.CSSProperties
  inputStyle: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const openA = useAppear(open, 'pop')
  const [playheadBeat, setPlayheadBeat] = useState(() => engine.currentBeat)
  // Sample the playhead only while the menu is open (keeps the highlight live
  // without forcing transport re-renders when it's closed).
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => setPlayheadBeat(engine.currentBeat))
    const id = window.setInterval(() => setPlayheadBeat(engine.currentBeat), 120)
    return () => { cancelAnimationFrame(raf); window.clearInterval(id) }
  }, [open, engine])

  const segs = tempoSegments(project)
  const markers = project.tempoMarkers ?? []
  const activeBpm = tempoAt(playheadBeat, segs)
  const beatsPerBar = Math.max(1, project.timeSignatureNum)

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ ...monoDisplay, minWidth: 52, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
        title="Tempo by section — this song changes BPM. Click to edit each section."
      >
        {Math.round(activeBpm)}<ChevronDown size={11} />
      </button>
      {openA.mounted && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1400 }} />
          <div className={openA.cls} style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 1401,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 10, boxShadow: '0 14px 34px rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column', gap: 5, minWidth: 220,
          }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>TEMPO BY SECTION</div>
            {segs.map((seg, i) => {
              const marker = markers.find(m => Math.abs(m.beat - seg.beat) < 0.01)
              const nextBeat = i + 1 < segs.length ? segs[i + 1].beat : Infinity
              const isActive = playheadBeat >= seg.beat - 1e-6 && playheadBeat < nextBeat - 1e-6
              const bar = Math.floor(seg.beat / beatsPerBar) + 1
              return (
                <div key={marker?.id ?? `seg-${seg.beat}`} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '3px 5px', borderRadius: 6,
                  background: isActive ? 'var(--accent-subtle)' : 'transparent',
                  border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                }}>
                  <span style={{ fontSize: 10, color: isActive ? 'var(--accent-light)' : 'var(--text-muted)', fontFamily: 'monospace', width: 52, flexShrink: 0 }}>
                    {seg.beat < 0.01 ? 'Start' : `Bar ${bar}`}
                  </span>
                  <BpmField
                    value={seg.bpm}
                    ariaLabel={`Tempo for ${seg.beat < 0.01 ? 'the opening section' : `bar ${bar}`}`}
                    onCommit={bpm => {
                      if (marker) {
                        dispatch({ type: 'UPDATE_TEMPO_MARKER', markerId: marker.id, tempo: bpm })
                        // keep the global tempo (transport read-out, count-in, JAM) in
                        // sync when editing the opening section's marker
                        if (seg.beat < 0.01) dispatch({ type: 'PATCH_PROJECT', patch: { tempo: bpm } })
                      } else {
                        dispatch({ type: 'SET_TEMPO', tempo: bpm })
                      }
                    }}
                    style={{ ...inputStyle, width: 54 }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>BPM</span>
                  {marker && marker.beat > 0.01 && (
                    <button
                      onClick={() => dispatch({ type: 'REMOVE_TEMPO_MARKER', markerId: marker.id })}
                      aria-label="Remove this tempo change"
                      title="Remove this tempo change"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}
                    ><X size={12} /></button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// One row in the Capture dropdown.
function CaptureItem({ icon, label, hint, onClick, disabled, active }: {
  icon: ReactNode
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '7px 9px',
        background: hover && !disabled ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none', borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', color: active ? '#dc2626' : 'var(--text-secondary)', flexShrink: 0 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.2 }}>{hint}</span>
      </span>
    </button>
  )
}
