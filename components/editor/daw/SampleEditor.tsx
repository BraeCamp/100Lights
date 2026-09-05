'use client'

// The Sample Editor — Live's Clip View for an audio clip, in the clip pane.
//
// The full waveform with trim handles at both edges and the playhead riding
// over it; along its top the detected transients (grey ticks) and the warp
// markers (yellow) that pin moments of the sample to beats of the clip
// (lib/warp.ts); beside it the clip panel (Live's Audio Utilities): Warp
// on/off, the warp mode, Seg. BPM with ÷2 and ×2, Gain in dB, Pitch and
// Detune, Reverse, the Fade switch, the sample's facts, and Save Default
// Clip. The arithmetic is lib/sample-editor.ts; the defaults store is
// lib/clip-defaults.ts; the transient detector is lib/onsets.ts; the palette
// registers every control here, and the ⌘I family is the 'sample' key scope.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip, type AudioClip } from '@/lib/daw-types'
import { useRegisterCommands } from '@/lib/commands'
import { resolveKey, keysFor } from '@/lib/keymap'
import Waveform from './Waveform'
import Knob from './Knob'
import { nativeSeconds, segBpmOf, setSegBpm, gainToDb, dbToGain, trimByDrag, sampleFraction, sampleDetails, describeSample, warpSpeed, slipByDrag, cropSample, isSharedPatch } from '@/lib/sample-editor'
import { saveClipDefaults, clipDefaultsKey, useClipDefaults } from '@/lib/clip-defaults'
import { detectOnsets, monoOf } from '@/lib/onsets'
import { validMarkers, sortMarkers, beatToSec, secToBeat, insertMarker, moveMarker, removeMarker, set111Here, warpStraight, warpAsLoop, warpAtBpm, quantizeTransients, type WarpMarker } from '@/lib/warp'
import { useQuantizeSettings, gridLabel } from '@/lib/quantize'
import { WARP_MODE_LABEL, DEFAULT_BEATS, DEFAULT_TONES, DEFAULT_TEXTURE, type WarpModeName } from '@/lib/warp-modes'
import { sliceToNewTrack, convertToNewTrack } from '@/lib/audio-to-track'
import { CONVERT_LABEL, type SliceBy, type ConvertKind } from '@/lib/slice-to-midi'
import SliceDialog from './SliceDialog'

export default function SampleEditor({ clipId }: { clipId: string }) {
  const { project, dispatch, engine, selectedClipIds } = useDaw()
  const clip = project.arrangementClips.find(c => c.id === clipId)
  if (!clip || !isAudioClip(clip)) return null
  // Multi-clip editing: the other selected audio clips take the settings a
  // selection can share (lib/sample-editor.ts SHARED_CLIP_FIELDS).
  const others = project.arrangementClips.filter(c => c.id !== clipId && isAudioClip(c) && selectedClipIds?.has(c.id)) as AudioClip[]
  return <Editor clip={clip} others={others} dispatch={dispatch} engine={engine} tempo={project.tempo} barBeats={project.timeSignatureNum || 4} trackColor={project.tracks.find(t => t.id === clip.trackId)?.color ?? 'var(--accent)'} />
}

const GRID = 0.25   // a sixteenth: where an inserted marker's beat lands

function Editor({ clip, others, dispatch, engine, tempo, barBeats, trackColor }: {
  clip: AudioClip
  others: AudioClip[]
  dispatch: ReturnType<typeof useDaw>['dispatch']
  engine: ReturnType<typeof useDaw>['engine']
  tempo: number
  barBeats: number
  trackColor: string
}) {
  // A setting a selection can share goes to every selected audio clip; a
  // number that describes THIS sample (its trims, markers, Seg BPM, length)
  // stays here, however many clips are selected.
  const patch = (p: Partial<AudioClip>) => {
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: p })
    if (others.length && isSharedPatch(p as Record<string, unknown>)) {
      for (const o of others) {
        engine.clearStretchedCache(o.id)
        dispatch({ type: 'UPDATE_CLIP', clipId: o.id, patch: p })
      }
    }
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(120, Math.floor(el.clientWidth))))
    ro.observe(el)
    setWidth(Math.max(120, Math.floor(el.clientWidth)))
    return () => ro.disconnect()
  }, [])

  // The playhead over the sample — only while the transport runs.
  const [playFrac, setPlayFrac] = useState<number | null>(null)
  useEffect(() => {
    let raf = 0, timer = 0
    const tick = () => {
      if (engine.isPlaying) {
        const rel = engine.currentBeat - clip.startBeat
        setPlayFrac(rel >= 0 && rel <= clip.durationBeats ? sampleFraction(clip, rel) : null)
        raf = requestAnimationFrame(tick)
      } else {
        setPlayFrac(null)
        timer = window.setTimeout(tick, 250)
      }
    }
    tick()
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [engine, clip])

  const buf = engine.bufferCache.get(clip.id)
  const details = buf ? sampleDetails(buf) : null
  const total = clip.bufferDuration ?? buf?.duration ?? null
  const native = nativeSeconds({ ...clip, bufferDuration: total ?? undefined })
  const segBpm = segBpmOf({ ...clip, bufferDuration: total ?? undefined })
  const warp = clip.warpEnabled === true
  const mode: WarpModeName = clip.warpMode ?? 'repitch'
  const beatsP = { ...DEFAULT_BEATS, ...(clip.warpBeats ?? {}) }
  const tonesP = { ...DEFAULT_TONES, ...(clip.warpTones ?? {}) }
  const textureP = { ...DEFAULT_TEXTURE, ...(clip.warpTexture ?? {}) }
  const defaults = useClipDefaults()
  const key = clipDefaultsKey(clip)
  const saved = key ? !!defaults[key] : false
  const [savedFlash, setSavedFlash] = useState(false)
  const start = clip.trimStart ?? 0
  const end = total != null ? total - (clip.trimEnd ?? 0) : null

  // ── Transients and warp markers (lib/onsets.ts, lib/warp.ts) ───────────
  const detected = useMemo(() => (buf ? detectOnsets(monoOf(buf), buf.sampleRate, { minGapMs: 40 }).map(o => o.t) : []), [buf])
  const transients = useMemo(() => [...new Set([...detected, ...(clip.transients ?? [])])].sort((a, b) => a - b), [detected, clip.transients])
  const markers: WarpMarker[] = useMemo(() => sortMarkers(clip.warpMarkers ?? []), [clip.warpMarkers])
  const liveMap = validMarkers(markers)
  const [cursorSec, setCursorSec] = useState<number | null>(null)
  const [selMarker, setSelMarker] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; sec: number } | null>(null)
  // Audio → MIDI (lib/audio-to-track.ts): the slice dialog, what is running, what it said.
  const [slicing, setSlicing] = useState(false)
  const [slipping, setSlipping] = useState(false)
  const [toMidiBusy, setToMidiBusy] = useState<string | null>(null)
  const [toMidiSaid, setToMidiSaid] = useState('')
  useEffect(() => { setSelMarker(null); setCursorSec(null); setMenu(null) }, [clip.id])
  // The grid the transients quantize to: the Quantize Settings' (lib/quantize.ts),
  // a beat when those follow the editor, or the chooser beside the button.
  const qSettings = useQuantizeSettings()
  const [qGridOverride, setQGridOverride] = useState<number | null>(null)
  const qGrid = qGridOverride ?? qSettings.grid ?? 1

  function setMarkers(ms: WarpMarker[], extra: Partial<AudioClip> = {}) {
    engine.clearStretchedCache(clip.id)
    patch({ warpMarkers: ms.length ? ms : undefined, warpEnabled: ms.length ? true : clip.warpEnabled, ...extra })
  }
  /** The map to build on: the live one, else a straight one across the clip. */
  const baseMap = (): WarpMarker[] => liveMap ?? (end != null && end > start ? warpStraight(start, end, clip.durationBeats) : [])
  const secToClipBeat = (sec: number) => { const m = baseMap(); return m.length >= 2 ? secToBeat(m, sec) : 0 }
  const clipBeatToSec = (beat: number) => { const m = baseMap(); return m.length >= 2 ? beatToSec(m, beat) : start }
  function insertAt(sec: number) {
    const base = baseMap()
    if (base.length < 2) return
    const beat = Math.max(0, Math.round(secToBeat(base, sec) / GRID) * GRID)
    const next = insertMarker(base, beat, sec)
    setMarkers(next)
    setSelMarker(next.findIndex(m => Math.abs(m.sec - sec) < 0.002))
  }
  function insertTransientAt(sec: number) { patch({ transients: [...new Set([...(clip.transients ?? []), Math.round(sec * 1000) / 1000])] }) }
  function set111(sec: number) { setMarkers(set111Here(baseMap(), sec)) }
  function straight() { if (end != null) setMarkers(warpStraight(start, end, clip.durationBeats)) }
  function asLoop(bars: number) {
    if (end == null) return
    const ms = warpAsLoop(start, end, bars, barBeats)
    setMarkers(ms, { durationBeats: bars * barBeats, segBpm: Math.round(((bars * barBeats) / (end - start)) * 60 * 100) / 100 })
  }
  function atSegBpm() {
    if (end == null) return
    const bpm = segBpm ?? tempo
    const ms = warpAtBpm(start, end, bpm)
    setMarkers(ms, { segBpm: bpm, durationBeats: ms[1].beat })
  }
  function quantizeAll() { setMarkers(quantizeTransients(baseMap(), transients.filter(t => t >= start && (end == null || t <= end)), qGrid)) }
  function clearWarp() { setMarkers([]); setSelMarker(null) }
  function dragMarker(index: number, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    if (total == null) return
    setSelMarker(index)
    const startX = e.clientX
    const at = markers
    const sec0 = at[index]?.sec ?? 0
    const onMove = (ev: MouseEvent) => setMarkers(moveMarker(at, index, sec0 + ((ev.clientX - startX) / width) * total))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  function handleKey(e: React.KeyboardEvent) {
    const kb = resolveKey(e, ['sample'])?.id
    if (!kb) return
    e.preventDefault(); e.stopPropagation()
    if (kb === 'sample.insertWarpMarker' && cursorSec != null) insertAt(cursorSec)
    else if (kb === 'sample.insertTransient' && cursorSec != null) insertTransientAt(cursorSec)
    else if (kb === 'sample.deleteMarker' && selMarker != null) { setMarkers(removeMarker(markers, selMarker)); setSelMarker(null) }
    else if (kb === 'sample.markerPrev' || kb === 'sample.markerNext') {
      if (!markers.length) return
      const i = selMarker == null ? (kb === 'sample.markerNext' ? 0 : markers.length - 1) : Math.max(0, Math.min(markers.length - 1, selMarker + (kb === 'sample.markerNext' ? 1 : -1)))
      setSelMarker(i)
    } else if ((kb === 'sample.nudgeLeft' || kb === 'sample.nudgeRight') && selMarker != null) {
      setMarkers(moveMarker(markers, selMarker, markers[selMarker].sec + (kb === 'sample.nudgeRight' ? 0.001 : -0.001)))
    } else if (kb === 'sample.crop') crop()
    else if (kb === 'sample.slipLeft' || kb === 'sample.slipRight') slip(kb === 'sample.slipRight' ? 0.01 : -0.01)
  }

  function dragTrim(edge: 'start' | 'end', e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    if (total == null) return
    const startX = e.clientX
    const at = { bufferDuration: total, trimStart: clip.trimStart ?? 0, trimEnd: clip.trimEnd ?? 0 }
    const onMove = (ev: MouseEvent) => {
      const p = trimByDrag(at, edge, ((ev.clientX - startX) / width) * total)
      if (p) patch(p)
    }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  // Slip edit: the audio slides under the clip, which stays put. ⇧⌥-drag the
  // waveform, or ⇧⌥← / ⇧⌥→ by 10 ms (lib/sample-editor.ts).
  function slip(deltaSec: number) {
    const p = slipByDrag({ ...clip, bufferDuration: total ?? undefined }, deltaSec)
    if (!p) return
    engine.clearStretchedCache(clip.id)
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: p })
  }
  function dragSlip(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    if (total == null) return
    const startX = e.clientX
    const at = { bufferDuration: total, trimStart: clip.trimStart ?? 0, trimEnd: clip.trimEnd ?? 0, warpMarkers: clip.warpMarkers }
    setSlipping(true)
    const onMove = (ev: MouseEvent) => {
      // ⚠️ Always from the ORIGINAL trims and markers: reading the clip as it
      // moves would compound every frame's delta and the audio would bolt.
      const p = slipByDrag(at, ((ev.clientX - startX) / width) * total)
      if (p) { engine.clearStretchedCache(clip.id); dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: p }) }
    }
    const onUp = () => { setSlipping(false); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  // Crop: throw away the audio the clip never plays.
  const cropPatch = cropSample({ ...clip, bufferDuration: total ?? undefined }, tempo)
  function crop() {
    if (!cropPatch) { setToMidiSaid(warp || clip.loopEnabled ? 'Nothing to crop — the clip plays all of its sample.' : 'Nothing to crop — the clip already ends with its audio.'); return }
    engine.clearStretchedCache(clip.id)
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: cropPatch })
  }

  function applySegBpm(bpm: number) {
    const p = setSegBpm({ ...clip, bufferDuration: total ?? undefined }, bpm)
    engine.clearStretchedCache(clip.id)
    if (p) patch(p); else patch({ segBpm: bpm })
  }
  function setWarp(on: boolean) { engine.clearStretchedCache(clip.id); patch({ warpEnabled: on }) }
  function setMode(m: WarpModeName) { engine.clearStretchedCache(clip.id); patch({ warpMode: m, warpEnabled: true }) }
  // Tempo leader (lib/tempo-leader.ts): this clip's own tempo drives the song.
  // It needs a tempo to give — two markers, or a Seg BPM once the sample has loaded.
  const leader = clip.tempoLeader === true
  const canLead = markers.length >= 2 || segBpm != null
  function toggleLeader() { dispatch({ type: 'SET_TEMPO_LEADER', clipId: leader ? null : clip.id }) }
  // Slice to New MIDI Track / Convert to MIDI (lib/audio-to-track.ts): a new track beside this clip; the audio stays.
  async function bufferFor() { return engine.bufferCache.get(clip.id) ?? (await engine.loadClipBuffer(clip)) ?? null }
  async function slice(by: SliceBy, max: number) {
    setToMidiBusy('slice')
    try {
      const buf = await bufferFor()
      if (!buf) { setToMidiSaid('The sample has not loaded yet.'); return }
      const r = await sliceToNewTrack(clip, buf, { tempo, barBeats, by, max }, dispatch)
      setToMidiSaid(r.said); setSlicing(false)
    } finally { setToMidiBusy(null) }
  }
  async function toMidi(kind: ConvertKind) {
    setToMidiBusy(kind)
    try {
      const buf = await bufferFor()
      if (!buf) { setToMidiSaid('The sample has not loaded yet.'); return }
      const r = await convertToNewTrack(clip, buf, { tempo, kind }, dispatch)
      setToMidiSaid(r.said)
    } finally { setToMidiBusy(null) }
  }
  function setModeParams(p: Partial<AudioClip>) { engine.clearStretchedCache(clip.id); patch(p) }
  function saveDefault() {
    if (saveClipDefaults(clip)) { setSavedFlash(true); window.setTimeout(() => setSavedFlash(false), 1500) }
  }

  const speed = segBpm ? warpSpeed(tempo, segBpm) : 1
  useRegisterCommands([
    { id: 'clip.warp', group: 'Clip', label: warp ? 'Stop warping the clip — play it at its own tempo' : 'Warp the clip — follow the song’s tempo',
      keywords: 'warp clip tempo follow stretch sample audio', run: () => setWarp(!warp) },
    { id: 'clip.warpMode.repitch', group: 'Clip', label: 'Warp mode: Re-Pitch — speed and pitch move together',
      keywords: 'warp mode re-pitch repitch turntable vinyl', run: () => setMode('repitch') },
    { id: 'clip.warpMode.complex', group: 'Clip', label: 'Warp mode: Complex — stretch, keep the pitch',
      keywords: 'warp mode complex stretch keep pitch wsola', run: () => setMode('stretch') },
    { id: 'clip.warpMode.beats', group: 'Clip', label: 'Warp mode: Beats — slice at the transients, each hit as recorded',
      keywords: 'warp mode beats drums slice transients preserve loop envelope', run: () => setMode('beats') },
    { id: 'clip.warpMode.tones', group: 'Clip', label: 'Warp mode: Tones — a longer grain for pitched, single-line material',
      keywords: 'warp mode tones vocal bass monophonic grain', run: () => setMode('tones') },
    { id: 'clip.warpMode.texture', group: 'Clip', label: 'Warp mode: Texture — granular, with Flux',
      keywords: 'warp mode texture granular pads noise grain flux', run: () => setMode('texture') },
    { id: 'clip.tempoLeader', group: 'Clip', label: leader ? 'Release the tempo leader — the song keeps the tempo it has' : 'Make this clip the tempo leader — the song follows its tempo',
      keywords: 'tempo leader master clip follow song tempo drives warp markers seg bpm', when: () => leader || canLead, run: toggleLeader },
    // Slip and crop (lib/sample-editor.ts).
    { id: 'clip.slipBack', group: 'Clip', label: 'Slip the audio 10 ms earlier under the clip',
      keywords: 'slip slide audio under clip earlier back offset nudge sample', shortcut: keysFor('sample.slipLeft'), run: () => slip(-0.01) },
    { id: 'clip.slipFwd', group: 'Clip', label: 'Slip the audio 10 ms later under the clip',
      keywords: 'slip slide audio under clip later forward offset nudge sample', shortcut: keysFor('sample.slipRight'), run: () => slip(0.01) },
    { id: 'clip.cropSample', group: 'Clip', label: 'Crop the sample to what the clip plays',
      keywords: 'crop sample trim away unused audio past the end tighten', shortcut: keysFor('sample.crop'), when: () => !!cropPatch, run: crop },
    // Audio → MIDI (lib/audio-to-track.ts).
    { id: 'clip.slice', group: 'Clip', label: 'Slice to New MIDI Track… — every transient a pad, a MIDI clip playing them',
      keywords: 'slice slicing new midi track drum rack pads transients chop sample audio to midi', run: () => setSlicing(true) },
    // Spelled out, not mapped: the discoverability check reads these literally.
    { id: 'clip.toMidi.harmony', group: 'Clip', label: 'Convert Harmony to MIDI — every voice heard, on a new track',
      keywords: 'convert harmony to midi audio to midi transcribe chords notes pitch new track', run: () => void toMidi('harmony') },
    { id: 'clip.toMidi.melody', group: 'Clip', label: 'Convert Melody to MIDI — one line, on a new track',
      keywords: 'convert melody to midi audio to midi transcribe line tune notes pitch new track', run: () => void toMidi('melody') },
    { id: 'clip.toMidi.drums', group: 'Clip', label: 'Convert Drums to MIDI — kick, snare and hat from the attacks, on a new drum track',
      keywords: 'convert drums to midi audio to midi transcribe beat kick snare hat attacks new drum track', run: () => void toMidi('drums') },
    { id: 'clip.segDouble', group: 'Clip', label: `Seg BPM ×2 — the sample tempo doubles${segBpm ? ` (${Math.round(segBpm * 2)})` : ''}`,
      keywords: 'seg bpm sample tempo double octave off original tempo', when: () => segBpm != null, run: () => segBpm && applySegBpm(segBpm * 2) },
    { id: 'clip.segHalve', group: 'Clip', label: `Seg BPM ÷2 — the sample tempo halves${segBpm ? ` (${Math.round(segBpm / 2)})` : ''}`,
      keywords: 'seg bpm sample tempo halve half octave off original tempo', when: () => segBpm != null, run: () => segBpm && applySegBpm(segBpm / 2) },
    { id: 'clip.pitchUp', group: 'Clip', label: 'Pitch the clip up a semitone', keywords: 'clip pitch up semitone transpose audio',
      run: () => { engine.clearPitchCache(clip.id); patch({ pitchSemitones: Math.min(24, (clip.pitchSemitones ?? 0) + 1) }) } },
    { id: 'clip.pitchDown', group: 'Clip', label: 'Pitch the clip down a semitone', keywords: 'clip pitch down semitone transpose audio',
      run: () => { engine.clearPitchCache(clip.id); patch({ pitchSemitones: Math.max(-24, (clip.pitchSemitones ?? 0) - 1) }) } },
    { id: 'clip.fade', group: 'Clip', label: clip.clipFade ? 'Clip fade off' : 'Clip fade — a 4 ms edge fade so cuts never click',
      keywords: 'clip fade edge fade click declick', run: () => patch({ clipFade: !clip.clipFade }) },
    { id: 'clip.saveDefault', group: 'Clip', label: 'Save default clip — remember these settings for this sample',
      keywords: 'save default clip sample settings remember asd', when: () => !!key, run: saveDefault },
    { id: 'clip.details', group: 'Clip', label: details ? `Sample details — ${describeSample(details)}` : 'Sample details — loading',
      keywords: 'sample details rate channels length bit depth', run: () => {} },
    // Warp markers (lib/warp.ts).
    ...[1, 2, 4, 8].map(bars => ({ id: `clip.warpLoop${bars}`, group: 'Clip', label: `Warp as ${bars}-bar loop — the whole sample is ${bars} bar${bars === 1 ? '' : 's'}`,
      keywords: 'warp as loop bars whole sample markers', when: () => end != null, run: () => asLoop(bars) })),
    { id: 'clip.warpStraight', group: 'Clip', label: 'Warp from here (straight) — one steady speed across the clip',
      keywords: 'warp straight steady speed markers from here', when: () => end != null, run: straight },
    { id: 'clip.warpAtBpm', group: 'Clip', label: `Warp at the Seg BPM (${segBpm ?? tempo}) from here`,
      keywords: 'warp at bpm seg bpm from here markers straight', when: () => end != null, run: atSegBpm },
    { id: 'clip.set111', group: 'Clip', label: 'Set 1.1.1 here — the insert point becomes the first beat',
      keywords: 'set 1.1.1 here downbeat first beat insert point warp marker', when: () => cursorSec != null, run: () => cursorSec != null && set111(cursorSec) },
    { id: 'clip.quantizeTransients', group: 'Clip', label: `Quantize transients to the grid — ${transients.length} attack${transients.length === 1 ? '' : 's'} onto ${gridLabel(qGrid)} notes`,
      keywords: 'quantize transients audio grid warp markers attacks tighten', when: () => transients.length > 0 && end != null, run: quantizeAll },
    { id: 'clip.insertWarpMarker', group: 'Clip', label: 'Insert a warp marker at the insert point',
      keywords: 'insert warp marker insert point cursor', shortcut: '⌘I', when: () => cursorSec != null, run: () => cursorSec != null && insertAt(cursorSec) },
    { id: 'clip.clearWarp', group: 'Clip', label: `Clear the warp markers (${markers.length})`,
      keywords: 'clear warp markers remove all reset', when: () => markers.length > 0, run: clearWarp },
  ], [clip.id, warp, mode, segBpm, clip.pitchSemitones, clip.clipFade, key, details?.sampleRate, details?.channels, details?.seconds, end, cursorSec, transients.length, markers, tempo, barBeats, qGrid, clip.warpBeats, clip.warpTones, clip.warpTexture, leader, canLead, toMidiBusy, cropPatch, others.length])

  const chip = (on: boolean, disabled = false): React.CSSProperties => ({
    fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.45 : 1,
    border: on ? '1px solid rgb(var(--accent-rgb) / 0.5)' : '1px solid var(--border)',
    background: on ? 'rgb(var(--accent-rgb) / 0.18)' : 'transparent', color: on ? 'var(--accent-light)' : 'var(--text-secondary)',
  })
  const lab: React.CSSProperties = { fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', width: 46, flexShrink: 0 }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minHeight: 24 }
  const ts = total ? (clip.trimStart ?? 0) / total : 0
  const te = total ? (clip.trimEnd ?? 0) / total : 0
  const xOf = (sec: number) => (total ? (sec / total) * width : 0)
  const secAt = (clientX: number) => { const r = wrapRef.current?.getBoundingClientRect(); return r && total ? Math.max(0, Math.min(total, ((clientX - r.left) / width) * total)) : 0 }
  const menuItem: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', fontSize: 11, padding: '5px 10px', background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }

  return (
    <div ref={rootRef} data-help-id="sample-editor" tabIndex={-1} onKeyDown={handleKey} style={{ display: 'flex', height: '100%', minHeight: 0, outline: 'none' }}>
      {/* The waveform with its trim handles, transients and warp markers */}
      <div ref={wrapRef} data-slipping={slipping ? '1' : undefined} style={{ flex: 1, position: 'relative', minWidth: 0, background: 'var(--bg-base)', cursor: slipping ? 'ew-resize' : undefined }}
        onMouseDown={e => {
          rootRef.current?.focus()
          if (e.button !== 0) return
          // ⇧⌥-drag slides the audio under the clip (lib/sample-editor.ts).
          if (e.shiftKey && e.altKey) { dragSlip(e); return }
          const r = wrapRef.current!.getBoundingClientRect()
          // The lower half places the insert point; the upper half is the markers'.
          if (e.clientY - r.top > r.height * 0.35) { setCursorSec(secAt(e.clientX)); setSelMarker(null) }
        }}
        onDoubleClick={e => { const r = wrapRef.current!.getBoundingClientRect(); if (e.clientY - r.top <= r.height * 0.35 && total != null) insertAt(secAt(e.clientX)) }}
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, sec: secAt(e.clientX) }) }}>
        {clip.waveformPeaks?.length ? (
          <Waveform peaks={clip.waveformPeaks} color={trackColor} width={width} height={Math.max(60, (wrapRef.current?.clientHeight ?? 120))}
            trimStart={ts} trimEnd={te} playhead={playFrac ?? undefined} style={{ display: 'block' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Loading the sample…</div>
        )}
        {/* The beat grid through the map, while warping with markers */}
        {warp && liveMap && total != null && Array.from({ length: Math.floor(clip.durationBeats) + 1 }, (_, b) => b).map(b => {
          const x = xOf(clipBeatToSec(b))
          if (x < 0 || x > width) return null
          return <div key={b} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: 1, background: b % barBeats === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)', pointerEvents: 'none', zIndex: 1 }} />
        })}
        {/* Transient markers: the detected attacks (grey ticks along the top) */}
        {total != null && transients.map((t, i) => (
          <div key={`t${i}`} data-help-id="transient-marker" data-sec={t} title={`Transient at ${t.toFixed(3)} s — double-click for a warp marker here`}
            onDoubleClick={e => { e.stopPropagation(); insertAt(t) }} onMouseDown={e => e.stopPropagation()}
            style={{ position: 'absolute', top: 0, left: xOf(t) - 2, width: 5, height: 9, background: 'rgba(255,255,255,0.45)', borderRadius: '0 0 2px 2px', cursor: 'pointer', zIndex: 4 }} />
        ))}
        {/* Warp markers (yellow): drag slides the audio under the beat; double-click removes */}
        {total != null && markers.map((m, i) => (
          <div key={`w${i}`} data-help-id="warp-marker" data-beat={m.beat} data-sec={m.sec} aria-selected={selMarker === i}
            title={`Warp marker — beat ${+m.beat.toFixed(3)} at ${m.sec.toFixed(3)} s; drag to slide the audio, double-click to remove`}
            onMouseDown={e => dragMarker(i, e)} onDoubleClick={e => { e.stopPropagation(); setMarkers(removeMarker(markers, i)); setSelMarker(null) }}
            style={{ position: 'absolute', top: 0, left: xOf(m.sec) - 6, width: 12, height: 14, cursor: 'ew-resize', zIndex: 5,
              clipPath: 'polygon(0 0, 100% 0, 50% 100%)', background: selMarker === i ? '#fde68a' : '#f59e0b', outline: selMarker === i ? '1px solid #fff' : 'none' }} />
        ))}
        {total != null && (
          <>
            <div data-help-id="trim-start" data-seconds={clip.trimStart ?? 0} onMouseDown={e => dragTrim('start', e)} title={`Trim start — ${(clip.trimStart ?? 0).toFixed(3)} s in; drag`}
              style={{ position: 'absolute', top: 0, bottom: 0, left: Math.max(0, ts * width - 3), width: 6, cursor: 'ew-resize', background: 'rgb(var(--accent-rgb) / 0.7)', zIndex: 3 }} />
            <div data-help-id="trim-end" data-seconds={clip.trimEnd ?? 0} onMouseDown={e => dragTrim('end', e)} title={`Trim end — ${(clip.trimEnd ?? 0).toFixed(3)} s off the end; drag`}
              style={{ position: 'absolute', top: 0, bottom: 0, left: Math.min(width - 3, (1 - te) * width - 3), width: 6, cursor: 'ew-resize', background: 'rgb(var(--accent-rgb) / 0.7)', zIndex: 3 }} />
          </>
        )}
        {cursorSec != null && total != null && (
          <div data-help-id="sample-insert-point" data-sec={cursorSec} style={{ position: 'absolute', top: 0, bottom: 0, left: xOf(cursorSec), width: 1, background: 'rgba(255,255,255,0.6)', pointerEvents: 'none', zIndex: 2 }} />
        )}
        {clip.loopEnabled && (
          <div title="Looping across the clip" style={{ position: 'absolute', top: 0, left: ts * width, right: te * width, height: 4, background: 'rgb(var(--accent-rgb) / 0.55)', zIndex: 2 }} />
        )}
        <div style={{ position: 'absolute', left: 8, bottom: 4, fontSize: 9, color: 'var(--text-muted)', pointerEvents: 'none' }}>
          {native != null ? `${native.toFixed(3)} s playing${total != null && native < total - 1e-6 ? ` of ${total.toFixed(3)} s` : ''}` : ''}
          {liveMap ? ` · ${liveMap.length} warp markers` : ''}
          {cursorSec != null ? ` · insert at ${cursorSec.toFixed(3)} s (beat ${+secToClipBeat(cursorSec).toFixed(2)})` : ''}
        </div>
        {slicing && <SliceDialog barBeats={barBeats} hasMarkers={markers.length >= 2} busy={toMidiBusy === 'slice'} onSlice={(by, max) => void slice(by, max)} onClose={() => setSlicing(false)} />}
        {menu && createPortal(
          <div role="menu" data-help-id="warp-menu" style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 330), zIndex: 9999, minWidth: 220, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0', boxShadow: '0 10px 28px rgba(0,0,0,0.6)' }}
            onMouseLeave={() => setMenu(null)}>
            <button role="menuitem" style={menuItem} onClick={() => { set111(menu.sec); setMenu(null) }}>Set 1.1.1 here</button>
            <button role="menuitem" style={menuItem} onClick={() => { straight(); setMenu(null) }}>Warp from here (straight)</button>
            {[1, 2, 4, 8].map(b => <button key={b} role="menuitem" style={menuItem} onClick={() => { asLoop(b); setMenu(null) }}>Warp as {b}-bar loop</button>)}
            <button role="menuitem" style={menuItem} onClick={() => { atSegBpm(); setMenu(null) }}>Warp at {segBpm ?? tempo} BPM from here</button>
            <button role="menuitem" style={menuItem} onClick={() => { quantizeAll(); setMenu(null) }} disabled={!transients.length}>Quantize transients to the grid</button>
            <button role="menuitem" style={menuItem} onClick={() => { insertAt(menu.sec); setMenu(null) }}>Insert warp marker here</button>
            <button role="menuitem" style={menuItem} onClick={() => { insertTransientAt(menu.sec); setMenu(null) }}>Insert transient here</button>
            <button role="menuitem" style={{ ...menuItem, color: 'var(--text-muted)' }} onClick={() => { clearWarp(); setMenu(null) }} disabled={!markers.length}>Clear warp markers</button>
          </div>,
          document.body,
        )}
      </div>

      {/* The clip panel — Live's Audio Utilities */}
      <div data-help-id="clip-panel" style={{ width: 272, flexShrink: 0, borderLeft: '1px solid var(--border)', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', fontSize: 10, color: 'var(--text-secondary)' }}>
        <div data-help-id="sample-details" style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={details ? describeSample(details) : ''}>
          {details ? describeSample(details) : 'sample loading…'}
        </div>
        {/* Multi-clip editing: what a change here reaches (lib/sample-editor.ts) */}
        {others.length > 0 && (
          <div data-help-id="multi-clip" style={{ fontSize: 9, color: 'var(--accent-light)' }}
            title="Several audio clips are selected: level, pitch, reverse, the fades, looping and the warp settings go to all of them. The trims, the warp markers, Seg BPM and the clip's length stay with this one.">
            editing {others.length + 1} clips
          </div>
        )}
        <div style={row}>
          <span style={lab}>Warp</span>
          <button data-help-id="clip-warp" aria-pressed={warp} onClick={() => setWarp(!warp)} style={chip(warp)} title="Warp — follow the song's tempo; off plays the sample at its own">{warp ? 'On' : 'Off'}</button>
          <select data-help-id="clip-warp-mode" aria-label="Warp mode" value={mode} disabled={!warp} onChange={e => setMode(e.target.value as WarpModeName)}
            title="How the sample is fitted to the grid: Beats slices at the transients and plays each hit as recorded; Tones stretches with a long grain for pitched lines; Texture is granular; Re-Pitch changes speed and pitch together; Complex stretches and keeps the pitch"
            style={{ fontSize: 9, padding: '1px 2px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, opacity: warp ? 1 : 0.45 }}>
            {(['beats', 'tones', 'texture', 'repitch', 'stretch'] as WarpModeName[]).map(m => <option key={m} value={m}>{WARP_MODE_LABEL[m]}</option>)}
          </select>
          {/* Kept for the palette's sake and for a fast switch between the two oldest modes */}
          <button data-help-id="clip-warp-mode-repitch" aria-pressed={mode === 'repitch'} onClick={() => setMode('repitch')} style={chip(warp && mode === 'repitch', !warp)} title="Re-Pitch — speed and pitch move together, like a turntable">Re-Pitch</button>
          <button data-help-id="clip-warp-mode-complex" aria-pressed={mode === 'stretch'} onClick={() => setMode('stretch')} style={chip(warp && mode === 'stretch', !warp)} title="Complex — stretched to the tempo, pitch kept">Complex</button>
          <button data-help-id="clip-tempo-leader" aria-pressed={leader} disabled={!canLead} onClick={toggleLeader} style={chip(leader, !canLead)}
            title={leader ? 'Tempo leader — the song follows this clip\'s tempo; click to release' : canLead ? 'Make this clip the tempo leader — the song\'s tempo follows its warp markers (or its Seg BPM), so it plays as recorded and everything else keeps time with it' : 'Tempo leader — needs the sample loaded, or two warp markers'}>Leader</button>
        </div>
        {warp && mode === 'beats' && (
          <div style={row} data-help-id="warp-beats-params">
            <span style={lab}>Beats</span>
            <select data-help-id="beats-preserve" aria-label="Preserve" value={String(beatsP.preserve)} onChange={e => setModeParams({ warpBeats: { ...beatsP, preserve: e.target.value === 'transients' ? 'transients' : Number(e.target.value) } })}
              title="Preserve — cut at the transients, or at grid divisions" style={{ fontSize: 9, padding: '1px 2px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }}>
              <option value="transients">Transients</option>
              {[4, 2, 1, 0.5, 0.25, 0.125].map(g => <option key={g} value={g}>{g === 4 ? '1 bar' : gridLabel(g)}</option>)}
            </select>
            <select data-help-id="beats-loop" aria-label="Transient loop mode" value={beatsP.loop} onChange={e => setModeParams({ warpBeats: { ...beatsP, loop: e.target.value as 'off' | 'forward' | 'backforth' } })}
              title="Transient Loop Mode — what fills a gap after a slice: silence, the slice again, or the slice back and forth" style={{ fontSize: 9, padding: '1px 2px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }}>
              <option value="off">Loop Off</option><option value="forward">Forward</option><option value="backforth">Back &amp; Forth</option>
            </select>
            <Knob value={beatsP.envelope} defaultValue={100} size={22} spec={{ label: 'Transient envelope', min: 0, max: 100, unit: '%' }} onChange={v => setModeParams({ warpBeats: { ...beatsP, envelope: Math.round(v) } })} />
            <span data-help-id="beats-envelope" style={{ fontSize: 9, color: 'var(--text-muted)' }}>env {beatsP.envelope}</span>
          </div>
        )}
        {warp && mode === 'tones' && (
          <div style={row} data-help-id="warp-tones-params">
            <span style={lab}>Tones</span>
            <Knob value={tonesP.grainMs} defaultValue={100} size={22} spec={{ label: 'Grain size', min: 20, max: 400, unit: 'ms' }} onChange={v => setModeParams({ warpTones: { grainMs: Math.round(v) } })} />
            <span data-help-id="tones-grain" style={{ fontSize: 9, color: 'var(--text-muted)' }}>grain {tonesP.grainMs} ms</span>
          </div>
        )}
        {warp && mode === 'texture' && (
          <div style={row} data-help-id="warp-texture-params">
            <span style={lab}>Texture</span>
            <Knob value={textureP.grainMs} defaultValue={60} size={22} spec={{ label: 'Grain size', min: 5, max: 500, unit: 'ms' }} onChange={v => setModeParams({ warpTexture: { ...textureP, grainMs: Math.round(v) } })} />
            <span data-help-id="texture-grain" style={{ fontSize: 9, color: 'var(--text-muted)' }}>grain {textureP.grainMs} ms</span>
            <Knob value={textureP.flux * 100} defaultValue={20} size={22} spec={{ label: 'Flux', min: 0, max: 100, unit: '%' }} onChange={v => setModeParams({ warpTexture: { ...textureP, flux: Math.round(v) / 100 } })} />
            <span data-help-id="texture-flux" style={{ fontSize: 9, color: 'var(--text-muted)' }}>flux {Math.round(textureP.flux * 100)}</span>
          </div>
        )}
        {/* Slip the audio under the clip, and crop away what it never plays */}
        <div style={row} data-help-id="clip-slip">
          <span style={lab}>Slip</span>
          <button data-help-id="clip-slip-back" onClick={() => slip(-0.01)} style={chip(false)} title="Slip the audio 10 ms earlier under the clip — or ⇧⌥-drag the waveform to slide it">◀ 10 ms</button>
          <button data-help-id="clip-slip-fwd" onClick={() => slip(0.01)} style={chip(false)} title="Slip the audio 10 ms later under the clip">10 ms ▶</button>
          <button data-help-id="clip-crop" onClick={crop} disabled={!cropPatch} style={chip(false, !cropPatch)}
            title={cropPatch ? 'Crop the sample to what the clip plays — the audio past its end goes (⇧⌘J)' : 'Crop — nothing outside the clip to remove'}>Crop</button>
        </div>
        {/* Audio → MIDI (lib/audio-to-track.ts): a new track beside this clip */}
        <div style={row} data-help-id="clip-to-midi">
          <span style={lab}>To MIDI</span>
          <button data-help-id="clip-slice" onClick={() => setSlicing(true)} disabled={!!toMidiBusy} style={chip(false, !!toMidiBusy)}
            title="Slice to New MIDI Track — every transient (or warp marker, or grid step) becomes a pad of a new drum track, and a MIDI clip plays the pads where the slices sit">{toMidiBusy === 'slice' ? '…' : 'Slice…'}</button>
          {(['harmony', 'melody', 'drums'] as ConvertKind[]).map(k => (
            <button key={k} data-help-id={`clip-to-midi-${k}`} onClick={() => void toMidi(k)} disabled={!!toMidiBusy} style={chip(false, !!toMidiBusy)}
              title={k === 'harmony' ? 'Convert Harmony to MIDI — every voice heard, as notes on a new track' : k === 'melody' ? 'Convert Melody to MIDI — one line, as notes on a new track' : 'Convert Drums to MIDI — the attacks as kick, snare and hat on a new drum track'}>
              {toMidiBusy === k ? '…' : CONVERT_LABEL[k]}
            </button>
          ))}
        </div>
        {toMidiSaid && <div data-help-id="to-midi-result" style={{ fontSize: 9, color: 'var(--text-muted)' }}>{toMidiSaid}</div>}
        <div style={row}>
          <span style={lab}>Seg. BPM</span>
          <input data-help-id="clip-seg-bpm" type="number" min={20} max={999} step={0.01} value={segBpm ?? ''} placeholder="—"
            onChange={e => { const v = Number(e.target.value); if (v >= 20 && v <= 999) applySegBpm(v) }}
            aria-label="Sample tempo (Seg. BPM)" title="The sample's own tempo — the clip's length follows it; with Warp on the clip plays at song tempo over this"
            style={{ width: 58, fontSize: 10, padding: '2px 4px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }} />
          <button data-help-id="clip-seg-half" onClick={() => segBpm && applySegBpm(segBpm / 2)} disabled={!segBpm} style={chip(false, !segBpm)} title="÷2 — the detection was an octave high">÷2</button>
          <button data-help-id="clip-seg-double" onClick={() => segBpm && applySegBpm(segBpm * 2)} disabled={!segBpm} style={chip(false, !segBpm)} title="×2 — the detection was an octave low">×2</button>
          <span data-help-id="clip-speed" style={{ fontSize: 9, color: 'var(--text-muted)' }}>{warp && liveMap ? 'by markers' : warp && segBpm ? `${speed.toFixed(3)}×` : 'as recorded'}</span>
        </div>
        <div style={row}>
          <span style={lab}>Gain</span>
          <Knob value={gainToDb(clip.gain)} defaultValue={0} size={24} spec={{ label: 'Clip gain', min: -24, max: 12, unit: 'dB' }} onChange={db => patch({ gain: dbToGain(db) })} />
          <span data-help-id="clip-gain" style={{ minWidth: 48, fontVariantNumeric: 'tabular-nums' }}>{gainToDb(clip.gain) > -59 ? `${gainToDb(clip.gain) >= 0 ? '+' : ''}${gainToDb(clip.gain).toFixed(1)} dB` : '−inf'}</span>
          <button data-help-id="clip-reverse" aria-pressed={clip.reverse} onClick={() => patch({ reverse: !clip.reverse })} style={chip(clip.reverse)} title="Reverse — play the sample backwards">Rev</button>
          <button data-help-id="clip-fade" aria-pressed={!!clip.clipFade} onClick={() => patch({ clipFade: !clip.clipFade })} style={chip(!!clip.clipFade)} title="Fade — 4 ms fades at the clip's edges so cuts never click">Fade</button>
        </div>
        <div style={row}>
          <span style={lab}>Pitch</span>
          <Knob value={clip.pitchSemitones ?? 0} defaultValue={0} size={24} spec={{ label: 'Pitch', min: -24, max: 24, unit: 'st' }}
            onChange={v => { engine.clearPitchCache(clip.id); patch({ pitchSemitones: Math.round(v) }) }} />
          <span data-help-id="clip-pitch" style={{ minWidth: 36, fontVariantNumeric: 'tabular-nums', opacity: warp && mode === 'repitch' ? 0.45 : 1 }}>{(clip.pitchSemitones ?? 0) > 0 ? '+' : ''}{clip.pitchSemitones ?? 0} st</span>
          <Knob value={clip.pitchCents ?? 0} defaultValue={0} size={24} spec={{ label: 'Detune', min: -100, max: 100, unit: 'ct' }}
            onChange={v => { engine.clearPitchCache(clip.id); patch({ pitchCents: Math.round(v) }) }} />
          <span data-help-id="clip-detune" style={{ minWidth: 40, fontVariantNumeric: 'tabular-nums', opacity: warp && mode === 'repitch' ? 0.45 : 1 }}>{(clip.pitchCents ?? 0) > 0 ? '+' : ''}{clip.pitchCents ?? 0} ct</span>
          {warp && mode === 'repitch' && <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Re-Pitch sets the pitch by speed</span>}
        </div>
        <div style={row}>
          <span style={lab}>Markers</span>
          <span data-help-id="warp-markers" style={{ fontSize: 9, color: 'var(--text-muted)' }}>{liveMap ? `${liveMap.length} warp` : 'none'} · {transients.length} transient{transients.length === 1 ? '' : 's'}</span>
          <button data-help-id="clip-quantize-transients" onClick={quantizeAll} disabled={!transients.length || end == null} style={chip(false, !transients.length)} title={`Quantize transients — pin each attack to the nearest ${gridLabel(qGrid)} note`}>Quantize</button>
          <select data-help-id="clip-quantize-grid" aria-label="Transient quantize grid" value={qGrid} onChange={e => setQGridOverride(Number(e.target.value))} title="The grid the transients are pinned to"
            style={{ fontSize: 9, padding: '1px 2px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }}>
            {[1, 0.5, 0.25, 0.125].map(g => <option key={g} value={g}>{gridLabel(g)}</option>)}
          </select>
          <button data-help-id="clip-warp-clear" onClick={clearWarp} disabled={!markers.length} style={chip(false, !markers.length)} title="Clear the warp markers">Clear</button>
        </div>
        <div style={{ ...row, marginTop: 'auto' }}>
          <button data-help-id="clip-save-default" onClick={saveDefault} disabled={!key} style={chip(saved, !key)}
            title={key ? `Save Default Clip — remember warp, Seg BPM, gain, pitch, reverse and fades for this sample, so the next clip made from it starts this way${saved ? ' (saved)' : ''}` : 'This clip has no sample of its own to remember settings for'}>
            {savedFlash ? 'Saved ✓' : saved ? 'Default saved · Save again' : 'Save Default Clip'}
          </button>
        </div>
      </div>
    </div>
  )
}
