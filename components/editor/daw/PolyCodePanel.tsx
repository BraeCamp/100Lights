'use client'

// "Code" panel: write a script that generates MIDI notes + a poly synth patch
// with math, run it in a sandboxed Worker, and either ADD a new poly track or
// EDIT the selected track / piano-roll clip in place. While editing it shows the
// track's effect chain in read-only boxes with a "Mute FX" audition toggle.
import { useEffect, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import type { MidiClip, DawTrack, TrackEffect, PolyInstrumentParams } from '@/lib/daw-types'
import { runPolyCode, POLY_CODE_EXAMPLES, type GeneratedTrack } from '@/lib/poly-code'

const EFFECT_LABELS: Record<string, string> = {
  eq3: 'EQ3', compressor: 'Compressor', reverb: 'Reverb', delay: 'Delay', filter: 'Filter',
  saturator: 'Saturator', redux: 'Redux', autopan: 'Auto Pan', utility: 'Utility', lfo: 'LFO',
  noisegate: 'Noise Gate', deesser: 'De-esser', chorus: 'Chorus/Flanger',
  transientshaper: 'Transient Shaper', multibandcomp: 'Multiband Comp',
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

/** Generate editable code from an existing poly track's patch + a clip. */
function patchToCode(track: DawTrack, clip: MidiClip | undefined, fallbackLen: number): string {
  const p = track.instrument.params as PolyInstrumentParams
  const patch =
    `{ waveform: '${p.waveform}', attack: ${p.attack}, decay: ${p.decay}, ` +
    `sustain: ${p.sustain}, release: ${p.release}, detune: ${p.detune}, ` +
    `filterType: '${p.filterType}', cutoff: ${p.filterCutoff}, resonance: ${p.filterResonance}, ` +
    `lfoEnabled: ${p.lfoEnabled}, lfoRate: ${p.lfoRate}, lfoDepth: ${p.lfoDepth}, ` +
    `lfoTarget: '${p.lfoTarget}', lfoWaveform: '${p.lfoWaveform}' }`
  const notesCode = clip && clip.notes.length
    ? clip.notes
        .map((n) => `  note(${n.pitch}, ${r3(n.startBeat)}, ${r3(n.durationBeats)}, ${n.velocity})`)
        .join(',\n')
    : ''
  const rf = clip?.rollFx
  const rfEntries = rf ? Object.entries(rf).filter(([, v]) => v !== undefined) : []
  const rollLine = rfEntries.length
    ? `  rollFx: { ${rfEntries.map(([k, v]) => `${k}: ${v}`).join(', ')} },   // clip-only effects\n`
    : `  // rollFx: { reverbWet: 0.3, distortion: 0.2, filterHz: 1200, sustain: 0, sub: 0, bass: 0, mid: 0, treble: 0 },  // clip-only effects — uncomment to add\n`
  return `// Editing "${track.name}"${clip ? ` · clip "${clip.name}"` : ''} — tweak the patch, notes, and this clip's effects (rollFx), then Save.
return {
  name: ${JSON.stringify(track.name)},
  patch: ${patch},
  length: ${clip?.durationBeats ?? fallbackLen},
${rollLine}  notes: [
${notesCode}
  ],
};`
}

function fmt(v: unknown): string {
  if (typeof v === 'number') return String(r3(v))
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  return String(v)
}

export default function PolyCodePanel({ onDone }: { onDone?: () => void } = {}) {
  const {
    project, dispatch, engine, selectedTrackId, selectedClipId, expandedPianoRollClipId,
    setView, setSelectedTrackId, setExpandedPianoRollClipId,
  } = useDaw()
  const [code, setCode] = useState(POLY_CODE_EXAMPLES[0].code)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GeneratedTrack | null>(null)
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null)
  const [editingClipId, setEditingClipId] = useState<string | null>(null)
  const [muteFx, setMuteFx] = useState(false)

  const bars = Math.max(1, Math.round(project.loopEnd / project.timeSignatureNum) || 4)

  // The clip currently in focus (piano roll open, or selected), and its track.
  const activeClip = project.arrangementClips.find(
    (c) => c.id === (editingClipId ?? expandedPianoRollClipId ?? selectedClipId),
  )
  const activeMidiClip = activeClip && activeClip.kind === 'midi' ? (activeClip as MidiClip) : undefined
  const targetTrackId = editingTrackId ?? activeMidiClip?.trackId ?? selectedTrackId
  const targetTrack = project.tracks.find((t) => t.id === targetTrackId)
  const canEdit = targetTrack?.instrument.type === 'poly'
  const effects = targetTrack?.effects ?? []

  // Restore any live FX mute when the panel unmounts.
  const muteRef = useRef<{ on: boolean; trackId?: string; effects?: TrackEffect[] }>({ on: false })
  muteRef.current = { on: muteFx, trackId: targetTrack?.id, effects }
  useEffect(() => () => {
    const m = muteRef.current
    if (m.on && m.trackId && m.effects) {
      for (const e of m.effects) engine.getEffectHandle(m.trackId, e.id)?.setParam('enabled', e.params.enabled)
    }
  }, [engine])

  function applyMute(on: boolean, t = targetTrack) {
    if (!t) return
    for (const e of t.effects) {
      engine.getEffectHandle(t.id, e.id)?.setParam('enabled', on ? false : e.params.enabled)
    }
  }

  async function run(): Promise<GeneratedTrack | null> {
    setRunning(true)
    setError(null)
    const res = await runPolyCode(code, { tempo: project.tempo, bars })
    setRunning(false)
    if (!res.ok) { setError(res.error); setPreview(null); return null }
    setPreview(res.track)
    return res.track
  }

  function makeClip(trackId: string, t: GeneratedTrack): MidiClip {
    return {
      kind: 'midi', id: crypto.randomUUID(), trackId, name: t.name, startBeat: 0,
      durationBeats: t.durationBeats,
      notes: t.notes.map((n) => ({ id: crypto.randomUUID(), ...n })), isDrumClip: false,
      ...(t.rollFx ? { rollFx: t.rollFx } : {}),
    }
  }

  async function addToProject() {
    const t = preview ?? (await run())
    if (!t) return
    if (t.notes.length === 0) { setError('No notes — return { notes: [...] }.'); return }
    const trackId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: trackId, name: t.name, instrument: { type: 'poly', params: t.params } })
    const clip = makeClip(trackId, t)
    dispatch({ type: 'ADD_CLIP', clip })
    setSelectedTrackId(trackId)
    setExpandedPianoRollClipId(clip.id)
    setView('arrangement')
    onDone?.()
  }

  async function saveToTrack() {
    const t = preview ?? (await run())
    if (!t || !editingTrackId) return
    dispatch({ type: 'SET_INSTRUMENT', trackId: editingTrackId, instrument: { type: 'poly', params: t.params } })
    const clip = (editingClipId
      ? project.arrangementClips.find((c) => c.id === editingClipId && c.kind === 'midi')
      : project.arrangementClips.find((c) => c.trackId === editingTrackId && c.kind === 'midi')) as MidiClip | undefined
    const notes = t.notes.map((n) => ({ id: crypto.randomUUID(), ...n }))
    if (clip) {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes, durationBeats: t.durationBeats, rollFx: t.rollFx } })
    } else if (notes.length) {
      dispatch({ type: 'ADD_CLIP', clip: makeClip(editingTrackId, t) })
    }
    setSelectedTrackId(editingTrackId)
    onDone?.()
  }

  function startEdit() {
    if (!targetTrack || targetTrack.instrument.type !== 'poly') return
    const clip = (activeMidiClip && activeMidiClip.trackId === targetTrack.id
      ? activeMidiClip
      : project.arrangementClips.find((c) => c.trackId === targetTrack.id && c.kind === 'midi')) as MidiClip | undefined
    setCode(patchToCode(targetTrack, clip, bars * project.timeSignatureNum))
    setEditingTrackId(targetTrack.id)
    setEditingClipId(clip?.id ?? null)
    setPreview(null)
    setError(null)
  }

  function reset() {
    setEditingTrackId(null); setEditingClipId(null)
    setCode(POLY_CODE_EXAMPLES[0].code); setPreview(null); setError(null)
    if (muteFx) { applyMute(false); setMuteFx(false) }
  }

  const btn: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6,
    cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', width: '100%', marginBottom: 2 }}>
          {editingTrackId ? 'Editing — Save applies your changes · ' : 'Generate a poly track with math · '}
          <a href="/learn/code-a-poly-track-with-math" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>how it works ↗</a>
        </span>
        {POLY_CODE_EXAMPLES.map((ex) => (
          <button key={ex.label} onClick={() => { setCode(ex.code); setPreview(null); setError(null); setEditingTrackId(null); setEditingClipId(null) }}
            style={{ ...btn, fontSize: 9.5, fontWeight: 600, padding: '3px 8px' }}>{ex.label}</button>
        ))}
      </div>

      <textarea
        value={code}
        onChange={(e) => { setCode(e.target.value); setPreview(null) }}
        spellCheck={false}
        style={{
          flex: 1, minHeight: 100, resize: 'none', border: 'none', outline: 'none',
          padding: '10px 12px', background: 'var(--bg-app)', color: 'var(--text-primary)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.5, tabSize: 2,
        }}
      />

      {/* Track effect chain — view only (these affect the whole track; the
          clip's own effects are edited in the code above as `rollFx`). */}
      {effects.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', maxHeight: 150, overflowY: 'auto', background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Track FX · {targetTrack?.name} ({effects.length}) · view only
            </span>
            <button
              onClick={() => { const n = !muteFx; setMuteFx(n); applyMute(n) }}
              title="Bypass the track's effects so you hear just the code (audition only — doesn't change the project)"
              style={{ ...btn, marginLeft: 'auto', fontSize: 9.5, padding: '3px 8px',
                background: muteFx ? 'var(--accent)' : 'var(--bg-card)',
                color: muteFx ? '#fff' : 'var(--text-primary)', borderColor: muteFx ? 'var(--accent)' : 'var(--border)' }}
            >
              {muteFx ? 'FX muted' : 'Mute FX'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '0 10px 8px' }}>
            {effects.map((eff) => {
              const bypassed = muteFx || !eff.params.enabled
              const params = Object.entries(eff.params).filter(([k]) => k !== 'enabled')
              return (
                <div key={eff.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', background: 'var(--bg-card)', opacity: bypassed ? 0.5 : 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
                    {EFFECT_LABELS[eff.type] ?? eff.type}{bypassed ? ' · bypassed' : ''}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                    {params.map(([k, v]) => <span key={k}>{k}: {fmt(v)}</span>)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        {error && <div style={{ fontSize: 10.5, color: 'var(--danger, #ef4444)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>{error}</div>}
        {preview && !error && (
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            “{preview.name}” · {preview.notes.length} note{preview.notes.length !== 1 ? 's' : ''} · {preview.durationBeats} beats · {preview.params.waveform}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={run} disabled={running} style={{ ...btn, opacity: running ? 0.6 : 1 }}>{running ? 'Running…' : 'Run'}</button>
          {canEdit && !editingTrackId && (
            <button onClick={startEdit} style={btn} title="Load this track/clip's sound + notes into the editor">
              Edit {activeMidiClip ? 'clip' : `“${targetTrack!.name}”`}
            </button>
          )}
          {editingTrackId && <button onClick={reset} style={btn}>New</button>}
          <button onClick={editingTrackId ? saveToTrack : addToProject} disabled={running}
            style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', marginLeft: 'auto' }}>
            {editingTrackId ? 'Save' : 'Add track'}
          </button>
        </div>
      </div>
    </div>
  )
}
