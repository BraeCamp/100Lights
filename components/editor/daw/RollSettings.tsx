'use client'

// Piano-roll clip sound settings: a ⚙ panel controlling effects that touch
// ONLY this clip's notes. Sustain (a release ramp past each note's end) is
// the headliner — it's what makes sampled instruments stop sounding gated —
// plus reverb, distortion, and a lowpass filter, and the clip's sound preset.
// A "Tone" row offers per-instrument flavour presets (Guitar → Rock / Metal /
// Punk …) — each just dials in an editable RollFx starting point.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Knob from './Knob'
import { Settings2, Play, ChevronRight, ChevronLeft, Check, Copy, RotateCw, RotateCcw } from 'lucide-react'
import type { MidiClip, DawClip, RollFx, AutoPoint } from '@/lib/daw-types'
import DrawnGraphModal from './DrawnGraphModal'
import { GRAPH_AREAS, defaultFieldGraph, type MotionAreaId } from '@/lib/draw-graphs'
import { isMidiClip, isAudioClip } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { useDaw } from '@/lib/daw-state'
import EqCurve, { type EqVals } from './EqCurve'
import { fxHasAudibleField, FX_FIELDS, FX_FIELD_BY_KEY, fieldIsSet } from '@/lib/roll-fx'
import { getPresets, combinePresets, getGroupedPresets, noteRangeLabel } from '@/lib/midi-presets'
import { tonesForGroup, applyTone, toneMatches } from '@/lib/tone-presets'
import { articOptions } from '@/lib/articulation'
import { copySound, getCopiedSound, countSetFields, SOUND_CLIPBOARD_EVENT } from '@/lib/fx-clipboard'
import FxControls, { cleanFx } from './FxControls'
import { clampToViewport } from './menu-clamp'
import { useUITierOptional } from '../UITierProvider'

const CYAN = 'var(--accent-light)'
const SOUND_MODE_KEY = '100lights-sound-mode-v1'

export function RollSettings({ clip, dispatch, presetLabel, onChangeSound, onPreviewSound, canPreview }: {
  clip: MidiClip
  dispatch: (a: DawAction) => void
  presetLabel: string
  onChangeSound: () => void
  onPreviewSound: () => void
  canPreview: boolean
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const rfx = clip.rollFx
  const active = (rfx?.sustain ?? 0) > 0 || fxHasAudibleField(rfx)

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (anchor) { setAnchor(null); return }
          const r = btnRef.current!.getBoundingClientRect()
          setAnchor({ x: r.right - 292, y: r.bottom + 6 })
        }}
        title="Clip sound settings — sustain and effects for this piano roll only"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
          padding: '2px 7px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
          border: active ? `1px solid ${CYAN}66` : '1px solid #333',
          background: active ? 'rgba(124,58,237,0.12)' : '#222',
          color: active ? CYAN : '#aaa', flexShrink: 0,
        }}
      >
        <Settings2 size={10} /> Sound{active ? ' •' : ''}
      </button>

      {anchor && (
        <RollSoundPanel
          clip={clip} dispatch={dispatch} anchor={anchor}
          onClose={() => setAnchor(null)}
          presetLabel={presetLabel}
          onChangeSound={() => { setAnchor(null); onChangeSound() }}
          onPreviewSound={onPreviewSound}
          canPreview={canPreview}
          ignoreOutside={btnRef}
        />
      )}
    </>
  )
}

/** The sound-settings panel itself — also opened from the clip context menu,
 *  so sustain/reverb/distortion/filter are reachable without the roll. */
export function RollSoundPanel({ clip, clips, dispatch, anchor, onClose, presetLabel, onChangeSound, onPreviewSound, canPreview, ignoreOutside, retargetOnClipClick }: {
  clip: DawClip
  /** When several clips are selected, all of them are edited together and a
   *  heat band shows any setting whose value differs across them. */
  clips?: DawClip[]
  dispatch: (a: DawAction) => void
  anchor: { x: number; y: number }
  onClose: () => void
  presetLabel: string
  onChangeSound?: () => void
  onPreviewSound?: () => void
  canPreview?: boolean
  ignoreOutside?: React.RefObject<HTMLElement | null>
  /** Keep the panel open when a clip is clicked — the selection change retargets
   *  it instead of closing (used by the shared, selection-following panel). */
  retargetOnClipClick?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Open state for the built-in "Change Sound" preset picker (below). Uses the
  // project + engine already pulled from useDaw() further down.
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)

  // Basic vs advanced — remembered across panel instances via localStorage.
  const [mode, setMode] = useState<'basic' | 'advanced'>(() => {
    try { return localStorage.getItem(SOUND_MODE_KEY) === 'advanced' ? 'advanced' : 'basic' } catch { return 'basic' }
  })
  function toggleMode() {
    const next = mode === 'basic' ? 'advanced' : 'basic'
    setMode(next)
    try { localStorage.setItem(SOUND_MODE_KEY, next) } catch { /* storage off */ }
  }

  // Advanced sound controls live in the "Everything" UI tier. Simpler tiers
  // (beginner + standard) stay on the curated basics with no toggle.
  const uiCtx = useUITierOptional()
  const tier = uiCtx?.tier ?? 'full'
  const soundAdvancedAllowed = tier === 'full'
  const effectiveMode: 'basic' | 'advanced' = soundAdvancedAllowed ? mode : 'basic'
  // The drawn-graph suite is its own UI dimension (UI menu → "Drawn graphs"),
  // independent of the tier — off by default so the panel stays uncluttered.
  const graphsEnabled = uiCtx?.graphs ?? false

  // Which graph (if any) is open in the full-screen modal. Curves never render
  // inline anymore — clicking a setting's name opens it here.
  type OpenGraph = { kind: 'area'; area: MotionAreaId } | { kind: 'field'; key: keyof RollFx } | { kind: 'eq' } | null
  const [openGraph, setOpenGraph] = useState<OpenGraph>(null)
  useLayoutEffect(() => {
    // Re-clamp when the panel grows (e.g. switching to Advanced) so its bottom
    // never runs off screen.
    clampToViewport(panelRef.current, anchor)
    // focus the panel so Escape works regardless of what else listens on document
    panelRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, effectiveMode, presetPickerOpen])

  useEffect(() => {
    function onDown(e: Event) {
      // Inside the panel (clicking/dragging a control) → keep open.
      if (panelRef.current?.contains(e.target as Node)) return
      // The tone popover / "Draw" menu / graph modal are portaled to <body>
      // (outside the panel), so ignore clicks inside them or the panel closes.
      if ((e.target as HTMLElement).closest?.('[data-sound-overlay]')) return
      if (ignoreOutside?.current?.contains(e.target as Node)) return
      // Clicking another clip selects it → the panel retargets, so don't close.
      if (retargetOnClipClick && (e.target as HTMLElement).closest?.('[data-clip-id]')) return
      onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    // Capture phase so a click inside the piano roll / arrangement can't
    // stopPropagation its way past this handler and leave the panel stuck open.
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, ignoreOutside, retargetOnClipClick])

  const targets: DawClip[] = clips && clips.length > 0 ? clips : [clip]
  const multi = targets.length > 1
  const showPreset = !multi && isMidiClip(clip)

  // Volume + Tone-EQ are TRACK-scoped and shared verbatim with the Mixer strip:
  // both the mixer and this panel read/write the same track.volume + track.tone,
  // so adjusting either place moves the other. The clip's own gain/EQ fields are
  // hidden from the FX list below (see hideFields) — one system, two doorways.
  const { project, engine } = useDaw()
  // Playhead mapped into this clip's span (0..1) for the graph modals — null
  // whenever the transport is outside the clip.
  const playheadClipT = () => {
    const b = (engine as { currentBeat?: number })?.currentBeat
    if (b == null || !clip.durationBeats) return null
    const t = (b - clip.startBeat) / clip.durationBeats
    return t >= 0 && t <= 1 ? t : null
  }
  const trackIds = useMemo(() => [...new Set(targets.map(t => t.trackId))], [targets.map(t => t.trackId).join(',')])
  const eqTrack = project.tracks.find(t => t.id === trackIds[0])
  const eqMultiTrack = trackIds.length > 1
  const tone = eqTrack?.tone ?? {}
  const trackVol = eqTrack?.volume ?? 0.8
  const setTrackBand = (band: 'sub' | 'bass' | 'mid' | 'treble', v: number) => {
    for (const id of trackIds) {
      const t = project.tracks.find(x => x.id === id); if (!t) continue
      const next = { ...(t.tone ?? {}), [band]: v || undefined }
      dispatch({ type: 'UPDATE_TRACK', trackId: id, patch: { tone: next } })
      engine.setTrackTone(id, next)
    }
  }
  // Whole-tone setter for a horizontal draw (many bands at once) — one update per
  // track so rapid per-band writes don't overwrite each other from a stale bag.
  const setTrackToneAll = (t: EqVals) => {
    const next: EqVals = {}
    for (const b of ['sub', 'bass', 'mid', 'treble'] as const) if (t[b]) next[b] = t[b]
    for (const id of trackIds) {
      dispatch({ type: 'UPDATE_TRACK', trackId: id, patch: { tone: next } })
      engine.setTrackTone(id, next)
    }
  }
  const setTrackVol = (v: number) => {
    for (const id of trackIds) {
      dispatch({ type: 'UPDATE_TRACK', trackId: id, patch: { volume: v } })
      engine.setTrackVolume(id, v)
    }
  }

  // Tone presets — flavour options for the current instrument family (Guitar →
  // Rock / Metal / Punk …). Each applies a curated, editable sound-settings bag.
  const soundGroup = useMemo(() => {
    if (multi || !isMidiClip(clip) || !clip.presetId || typeof window === 'undefined') return undefined
    try { return getPresets().find(p => p.id === clip.presetId)?.group } catch { return undefined }
  }, [multi, clip])
  const tones = useMemo(() => (!multi && isMidiClip(clip) ? tonesForGroup(soundGroup) : []), [multi, clip, soundGroup])

  // Articulation — which options this instrument offers (legato / slide) and its
  // family defaults, keyed off the preset's tags. Unset on the clip = auto.
  const artPreset = useMemo(() => {
    if (multi || !isMidiClip(clip) || !clip.presetId || typeof window === 'undefined') return undefined
    try { return getPresets().find(p => p.id === clip.presetId) } catch { return undefined }
  }, [multi, clip])
  const artOpts = artPreset ? articOptions(artPreset.group, artPreset.category, artPreset.name) : undefined
  const showArtic = !!artOpts && (artOpts.legato.available || artOpts.slide.available)
  const rfLegato = isMidiClip(clip) ? clip.rollFx?.legato : undefined
  const legatoOn = artOpts ? ((rfLegato ?? (artOpts.legato.default ? 1 : 0)) > 0.5) : false
  const legatoAuto = rfLegato === undefined
  const slideAmt = artOpts && isMidiClip(clip) ? (clip.rollFx?.slide ?? artOpts.slide.defaultAmount) : 0

  // FX Motion + per-parameter graphs work on any single clip (MIDI or audio).
  const supportsFx = !multi && (isMidiClip(clip) || isAudioClip(clip))
  const motion = supportsFx ? clip.fxMotion : undefined
  // Default curves come from the registry (lib/draw-graphs.ts) so the whole
  // drawn-graph system shares one source of truth.
  const DEFAULT_MOTION: AutoPoint[] = GRAPH_AREAS.fxmotion.defaultCurve()
  const addMotion = () => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { fx: { filterHz: 500 }, graph: DEFAULT_MOTION } } })
  const setMotionGraph = (graph: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { fx: motion?.fx ?? {}, perNote: motion?.perNote, graph } } })
  const setMotionFx = (fx: RollFx | undefined) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { ...(motion ?? { graph: DEFAULT_MOTION }), fx: fx ?? {} } } })
  const setMotionPerNote = (perNote: boolean) => { if (motion) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { ...motion, perNote } } }) }
  // Loop-preview for the graph modals: play the selected clip on repeat so the
  // curve can be heard while it is drawn. Uses the transport's own loop (so FX,
  // instruments and the graph itself all apply exactly as they do in playback)
  // and restores the previous loop settings on stop.
  const [previewing, setPreviewing] = useState(false)
  const prevLoopRef = useRef<{ enabled: boolean; start: number; end: number } | null>(null)
  const previewClip = !multi ? clip : null
  const stopPreview = useCallback(() => {
    setPreviewing(false)
    engine.stop()
    const prev = prevLoopRef.current
    if (prev) {
      dispatch({ type: 'SET_LOOP', start: prev.start, end: prev.end })
      dispatch({ type: 'SET_LOOP_ENABLED', enabled: prev.enabled })
      prevLoopRef.current = null
    }
  }, [engine, dispatch])
  const togglePreview = useCallback(() => {
    if (previewing) { stopPreview(); return }
    if (!previewClip) return
    prevLoopRef.current = { enabled: project.loopEnabled, start: project.loopStart, end: project.loopEnd }
    const start = previewClip.startBeat
    const end = previewClip.startBeat + previewClip.durationBeats
    dispatch({ type: 'SET_LOOP', start, end })
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: true })
    setPreviewing(true)
    void engine.play(start)
  }, [previewing, previewClip, project.loopEnabled, project.loopStart, project.loopEnd, dispatch, engine, stopPreview])
  // Closing the panel/modal must not leave the transport looping forever.
  useEffect(() => () => { if (previewing) stopPreview() }, [previewing, stopPreview])

  const clearMotion = () => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: undefined } })

  // Per-field graph mode (a single FX slider ↔ a drawn curve). Switching either
  // way resets that parameter, so there's no messy conversion.
  const fxGraphs = supportsFx ? clip.fxGraphs : undefined
  const graphsForCtl = fxGraphs
    ? Object.fromEntries(Object.entries(fxGraphs).map(([k, g]) => [k, g!.graph]))
    : undefined
  const cloneGraphs = () => ({ ...(clip.fxGraphs ?? {}) }) as NonNullable<MidiClip['fxGraphs']>
  const toggleFieldGraph = (key: keyof RollFx, on: boolean) => {
    const g = cloneGraphs()
    const rf: RollFx = { ...(clip.rollFx ?? {}) }
    if (on) { delete rf[key]; g[key] = { graph: defaultFieldGraph() } }   // slider → graph, reset scalar
    else { delete g[key] }                                          // graph → slider, reset graph
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: {
      rollFx: Object.keys(rf).length ? rf : undefined,
      fxGraphs: Object.keys(g).length ? g : undefined,
    } })
  }
  const setFieldGraph = (key: keyof RollFx, pts: AutoPoint[]) => {
    const g = cloneGraphs(); g[key] = { ...(g[key] ?? {}), graph: pts }
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxGraphs: g } })
  }

  // Amplitude envelope drawn per note (0 = silent, top = full), replacing the
  // attack/decay/sustain sliders. Switching resets the envelope either way.
  const ampGraph = !multi && isMidiClip(clip) ? clip.ampGraph : undefined
  const toggleAmpGraph = (on: boolean) => {
    if (on) {
      const rf: RollFx = { ...(clip.rollFx ?? {}) }
      delete rf.attack; delete rf.decay; delete rf.sustainLevel; delete rf.sustain
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { ampGraph: GRAPH_AREAS.amplitude.defaultCurve(), rollFx: Object.keys(rf).length ? rf : undefined } })
    } else {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { ampGraph: undefined } })
    }
  }
  const setAmpGraph = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { ampGraph: pts } })

  // Drawn pitch contour per note (0.5 = in tune, up = sharp, down = flat).
  const pitchGraph = !multi && isMidiClip(clip) ? clip.pitchGraph : undefined
  const togglePitchGraph = (on: boolean) => {
    if (on) {
      const rf: RollFx = { ...(clip.rollFx ?? {}) }
      delete rf.pitchEnv; delete rf.pitchEnvTime; delete rf.vibratoDepth; delete rf.detune
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { pitchGraph: GRAPH_AREAS.pitch.defaultCurve(), rollFx: Object.keys(rf).length ? rf : undefined } })
    } else {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { pitchGraph: undefined } })
    }
  }
  const setPitchGraph = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { pitchGraph: pts } })

  // Custom LFO shape (one cycle) used by this clip's tremolo / auto-pan / wah /
  // vibrato instead of a sine.
  const lfoShape = !multi && isMidiClip(clip) ? clip.lfoShape : undefined
  const toggleLfoShape = (on: boolean) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { lfoShape: on ? GRAPH_AREAS.lfo.defaultCurve() : undefined } })
  const setLfoShape = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { lfoShape: pts } })

  // Drawn volume automation across the clip (MIDI or audio).
  const volGraph = supportsFx ? clip.volGraph : undefined
  const toggleVol = (on: boolean) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { volGraph: on ? GRAPH_AREAS.volume.defaultCurve() : undefined } })
  const setVol = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { volGraph: pts } })

  // Drawn groove — micro-timing per bar position (MIDI only).
  const groove = !multi && isMidiClip(clip) ? clip.groove : undefined
  const toggleGroove = (on: boolean) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { groove: on ? GRAPH_AREAS.groove.defaultCurve() : undefined } })
  const setGroove = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { groove: pts } })

  // Per-note vs whole-clip toggle for ALL per-parameter FX graphs at once.
  const anyFieldGraph = !!fxGraphs && Object.keys(fxGraphs).length > 0
  const graphsPerNote = anyFieldGraph && Object.values(fxGraphs!).every(g => g?.perNote)
  const setGraphsPerNote = (pn: boolean) => {
    const g = cloneGraphs()
    for (const k of Object.keys(g) as (keyof RollFx)[]) g[k] = { ...(g[k] ?? { graph: [] }), perNote: pn }
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxGraphs: g } })
  }

  // One data-driven binding per drawn area — drives the presentation (which
  // areas to list, active state) AND the modal (its points/onChange/off/reset).
  const areaBind: Record<MotionAreaId, { points?: AutoPoint[]; onChange: (p: AutoPoint[]) => void; toggle: (on: boolean) => void; available: boolean }> = {
    amplitude: { points: ampGraph, onChange: setAmpGraph, toggle: toggleAmpGraph, available: !multi && isMidiClip(clip) },
    lfo: { points: lfoShape, onChange: setLfoShape, toggle: toggleLfoShape, available: !multi && isMidiClip(clip) },
    pitch: { points: pitchGraph, onChange: setPitchGraph, toggle: togglePitchGraph, available: !multi && isMidiClip(clip) },
    volume: { points: volGraph, onChange: setVol, toggle: toggleVol, available: supportsFx },
    groove: { points: groove, onChange: setGroove, toggle: toggleGroove, available: !multi && isMidiClip(clip) },
    fxmotion: { points: motion?.graph, onChange: setMotionGraph, toggle: (on) => (on ? addMotion() : clearMotion()), available: supportsFx },
  }
  const drawAreas = (Object.keys(GRAPH_AREAS) as MotionAreaId[]).filter(a => areaBind[a].available)
  // Open an area's modal — create its default curve first if it isn't on yet.
  const openArea = (area: MotionAreaId) => {
    if (!areaBind[area].points) areaBind[area].toggle(true)
    setOpenGraph({ kind: 'area', area })
  }

  // Revert toggle — flip the clip(s) back to their default sound, and back
  // again if clicked before any edit. A change dialed in while reverted commits
  // the revert (drops the snapshot / untoggles the button) but keeps that change.
  const [revertSnap, setRevertSnap] = useState<Record<string, RollFx | undefined> | null>(null)
  const reverted = revertSnap !== null
  const sig = targets.map(t => t.id).join(',')
  useEffect(() => { setRevertSnap(null) }, [sig])   // new selection → drop any pending revert
  const canRevert = reverted || targets.some(t => countSetFields(t.rollFx) > 0)
  function doRevert() {
    if (!reverted) {
      const snap: Record<string, RollFx | undefined> = {}
      for (const t of targets) snap[t.id] = t.rollFx
      setRevertSnap(snap)
      for (const t of targets) dispatch({ type: 'UPDATE_CLIP', clipId: t.id, patch: { rollFx: undefined } })
    } else {
      for (const t of targets) dispatch({ type: 'UPDATE_CLIP', clipId: t.id, patch: { rollFx: revertSnap![t.id] } })
      setRevertSnap(null)
    }
  }

  // Whole-bag commit (single-clip mode).
  function commitFx(fxBag: RollFx | undefined) {
    if (reverted) setRevertSnap(null)   // an edit after revert makes the revert permanent
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { rollFx: fxBag } })
  }
  // Per-field commit (multi-select) — apply just this setting to every clip, so
  // only its heat band collapses.
  function applyField(key: keyof RollFx, value: number) {
    if (reverted) setRevertSnap(null)   // an edit after revert makes the revert permanent
    const set = fieldIsSet(key, value)
    for (const t of targets) {
      const next: RollFx = { ...(t.rollFx ?? {}) }
      if (set) next[key] = Math.round(value * 1000) / 1000
      else delete next[key]
      dispatch({ type: 'UPDATE_CLIP', clipId: t.id, patch: { rollFx: Object.keys(next).length ? next : undefined } })
    }
  }
  // Heat ranges — per field, the [min,max] normalized spread across the selection
  // (present only where clips differ).
  const ranges: Partial<Record<string, [number, number]>> = {}
  if (multi) {
    for (const f of FX_FIELDS) {
      let lo = Infinity, hi = -Infinity
      for (const t of targets) {
        const raw = (t.rollFx?.[f.key] as number | undefined) ?? f.neutral
        const nv = f.toNorm(raw)
        if (nv < lo) lo = nv
        if (nv > hi) hi = nv
      }
      if (hi - lo > 0.005) ranges[f.key] = [lo, hi]
    }
  }

  // Sound clipboard — copy this clip's settings, paste onto another clip.
  const [copied, setCopied] = useState<RollFx | null>(null)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    const sync = () => setCopied(getCopiedSound())
    sync()
    window.addEventListener(SOUND_CLIPBOARD_EVENT, sync)
    return () => window.removeEventListener(SOUND_CLIPBOARD_EVENT, sync)
  }, [])
  const hereCount = countSetFields(clip.rollFx)
  const clipCount = countSetFields(copied)
  function doCopy() {
    copySound(clip.rollFx)
    setFlash(true); setTimeout(() => setFlash(false), 1100)
  }


  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }
  const label: React.CSSProperties = { fontSize: 10, color: 'var(--text-secondary)', width: 70, flexShrink: 0 }
  const clipBtn = (enabled: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    fontSize: 9.5, fontWeight: 600, padding: '3px 9px', borderRadius: 4, flexShrink: 0,
    border: '1px solid var(--border-light)', background: 'var(--bg-card)',
    color: enabled ? 'var(--text-secondary)' : 'var(--text-muted)',
    cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
  })

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={panelRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }} style={{
      position: 'fixed', top: anchor.y, left: anchor.x, width: 300, zIndex: 9999, outline: 'none',
      maxHeight: '78vh', overflowY: 'auto',
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '6px 0 10px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
    }}>
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '4px 8px 6px 12px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', borderBottom: '1px solid var(--border)', zIndex: 1 }}>
        <span>{multi ? `SOUND — ${targets.length} CLIPS TOGETHER` : 'CLIP SOUND — this clip only'}</span>
        {soundAdvancedAllowed && (
          <button onClick={toggleMode}
            title={mode === 'basic' ? 'Show all sound controls' : 'Show just the essentials'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', flexShrink: 0, border: '1px solid var(--border-light)', background: mode === 'advanced' ? 'rgb(var(--accent-rgb) / 0.15)' : 'var(--bg-card)', color: mode === 'advanced' ? CYAN : 'var(--text-secondary)' }}>
            {mode === 'basic' ? <>ADVANCED <ChevronRight size={10} /></> : <><ChevronLeft size={10} /> BASIC</>}
          </button>
        )}
      </div>

      {/* (Rename moved to the clip's right-click menu — item 11.) */}

      {/* Sound / preset (single MIDI clip only) — "Change Sound" lives here now:
          the row's name opens a built-in preset picker (or an external handler
          when one is supplied, e.g. the piano roll's own picker). */}
      {showPreset && (
        <div style={{ ...row, paddingTop: 9 }}>
          <span style={label}>Sound</span>
          <button onClick={() => onChangeSound ? onChangeSound() : setPresetPickerOpen(v => !v)} title="Change the sound preset"
            style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 10, color: 'var(--text-primary)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationColor: 'var(--border-light)', textUnderlineOffset: 2 }}>
            {presetLabel}
          </button>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>tap to change</span>
          {canPreview && onPreviewSound && (
            <button onClick={onPreviewSound} title="Listen — plays middle C"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: CYAN, cursor: 'pointer', fontSize: 11, padding: '2px 4px', flexShrink: 0 }}><Play size={12} /></button>
          )}
        </div>
      )}
      {/* Built-in preset picker (opened by the Sound row when no external
          onChangeSound is wired). Scrolls inside the panel. */}
      {showPreset && presetPickerOpen && !onChangeSound && isMidiClip(clip) && (() => {
        const allPresets = combinePresets(project.presets)
        const track = project.tracks.find(t => t.id === clip.trackId)
        const cur = (clip as MidiClip).presetId
        const pick = (presetId: string | undefined) => {
          dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId } })
          engine.setPresets(allPresets)
          setPresetPickerOpen(false)
        }
        const pickRow = (active: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', textAlign: 'left', padding: '4px 12px 4px 18px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: active ? 'var(--accent-light)' : 'var(--text-primary)' })
        return (
          <div style={{ maxHeight: 240, overflowY: 'auto', margin: '2px 0 6px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)' }}>
            {track && track.instrument.type !== 'none' && (
              <button onClick={() => pick(undefined)} style={pickRow(!cur)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                Track instrument
              </button>
            )}
            {getGroupedPresets(allPresets).map(({ group, presets: gp }) => (
              <div key={group}>
                <div style={{ padding: '4px 12px 2px', fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group}</div>
                {gp.map(p => (
                  <button key={p.id} onClick={() => pick(p.id)} style={pickRow(cur === p.id)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                    <span>{p.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 8.5, color: 'var(--text-muted)' }}>{noteRangeLabel(p)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )
      })()}
      {/* Tone — one button that opens the flavour options (single MIDI clip).
          A tone applies its whole character bag (drive, EQ, distortion…) and the
          engine renders all of it, so it transforms the sound in EVERY UI tier —
          even where the sliders for those effects are hidden. */}
      {showPreset && tones.length > 0 && (() => {
        const activeTone = tones.find(t => toneMatches(clip.rollFx, t))
        const extraFx = activeTone ? Math.max(0, countSetFields(activeTone.fx) - 1) : 0
        // Tone, laid out rather than hidden.
        // This was a button that opened a portal menu — one more click, and a
        // list you could not see while listening. There are only a handful of
        // tones and they are the fastest way to change a sound, so they sit in
        // the panel as chips with the active one lit. Same choices, no door in
        // front of them.
        return (
          <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>TONE</span>
              {activeTone && !soundAdvancedAllowed && extraFx > 0 && (
                <span style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>· {extraFx} fx</span>
              )}
              {activeTone && (
                <button
                  onClick={() => commitFx(applyTone(clip.rollFx, { name: '', fx: {} } as typeof tones[number]))}
                  title="Clear the tone"
                  style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-muted)' }}
                >clear</button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tones.map(t => {
                const on = activeTone?.name === t.name
                return (
                  <button key={t.name}
                    onClick={() => commitFx(applyTone(clip.rollFx, t))}
                    title={`${t.name} — sets ${countSetFields(t.fx)} sound setting${countSetFields(t.fx) === 1 ? '' : 's'}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 9.5, fontWeight: on ? 800 : 600, padding: '3px 9px', borderRadius: 99, cursor: 'pointer',
                      border: on ? `1px solid ${CYAN}` : '1px solid var(--border-light)',
                      background: on ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)',
                      color: on ? CYAN : 'var(--text-secondary)',
                    }}>
                    {on && <Check size={9} />}{t.name}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Articulation (item 13) — one compact row. Legato is a chip; Slide only
          appears once Legato is engaged (it only affects connected notes). */}
      {showArtic && artOpts && (
        <div style={{ ...row, paddingTop: 4, paddingBottom: 4, gap: 8 }}>
          <span style={{ ...label, width: 44 }}>Artic</span>
          {artOpts.legato.available && (
            <button
              onClick={() => commitFx({ ...(clip.rollFx || {}), legato: legatoOn ? 0 : 1 })}
              title="Legato: across a run of touching/overlapping notes, only the first attacks — the rest keep the bow/breath moving. Notes after a gap start fresh."
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 9.5, fontWeight: 600, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', flexShrink: 0,
                border: legatoOn ? `1px solid ${CYAN}` : '1px solid var(--border-light)',
                background: legatoOn ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)',
                color: legatoOn ? CYAN : 'var(--text-secondary)',
              }}>
              {legatoOn && <Check size={11} />}Legato{legatoAuto ? ' · auto' : ''}
            </button>
          )}
          {artOpts.slide.available && (legatoOn || !artOpts.legato.available) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>Slide</span>
              <Knob
                value={slideAmt} min={0} max={1} defaultValue={0} size={26} color={CYAN}
                onChange={v => commitFx({ ...(clip.rollFx || {}), slide: v })}
                format={v => (v > 0 ? `${Math.round(v * 100)}%` : 'Off')}
              />
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 9, color: slideAmt > 0 ? 'var(--text-primary)' : 'var(--text-muted)', width: 34, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {slideAmt > 0 ? `${Math.round(slideAmt * 100)}%` : 'Off'}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 8.5, color: 'var(--text-muted)', flex: 1 }}>connected notes only</span>
          )}
        </div>
      )}

      {multi && (
        <div style={{ padding: '7px 12px 3px', fontSize: 9, color: '#f59e0b', lineHeight: 1.4 }}>
          Editing {targets.length} clips together — a heat band marks any setting that differs. Moving a slider sets it for all.
        </div>
      )}

      {/* Copy / paste the sound settings between clips */}
      <div style={{ ...row, paddingTop: 2, paddingBottom: 6 }}>
        <span style={label}>Settings</span>
        <button
          onClick={doCopy}
          title={hereCount ? 'Copy this clip’s sound settings' : 'Copy this clip’s (unchanged) settings — paste to reset another clip to defaults'}
          style={clipBtn(true)}
        >{flash ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy{hereCount ? ` (${hereCount})` : ''}</>}</button>
        <button
          onClick={() => {
            // An empty copy pastes as "reset to defaults" (rollFx cleared).
            const toPaste = copied && clipCount > 0 ? copied : undefined
            if (multi) { if (reverted) setRevertSnap(null); for (const t of targets) dispatch({ type: 'UPDATE_CLIP', clipId: t.id, patch: { rollFx: toPaste } }) }
            else commitFx(toPaste)
          }} disabled={!copied}
          title={!copied ? 'Nothing copied yet'
            : clipCount > 0 ? `Paste ${clipCount} copied setting${clipCount === 1 ? '' : 's'} onto ${multi ? `all ${targets.length} clips` : 'this clip'}`
            : `Reset ${multi ? `all ${targets.length} clips` : 'this clip'} to default (copied from an unchanged clip)`}
          style={clipBtn(!!copied)}
        >{copied ? (clipCount > 0 ? `Paste (${clipCount})` : 'Paste · reset') : 'Paste'}</button>
        <button
          onClick={doRevert} disabled={!canRevert}
          title={reverted
            ? 'Reverted to default — click again to restore, or dial in a change to keep it'
            : `Revert ${multi ? `all ${targets.length} clips` : 'this clip'} to default sound (toggle — click again to restore)`}
          style={reverted
            ? { ...clipBtn(true), border: `1px solid ${CYAN}`, background: 'rgb(var(--accent-rgb) / 0.18)', color: CYAN }
            : clipBtn(canRevert)}
        >{reverted ? <><RotateCw size={11} /> Reverted</> : <><RotateCcw size={11} /> Revert</>}</button>
        <span style={{ flex: 1 }} />
      </div>

      {/* Volume + EQ — one system, shared verbatim with the Mixer strip (edits
          track.volume + track.tone). Volume is its OWN inline slider (one click,
          no graph attached); EQ is a separate button that opens the drawing
          graph in the modal. */}
      {eqTrack && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 4px' }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 44, flexShrink: 0 }}>Volume</span>
            <Knob
              value={trackVol} min={0} max={1.2} defaultValue={1} size={26} color={CYAN}
              onChange={setTrackVol}
              format={v => `${Math.round(v * 100)}%`}
            />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 9.5, color: 'var(--text-primary)', width: 40, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{Math.round(trackVol * 100)}%</span>
          </div>
          <button onClick={() => setOpenGraph({ kind: 'eq' })}
            title="Open the EQ — draw the curve"
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '4px 12px 8px', background: 'none', border: 'none', cursor: 'pointer' }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 44, flexShrink: 0 }}>EQ</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8, fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden' }}>
              {(['sub', 'bass', 'mid', 'treble'] as const).map(b => {
                const v = tone[b] ?? 0
                return <span key={b} style={{ color: v ? CYAN : 'var(--text-muted)' }}>{b[0].toUpperCase() + b.slice(1)}{v ? ` ${v > 0 ? '+' : ''}${v}` : ''}</span>
              })}
            </span>
            <span style={{ fontSize: 9, color: CYAN, flexShrink: 0 }}>◠ draw ▸</span>
          </button>
        </div>
      )}

      {/* Remaining clip-only effects (volume/EQ moved to the track block above) —
          shared with the preset & per-note editors */}
      <FxControls
        value={clip.rollFx}
        onCommit={commitFx}
        hideFields={ampGraph
          ? (['gain', 'sub', 'bass', 'mid', 'treble', 'attack', 'decay', 'sustainLevel', 'sustain'] as (keyof RollFx)[])
          : (['gain', 'sub', 'bass', 'mid', 'treble'] as (keyof RollFx)[])}
        ranges={multi ? ranges : undefined}
        onField={multi ? applyField : undefined}
        mode={effectiveMode}
        graphs={graphsForCtl}
        onOpenGraph={supportsFx && graphsEnabled ? (key) => {
          if (!clip.fxGraphs?.[key]) toggleFieldGraph(key, true)   // create then open
          setOpenGraph({ kind: 'field', key })
        } : undefined}
        // Always available: a field already in graph mode must be able to get
        // back to a slider even when graphs are switched off, or it is stuck.
        onToggleGraph={supportsFx ? (key, on) => toggleFieldGraph(key, on) : undefined}
        onGraphChange={supportsFx ? (key, pts) => setFieldGraph(key, pts) : undefined}
      />

      {/* When any FX slider is in graph mode, choose whether those graphs span
          the whole clip or re-trigger per note. */}
      {anyFieldGraph && graphsEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px 2px' }}>
          <span style={{ fontSize: 8.5, color: 'var(--text-muted)', flex: 1 }}>FX graphs run over</span>
          {([['whole clip', false], ['per note', true]] as const).map(([lbl, pn]) => (
            <button key={lbl} onClick={() => setGraphsPerNote(pn)}
              style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: graphsPerNote === pn ? `1px solid ${CYAN}` : '1px solid var(--border-light)', background: graphsPerNote === pn ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)', color: graphsPerNote === pn ? CYAN : 'var(--text-secondary)' }}>{lbl}</button>
          ))}
        </div>
      )}

      {/* ── Drawn-graph suite ─────────────────────────────────────────────────
          Its own UI dimension (UI menu → "Drawn graphs"). The curves never sit
          inline — each area opens the full-screen DrawnGraphModal from its name.
          Three comparison layouts (button / chips / rows) share openArea(). */}
      {graphsEnabled && drawAreas.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '9px 12px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>DRAW GRAPHS</span>

          </div>

          {/* 1b — a row of chips, active ones lit. */}
          {(

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {drawAreas.map(a => {
                const on = !!areaBind[a].points
                return (
                  <button key={a} onClick={() => openArea(a)} title={`Draw ${GRAPH_AREAS[a].short}`}
                    style={{ fontSize: 9.5, fontWeight: 700, padding: '3px 9px', borderRadius: 99, cursor: 'pointer', border: on ? `1px solid ${CYAN}` : '1px solid var(--border-light)', background: on ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)', color: on ? CYAN : 'var(--text-secondary)' }}>
                    {on ? '● ' : ''}{GRAPH_AREAS[a].short}
                  </button>
                )
              })}
            </div>
          )}

          {/* 1c — a lean row per area, name click opens the modal. */}

        </div>
      )}

      <div style={{ padding: '8px 12px 0', fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Applies to this clip’s notes only — live and on export. To bake a sound into a reusable, shareable preset, use the sound menu’s <strong>New preset</strong>.
      </div>

      {/* ── Graph modals — every curve opens here, never inline ─────────────── */}
      {openGraph?.kind === 'area' && (() => {
        const area = openGraph.area
        const def = GRAPH_AREAS[area]
        const b = areaBind[area]
        const isFx = area === 'fxmotion'
        return (
          <DrawnGraphModal
            onPreviewToggle={previewClip ? togglePreview : undefined}
            previewing={previewing}
            title={def.short}
            subtitle={isFx ? 'A curve that morphs the chosen effects across the clip.' : undefined}
            axis={def.axis}
            points={b.points ?? def.defaultCurve()}
            onChange={b.onChange}
            onClose={() => setOpenGraph(null)}
            onReset={() => b.onChange(def.defaultCurve())}
            onOff={() => { b.toggle(false); setOpenGraph(null) }}
            offLabel={def.offLabel}
            playheadT={area === 'volume' || (isFx && !motion?.perNote) ? playheadClipT : undefined}
            extra={isFx && motion ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 8px' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{motion.perNote ? 'per note' : 'clip start → end'}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {([['Whole clip', false], ['Per note', true]] as const).map(([lbl, pn]) => {
                      const on = !!motion.perNote === pn
                      return (
                        <button key={lbl} onClick={() => setMotionPerNote(pn)}
                          title={pn ? 'Re-trigger the shape on every note' : 'One shape stretched across the whole clip'}
                          style={{ fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', border: on ? `1px solid ${CYAN}` : '1px solid var(--border-light)', background: on ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)', color: on ? CYAN : 'var(--text-secondary)' }}>{lbl}</button>
                      )
                    })}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, lineHeight: 1.4 }}>Effects that follow the curve — the top of the graph = these values:</div>
                <FxControls value={motion.fx} onCommit={setMotionFx} hideCats={['env', 'pitch']} mode="advanced" />
              </div>
            ) : undefined}
          />
        )
      })()}

      {openGraph?.kind === 'field' && (() => {
        const key = openGraph.key
        const f = FX_FIELD_BY_KEY[key as string]
        return (
          <DrawnGraphModal
            title={f?.label ?? String(key)}
            subtitle="Draw this effect across the clip — bottom = off, top = full."
            axis={['clip start', '', 'clip end']}
            points={clip.fxGraphs?.[key]?.graph ?? defaultFieldGraph()}
            onChange={pts => setFieldGraph(key, pts)}
            onClose={() => setOpenGraph(null)}
            onReset={() => setFieldGraph(key, defaultFieldGraph())}
            onOff={() => { toggleFieldGraph(key, false); setOpenGraph(null) }}
            offLabel="Back to slider"
            playheadT={playheadClipT}
          />
        )
      })()}

      {openGraph?.kind === 'eq' && eqTrack && (
        <DrawnGraphModal
          onPreviewToggle={previewClip ? togglePreview : undefined}
          previewing={previewing}
          title="EQ"
          subtitle={eqMultiTrack ? `${trackIds.length} tracks · shared with the mixer` : 'Draw the curve — drag across to sketch, or a band up/down. Shared with the mixer strip.'}
          onClose={() => setOpenGraph(null)}
          onReset={() => setTrackToneAll({})}
        >
          {/* Volume is a separate inline control in the panel — this graph is EQ only. */}
          <EqCurve value={tone} onChange={setTrackBand} onChangeAll={setTrackToneAll} width={520} height={190} />
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
            {(['sub', 'bass', 'mid', 'treble'] as const).map(band => {
              const v = tone[band] ?? 0
              return <span key={band} style={{ color: v ? 'var(--text-primary)' : 'var(--text-muted)' }}>{band[0].toUpperCase() + band.slice(1)} {v > 0 ? '+' : ''}{v || 0}dB</span>
            })}
          </div>
        </DrawnGraphModal>
      )}
    </div>,
    document.body,
  )
}
