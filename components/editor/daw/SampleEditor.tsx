'use client'

// The Sample Editor — Live's Clip View for an audio clip, in the clip pane.
//
// The full waveform with trim handles at both edges and the playhead riding
// over it; beside it the clip panel (Live's Audio Utilities): Warp on/off,
// the warp mode, Seg. BPM with ÷2 and ×2, Gain in dB, Pitch and Detune,
// Reverse, the Fade switch, the sample's facts, and Save Default Clip. The
// arithmetic is lib/sample-editor.ts; the defaults store is
// lib/clip-defaults.ts; the palette registers every control here.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip, type AudioClip } from '@/lib/daw-types'
import { useRegisterCommands } from '@/lib/commands'
import Waveform from './Waveform'
import Knob from './Knob'
import { nativeSeconds, segBpmOf, setSegBpm, gainToDb, dbToGain, trimByDrag, sampleFraction, sampleDetails, describeSample, warpSpeed } from '@/lib/sample-editor'
import { saveClipDefaults, clipDefaultsKey, useClipDefaults } from '@/lib/clip-defaults'

export default function SampleEditor({ clipId }: { clipId: string }) {
  const { project, dispatch, engine } = useDaw()
  const clip = project.arrangementClips.find(c => c.id === clipId)
  if (!clip || !isAudioClip(clip)) return null
  return <Editor clip={clip} dispatch={dispatch} engine={engine} tempo={project.tempo} trackColor={project.tracks.find(t => t.id === clip.trackId)?.color ?? 'var(--accent)'} />
}

function Editor({ clip, dispatch, engine, tempo, trackColor }: {
  clip: AudioClip
  dispatch: ReturnType<typeof useDaw>['dispatch']
  engine: ReturnType<typeof useDaw>['engine']
  tempo: number
  trackColor: string
}) {
  const patch = (p: Partial<AudioClip>) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: p })
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
  const mode = clip.warpMode ?? 'repitch'
  const defaults = useClipDefaults()
  const key = clipDefaultsKey(clip)
  const saved = key ? !!defaults[key] : false
  const [savedFlash, setSavedFlash] = useState(false)

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

  function applySegBpm(bpm: number) {
    const p = setSegBpm({ ...clip, bufferDuration: total ?? undefined }, bpm)
    engine.clearStretchedCache(clip.id)
    if (p) patch(p); else patch({ segBpm: bpm })
  }
  function setWarp(on: boolean) { engine.clearStretchedCache(clip.id); patch({ warpEnabled: on }) }
  function setMode(m: 'repitch' | 'stretch') { engine.clearStretchedCache(clip.id); patch({ warpMode: m, warpEnabled: true }) }
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
  ], [clip.id, warp, mode, segBpm, clip.pitchSemitones, clip.clipFade, key, details?.sampleRate, details?.channels, details?.seconds])

  const chip = (on: boolean, disabled = false): React.CSSProperties => ({
    fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.45 : 1,
    border: on ? '1px solid rgb(var(--accent-rgb) / 0.5)' : '1px solid var(--border)',
    background: on ? 'rgb(var(--accent-rgb) / 0.18)' : 'transparent', color: on ? 'var(--accent-light)' : 'var(--text-secondary)',
  })
  const lab: React.CSSProperties = { fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', width: 46, flexShrink: 0 }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minHeight: 24 }
  const ts = total ? (clip.trimStart ?? 0) / total : 0
  const te = total ? (clip.trimEnd ?? 0) / total : 0

  return (
    <div data-help-id="sample-editor" style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* The waveform with its trim handles */}
      <div ref={wrapRef} style={{ flex: 1, position: 'relative', minWidth: 0, background: 'var(--bg-base)' }}>
        {clip.waveformPeaks?.length ? (
          <Waveform peaks={clip.waveformPeaks} color={trackColor} width={width} height={Math.max(60, (wrapRef.current?.clientHeight ?? 120))}
            trimStart={ts} trimEnd={te} playhead={playFrac ?? undefined} style={{ display: 'block' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Loading the sample…</div>
        )}
        {total != null && (
          <>
            <div data-help-id="trim-start" data-seconds={clip.trimStart ?? 0} onMouseDown={e => dragTrim('start', e)} title={`Trim start — ${(clip.trimStart ?? 0).toFixed(3)} s in; drag`}
              style={{ position: 'absolute', top: 0, bottom: 0, left: Math.max(0, ts * width - 3), width: 6, cursor: 'ew-resize', background: 'rgb(var(--accent-rgb) / 0.7)', zIndex: 3 }} />
            <div data-help-id="trim-end" data-seconds={clip.trimEnd ?? 0} onMouseDown={e => dragTrim('end', e)} title={`Trim end — ${(clip.trimEnd ?? 0).toFixed(3)} s off the end; drag`}
              style={{ position: 'absolute', top: 0, bottom: 0, left: Math.min(width - 3, (1 - te) * width - 3), width: 6, cursor: 'ew-resize', background: 'rgb(var(--accent-rgb) / 0.7)', zIndex: 3 }} />
          </>
        )}
        {clip.loopEnabled && (
          <div title="Looping across the clip" style={{ position: 'absolute', top: 0, left: ts * width, right: te * width, height: 4, background: 'rgb(var(--accent-rgb) / 0.55)', zIndex: 2 }} />
        )}
        <div style={{ position: 'absolute', left: 8, bottom: 4, fontSize: 9, color: 'var(--text-muted)', pointerEvents: 'none' }}>
          {native != null ? `${native.toFixed(3)} s playing${total != null && native < total - 1e-6 ? ` of ${total.toFixed(3)} s` : ''}` : ''}
        </div>
      </div>

      {/* The clip panel — Live's Audio Utilities */}
      <div data-help-id="clip-panel" style={{ width: 272, flexShrink: 0, borderLeft: '1px solid var(--border)', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', fontSize: 10, color: 'var(--text-secondary)' }}>
        <div data-help-id="sample-details" style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={details ? describeSample(details) : ''}>
          {details ? describeSample(details) : 'sample loading…'}
        </div>
        <div style={row}>
          <span style={lab}>Warp</span>
          <button data-help-id="clip-warp" aria-pressed={warp} onClick={() => setWarp(!warp)} style={chip(warp)} title="Warp — follow the song's tempo; off plays the sample at its own">{warp ? 'On' : 'Off'}</button>
          <button data-help-id="clip-warp-mode-repitch" aria-pressed={mode === 'repitch'} onClick={() => setMode('repitch')} style={chip(warp && mode === 'repitch', !warp)} title="Re-Pitch — speed and pitch move together, like a turntable">Re-Pitch</button>
          <button data-help-id="clip-warp-mode-complex" aria-pressed={mode === 'stretch'} onClick={() => setMode('stretch')} style={chip(warp && mode === 'stretch', !warp)} title="Complex — stretched to the tempo, pitch kept">Complex</button>
        </div>
        <div style={row}>
          <span style={lab}>Seg. BPM</span>
          <input data-help-id="clip-seg-bpm" type="number" min={20} max={999} step={0.01} value={segBpm ?? ''} placeholder="—"
            onChange={e => { const v = Number(e.target.value); if (v >= 20 && v <= 999) applySegBpm(v) }}
            aria-label="Sample tempo (Seg. BPM)" title="The sample's own tempo — the clip's length follows it; with Warp on the clip plays at song tempo over this"
            style={{ width: 58, fontSize: 10, padding: '2px 4px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }} />
          <button data-help-id="clip-seg-half" onClick={() => segBpm && applySegBpm(segBpm / 2)} disabled={!segBpm} style={chip(false, !segBpm)} title="÷2 — the detection was an octave high">÷2</button>
          <button data-help-id="clip-seg-double" onClick={() => segBpm && applySegBpm(segBpm * 2)} disabled={!segBpm} style={chip(false, !segBpm)} title="×2 — the detection was an octave low">×2</button>
          <span data-help-id="clip-speed" style={{ fontSize: 9, color: 'var(--text-muted)' }}>{warp && segBpm ? `${speed.toFixed(3)}×` : 'as recorded'}</span>
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
