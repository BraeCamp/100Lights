'use client'

// Piano-roll clip sound settings: a ⚙ panel controlling effects that touch
// ONLY this clip's notes. Sustain (a release ramp past each note's end) is
// the headliner — it's what makes sampled instruments stop sounding gated —
// plus reverb, distortion, and a lowpass filter, and the clip's sound preset.
// A "Tone" row offers per-instrument flavour presets (Guitar → Rock / Metal /
// Punk …) — each just dials in an editable RollFx starting point.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import type { MidiClip, DawClip, RollFx, AutoPoint } from '@/lib/daw-types'
import MotionCurve from './MotionCurve'
import { isMidiClip } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { useDaw } from '@/lib/daw-state'
import EqCurve, { type EqVals } from './EqCurve'
import { fxHasAudibleField, FX_FIELDS, fieldIsSet } from '@/lib/roll-fx'
import { getPresets } from '@/lib/midi-presets'
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
  const tier = useUITierOptional()?.tier ?? 'full'
  const soundAdvancedAllowed = tier === 'full'
  const effectiveMode: 'basic' | 'advanced' = soundAdvancedAllowed ? mode : 'basic'

  useLayoutEffect(() => {
    // Re-clamp when the panel grows (e.g. switching to Advanced) so its bottom
    // never runs off screen.
    clampToViewport(panelRef.current, anchor)
    // focus the panel so Escape works regardless of what else listens on document
    panelRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, effectiveMode])

  useEffect(() => {
    function onDown(e: Event) {
      // Inside the panel (clicking/dragging a control) → keep open.
      if (panelRef.current?.contains(e.target as Node)) return
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

  // FX Motion — a hand-drawn curve over the whole clip that morphs chosen effects
  // from neutral→target. Single MIDI clip only. Stored on clip.fxMotion.
  const motion = !multi && isMidiClip(clip) ? clip.fxMotion : undefined
  const DEFAULT_MOTION: AutoPoint[] = [
    { id: 'm0', t: 0, v: 1, smooth: false, h1: [0, 0], h2: [0, 0] },
    { id: 'm1', t: 1, v: 0, smooth: false, h1: [0, 0], h2: [0, 0] },
  ]
  const addMotion = () => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { fx: { filterHz: 500 }, graph: DEFAULT_MOTION } } })
  const setMotionGraph = (graph: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { fx: motion?.fx ?? {}, perNote: motion?.perNote, graph } } })
  const setMotionFx = (fx: RollFx | undefined) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { ...(motion ?? { graph: DEFAULT_MOTION }), fx: fx ?? {} } } })
  const setMotionPerNote = (perNote: boolean) => { if (motion) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: { ...motion, perNote } } }) }
  const clearMotion = () => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fxMotion: undefined } })

  // Per-field graph mode (a single FX slider ↔ a drawn curve). Switching either
  // way resets that parameter, so there's no messy conversion.
  const fxGraphs = !multi && isMidiClip(clip) ? clip.fxGraphs : undefined
  const graphsForCtl = fxGraphs
    ? Object.fromEntries(Object.entries(fxGraphs).map(([k, g]) => [k, g!.graph]))
    : undefined
  const cloneGraphs = () => ({ ...((isMidiClip(clip) && clip.fxGraphs) || {}) }) as NonNullable<MidiClip['fxGraphs']>
  const toggleFieldGraph = (key: keyof RollFx, on: boolean) => {
    const g = cloneGraphs()
    const rf: RollFx = { ...(clip.rollFx ?? {}) }
    if (on) { delete rf[key]; g[key] = { graph: DEFAULT_MOTION } }   // slider → graph, reset scalar
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
  const DEFAULT_AMP: AutoPoint[] = [
    { id: 'a0', t: 0, v: 0, smooth: false, h1: [0, 0], h2: [0, 0] },
    { id: 'a1', t: 0.08, v: 1, smooth: false, h1: [0, 0], h2: [0, 0] },
    { id: 'a2', t: 0.6, v: 0.75, smooth: false, h1: [0, 0], h2: [0, 0] },
    { id: 'a3', t: 1, v: 0, smooth: false, h1: [0, 0], h2: [0, 0] },
  ]
  const toggleAmpGraph = (on: boolean) => {
    if (on) {
      const rf: RollFx = { ...(clip.rollFx ?? {}) }
      delete rf.attack; delete rf.decay; delete rf.sustainLevel; delete rf.sustain
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { ampGraph: DEFAULT_AMP, rollFx: Object.keys(rf).length ? rf : undefined } })
    } else {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { ampGraph: undefined } })
    }
  }
  const setAmpGraph = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { ampGraph: pts } })

  // Drawn pitch contour per note (0.5 = in tune, up = sharp, down = flat).
  const pitchGraph = !multi && isMidiClip(clip) ? clip.pitchGraph : undefined
  const DEFAULT_PITCH: AutoPoint[] = [
    { id: 'p0', t: 0, v: 0.4, smooth: false, h1: [0, 0], h2: [0, 0] },
    { id: 'p1', t: 0.12, v: 0.5, smooth: false, h1: [0, 0], h2: [0, 0] },
    { id: 'p2', t: 1, v: 0.5, smooth: false, h1: [0, 0], h2: [0, 0] },
  ]
  const togglePitchGraph = (on: boolean) => {
    if (on) {
      const rf: RollFx = { ...(clip.rollFx ?? {}) }
      delete rf.pitchEnv; delete rf.pitchEnvTime; delete rf.vibratoDepth; delete rf.detune
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { pitchGraph: DEFAULT_PITCH, rollFx: Object.keys(rf).length ? rf : undefined } })
    } else {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { pitchGraph: undefined } })
    }
  }
  const setPitchGraph = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { pitchGraph: pts } })

  // Custom LFO shape (one cycle) used by this clip's tremolo / auto-pan / wah /
  // vibrato instead of a sine.
  const lfoShape = !multi && isMidiClip(clip) ? clip.lfoShape : undefined
  const DEFAULT_LFO: AutoPoint[] = [
    { id: 'l0', t: 0, v: 1, smooth: false, h1: [0, 0], h2: [0, 0] },
    { id: 'l1', t: 1, v: 0, smooth: false, h1: [0, 0], h2: [0, 0] },
  ]
  const toggleLfoShape = (on: boolean) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { lfoShape: on ? DEFAULT_LFO : undefined } })
  const setLfoShape = (pts: AutoPoint[]) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { lfoShape: pts } })

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

  // Rename the clip (track item) from here — single clip only.
  const [nameDraft, setNameDraft] = useState(clip.name)
  useEffect(() => { setNameDraft(clip.name) }, [clip.id, clip.name])
  function commitName() {
    const name = nameDraft.trim()
    if (name && name !== clip.name) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { name } })
    else if (!name) setNameDraft(clip.name)
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }
  const label: React.CSSProperties = { fontSize: 10, color: 'var(--text-secondary)', width: 70, flexShrink: 0 }
  const clipBtn = (enabled: boolean): React.CSSProperties => ({
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
            style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', flexShrink: 0, border: '1px solid var(--border-light)', background: mode === 'advanced' ? 'rgb(var(--accent-rgb) / 0.15)' : 'var(--bg-card)', color: mode === 'advanced' ? CYAN : 'var(--text-secondary)' }}>
            {mode === 'basic' ? 'ADVANCED ▸' : '◂ BASIC'}
          </button>
        )}
      </div>

      {/* Rename this track item (single clip only) */}
      {!multi && (
        <div style={{ ...row, paddingTop: 9 }}>
          <span style={label}>Name</span>
          <input
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
            spellCheck={false}
            placeholder="Clip name"
            style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border-light)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>
      )}

      {/* Sound / preset (single MIDI clip only) */}
      {showPreset && (
        <div style={{ ...row, paddingTop: 9 }}>
          <span style={label}>Sound</span>
          {onChangeSound ? (
            <button onClick={onChangeSound} title="Change the sound preset"
              style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 10, color: 'var(--text-primary)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationColor: 'var(--border-light)', textUnderlineOffset: 2 }}>
              {presetLabel}
            </button>
          ) : (
            <span style={{ flex: 1, fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{presetLabel}</span>
          )}
          {canPreview && onPreviewSound && (
            <button onClick={onPreviewSound} title="Listen — plays middle C"
              style={{ border: 'none', background: 'transparent', color: CYAN, cursor: 'pointer', fontSize: 10, padding: '2px 4px', flexShrink: 0 }}>▶</button>
          )}
          {onChangeSound && (
            <button onClick={onChangeSound}
              style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)', flexShrink: 0 }}>
              Change…
            </button>
          )}
        </div>
      )}
      {/* Tone presets — flavours within the instrument (single MIDI clip) */}
      {showPreset && tones.length > 0 && (
        <div style={{ ...row, alignItems: 'flex-start', paddingTop: 3, paddingBottom: 2 }}>
          <span style={{ ...label, paddingTop: 3 }}>Tone</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
            {tones.map(t => {
              const on = toneMatches(clip.rollFx, t)
              return (
                <button key={t.name}
                  onClick={() => commitFx(applyTone(clip.rollFx, t))}
                  title={`${t.name} tone — a starting point you can fine-tune with the sliders below`}
                  style={{
                    fontSize: 9.5, fontWeight: 600, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    border: on ? `1px solid ${CYAN}` : '1px solid var(--border-light)',
                    background: on ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)',
                    color: on ? CYAN : 'var(--text-secondary)',
                  }}>
                  {t.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Articulation — connected-note phrasing, options depend on the instrument */}
      {showArtic && artOpts && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '7px 12px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>ARTICULATION</span>
            <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>connected notes only</span>
          </div>
          {artOpts.legato.available && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: artOpts.slide.available ? 6 : 0 }}>
              <button
                onClick={() => commitFx({ ...(clip.rollFx || {}), legato: legatoOn ? 0 : 1 })}
                title="Legato: across a run of touching/overlapping notes, only the first attacks — the rest keep the bow/breath moving (no re-attack). Notes after a gap start fresh."
                style={{
                  fontSize: 9.5, fontWeight: 600, padding: '3px 9px', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                  border: legatoOn ? `1px solid ${CYAN}` : '1px solid var(--border-light)',
                  background: legatoOn ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)',
                  color: legatoOn ? CYAN : 'var(--text-secondary)',
                }}>
                {legatoOn ? '✓ Legato' : 'Legato'}
              </button>
              <span style={{ fontSize: 8.5, color: 'var(--text-muted)', flex: 1, lineHeight: 1.3 }}>
                {legatoAuto ? 'auto for this instrument — first note attacks, the phrase flows' : legatoOn ? 'bow/breath carries across the phrase' : 'every note re-attacks'}
              </span>
            </div>
          )}
          {artOpts.slide.available && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 44, flexShrink: 0 }}>Slide</span>
              <input type="range" min={0} max={1} step={0.02} value={slideAmt}
                onChange={e => commitFx({ ...(clip.rollFx || {}), slide: Number(e.target.value) })}
                title="Portamento: glide the pitch from the previous note into this one, between connected notes at different pitches."
                style={{ flex: 1, minWidth: 0, accentColor: CYAN }} />
              <span style={{ fontSize: 9.5, color: slideAmt > 0 ? 'var(--text-primary)' : 'var(--text-muted)', width: 40, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {slideAmt > 0 ? `${Math.round(slideAmt * 100)}%` : 'Off'}
              </span>
            </div>
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
        >{flash ? 'Copied ✓' : `⧉ Copy${hereCount ? ` (${hereCount})` : ''}`}</button>
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
        >{reverted ? '⟳ Reverted' : '⟲ Revert'}</button>
        <span style={{ flex: 1 }} />
      </div>

      {/* Volume + Tone EQ — one system, shared verbatim with the Mixer strip.
          Edits track.volume + track.tone, so moving a band here moves the mixer's
          EQ curve too (and vice-versa). Track-scoped by design. */}
      {eqTrack && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>VOLUME &amp; EQ</span>
            <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{eqMultiTrack ? `${trackIds.length} tracks · same as mixer` : 'same as mixer'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 44, flexShrink: 0 }}>Volume</span>
            <input type="range" min={0} max={1.2} step={0.005} value={trackVol}
              onChange={e => setTrackVol(Number(e.target.value))}
              style={{ flex: 1, minWidth: 0, accentColor: CYAN }} />
            <span style={{ fontSize: 9.5, color: 'var(--text-primary)', width: 40, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{Math.round(trackVol * 100)}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <EqCurve value={tone} onChange={setTrackBand} onChangeAll={setTrackToneAll} width={120} height={54} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.3 }}>
              {(['sub', 'bass', 'mid', 'treble'] as const).map(b => {
                const v = tone[b] ?? 0
                return <span key={b} style={{ color: v ? 'var(--text-primary)' : 'var(--text-muted)' }}>{b[0].toUpperCase() + b.slice(1)} {v > 0 ? '+' : ''}{v || 0}dB</span>
              })}
            </div>
          </div>
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
        onToggleGraph={!multi && isMidiClip(clip) ? toggleFieldGraph : undefined}
        onGraphChange={!multi && isMidiClip(clip) ? setFieldGraph : undefined}
      />

      {/* Amplitude envelope — draw the note's volume shape instead of the
          attack/decay/sustain sliders. Single MIDI clip. */}
      {!multi && isMidiClip(clip) && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '9px 12px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>AMPLITUDE</span>
            {ampGraph
              ? <button onClick={() => toggleAmpGraph(false)} title="Back to attack/decay/sustain sliders" style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>Sliders</button>
              : <button onClick={() => toggleAmpGraph(true)} title="Draw the note's volume shape" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${CYAN}`, background: 'rgb(var(--accent-rgb) / 0.16)', color: CYAN }}>◠ Draw</button>}
          </div>
          {ampGraph && (
            <>
              <MotionCurve points={ampGraph} onChange={setAmpGraph} width={276} height={78} color={CYAN} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-muted)', margin: '3px 2px 4px' }}>
                <span>note start</span><span>volume shape · per note · scaled by velocity</span><span>end</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* LFO shape — draw one cycle used by the clip's tremolo/auto-pan/wah/vibrato. */}
      {!multi && isMidiClip(clip) && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '9px 12px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>LFO SHAPE</span>
            {lfoShape
              ? <button onClick={() => toggleLfoShape(false)} title="Back to a sine LFO" style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>Sine</button>
              : <button onClick={() => toggleLfoShape(true)} title="Draw a custom LFO waveform" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${CYAN}`, background: 'rgb(var(--accent-rgb) / 0.16)', color: CYAN }}>◠ Draw</button>}
          </div>
          {lfoShape && (
            <>
              <MotionCurve points={lfoShape} onChange={setLfoShape} width={276} height={68} color={CYAN} />
              <div style={{ display: 'flex', justifyContent: 'center', fontSize: 8, color: 'var(--text-muted)', margin: '3px 2px 4px' }}>
                <span>one cycle · drives tremolo · auto-pan · wah · vibrato</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Pitch contour — draw the note's pitch bend (scoops, falls). Single MIDI clip. */}
      {!multi && isMidiClip(clip) && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '9px 12px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>PITCH</span>
            {pitchGraph
              ? <button onClick={() => togglePitchGraph(false)} title="Remove pitch contour" style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>Off</button>
              : <button onClick={() => togglePitchGraph(true)} title="Draw a per-note pitch bend" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${CYAN}`, background: 'rgb(var(--accent-rgb) / 0.16)', color: CYAN }}>◠ Draw</button>}
          </div>
          {pitchGraph && (
            <>
              <MotionCurve points={pitchGraph} onChange={setPitchGraph} width={276} height={78} color={CYAN} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-muted)', margin: '3px 2px 4px' }}>
                <span>−12 st</span><span>middle line = in tune · per note</span><span>+12 st</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* FX Motion — draw a curve over the whole clip that morphs chosen effects
          from neutral (bottom) → their dialed-in target (top). Single MIDI clip. */}
      {!multi && isMidiClip(clip) && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '9px 12px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>FX MOTION</span>
            {motion
              ? <button onClick={clearMotion} title="Remove FX motion" style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>Remove</button>
              : <button onClick={addMotion} title="Add an FX motion curve" style={{ fontSize: 9, fontWeight: 700, padding: '2px 9px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${CYAN}`, background: 'rgb(var(--accent-rgb) / 0.16)', color: CYAN }}>+ Add</button>}
          </div>
          {motion ? (
            <>
              <MotionCurve points={motion.graph} onChange={setMotionGraph} width={276} height={88} color={CYAN} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 2px 8px' }}>
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{motion.perNote ? 'per note' : 'clip start'}</span>
                <div style={{ display: 'flex', gap: 3 }}>
                  {([['Whole clip', false], ['Per note', true]] as const).map(([lbl, pn]) => {
                    const on = !!motion.perNote === pn
                    return (
                      <button key={lbl} onClick={() => setMotionPerNote(pn)}
                        title={pn ? 'Re-trigger the shape on every note' : 'One shape stretched across the whole clip'}
                        style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: on ? `1px solid ${CYAN}` : '1px solid var(--border-light)', background: on ? 'rgb(var(--accent-rgb) / 0.16)' : 'var(--bg-card)', color: on ? CYAN : 'var(--text-secondary)' }}>{lbl}</button>
                    )
                  })}
                </div>
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{motion.perNote ? 'note end' : 'end'}</span>
              </div>
              <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginBottom: 3, lineHeight: 1.35 }}>Effects that follow the curve — pick one or more; the top of the graph = these values:</div>
              <FxControls value={motion.fx} onCommit={setMotionFx} hideCats={['env', 'pitch']} mode="advanced" />
            </>
          ) : (
            <p style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.45, margin: 0 }}>Draw a curve that morphs chosen effects across the clip — e.g. a filter that opens over time, reverb that swells, or drive that fades. One or more effects can follow the same curve.</p>
          )}
        </div>
      )}

      <div style={{ padding: '8px 12px 0', fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Applies to this clip’s notes only — live and on export. To bake a sound into a reusable, shareable preset, use the sound menu’s <strong>New preset</strong>.
      </div>
    </div>,
    document.body,
  )
}
