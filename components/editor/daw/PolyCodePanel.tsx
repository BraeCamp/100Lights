'use client'

// "Code" panel: write a script that generates MIDI notes + a poly synth patch
// with math. Clicking a track item loads its code to edit; "Add new" (templates)
// and "Duplicate" start a new item you can Listen to and add to the project.
// Track effects show below — each can be muted individually or clicked to select
// it on the project (the clip's own effects are edited in the code as rollFx).
import { useEffect, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import type { MidiClip, DawTrack, TrackEffect, TrackInstrument, PolyInstrumentParams } from '@/lib/daw-types'
import { playInstrumentNote } from '@/lib/daw-instruments'
import { runPolyCode, POLY_CODE_EXAMPLES, type GeneratedTrack } from '@/lib/poly-code'

const EFFECT_LABELS: Record<string, string> = {
  eq3: 'EQ3', compressor: 'Compressor', reverb: 'Reverb', delay: 'Delay', filter: 'Filter',
  saturator: 'Saturator', redux: 'Redux', autopan: 'Auto Pan', utility: 'Utility', lfo: 'LFO',
  noisegate: 'Noise Gate', deesser: 'De-esser', chorus: 'Chorus/Flanger',
  transientshaper: 'Transient Shaper', multibandcomp: 'Multiband Comp',
}

// Starter templates (moved off the top bar into the "Add new" menu).
const BLANK_TEMPLATE = `// Every script returns one object: a name, a synth patch, and notes.
// note(pitch, startBeat, lengthBeats, velocity) — pitch is a name like 'C4'.
return {
  name: 'New Sound',
  patch: {
    waveform: 'sawtooth',   // 'sine' | 'square' | 'sawtooth' | 'triangle'
    cutoff: 1500,           // filter brightness in Hz (20–20000)
    resonance: 2,           // filter emphasis (0.1–20)
    attack: 0.01,           // seconds to reach full volume
    release: 0.3,           // seconds to fade after a note ends
  },
  length: 8,                // clip length in beats
  notes: [
    note('C4', 0, 1),       // beat 0, one beat long
    note('E4', 1, 1),
    note('G4', 2, 2, 80),   // quieter (velocity 80)
    chord(4, 4, 'Cm7'),     // chords work too: 'C', 'Am', 'Gmaj7', 'F#m7'…
  ],
};`
const TEMPLATES: { label: string; code: string }[] = [
  { label: 'Blank', code: BLANK_TEMPLATE },
  ...POLY_CODE_EXAMPLES,
]

// In-panel cheatsheet — the language, one glance at a time.
const REFERENCE: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Notes',
    rows: [
      [`note('A3', 0, 1, 90)`, 'pitch, start beat, length in beats, velocity 1–127 (optional)'],
      [`chord(0, 4, 'Cm7')`, `chord names: C, Am, F#m7, Gmaj7, Bdim, Dsus4, E7…`],
      [`chord(0, 4, ['C3','E3','G3'])`, 'or spell it yourself — names or MIDI numbers'],
    ],
  },
  {
    title: 'Scales',
    rows: [
      [`const s = scale('C3', 'minor')`, 'major, minor, dorian, mixolydian, penta-min, blues…'],
      [`s.note(0)`, 'degree → pitch. 0 = root, 7 = an octave up, negatives go down'],
    ],
  },
  {
    title: 'Rhythm & patterns',
    rows: [
      [`euclid(16, 5)`, '5 hits spread evenly over 16 steps → [true/false…]'],
      [`rhythm('x..x..x.')`, 'x = hit, . = rest'],
      [`seq('0 2 4 7').repeat(2)`, 'a degree pattern; also .rev() .add(n) .euclid(p) .every(n, fn)'],
      [`.notes(s, { step: 0.5, vel: 90 })`, 'turn the pattern into notes on a scale'],
      [`const r = rand(42)`, 'seeded random: r() → 0..1, same result every run'],
    ],
  },
  {
    title: 'Patch (the sound)',
    rows: [
      [`waveform`, `'sine' (soft) | 'triangle' | 'square' (hollow) | 'sawtooth' (bright)`],
      [`cutoff, resonance`, 'filter: brightness in Hz (20–20000), emphasis (0.1–20)'],
      [`attack, decay, sustain, release`, 'the volume envelope, in seconds (sustain is 0–1)'],
      [`detune`, 'cents of drift between the two voices — fattens the sound'],
      [`lfoEnabled, lfoRate, lfoDepth, lfoTarget`, `wobble: rate in Hz, target 'filter' | 'pitch' | 'volume'`],
    ],
  },
  {
    title: 'Clip effects',
    rows: [
      [`rollFx: { reverbWet: 0.3, distortion: 0.2 }`, 'effects on just this clip: also filterHz, sustain, sub, bass, mid, treble'],
    ],
  },
]

const r3 = (x: number) => Math.round(x * 1000) / 1000

function patchToCode(track: DawTrack, clip: MidiClip | undefined, fallbackLen: number): string {
  const p = track.instrument.params as PolyInstrumentParams
  const patch =
    `{ waveform: '${p.waveform}', attack: ${p.attack}, decay: ${p.decay}, ` +
    `sustain: ${p.sustain}, release: ${p.release}, detune: ${p.detune}, ` +
    `filterType: '${p.filterType}', cutoff: ${p.filterCutoff}, resonance: ${p.filterResonance}, ` +
    `lfoEnabled: ${p.lfoEnabled}, lfoRate: ${p.lfoRate}, lfoDepth: ${p.lfoDepth}, ` +
    `lfoTarget: '${p.lfoTarget}', lfoWaveform: '${p.lfoWaveform}' }`
  const notesCode = clip && clip.notes.length
    ? clip.notes.map((n) => `  note(${n.pitch}, ${r3(n.startBeat)}, ${r3(n.durationBeats)}, ${n.velocity})`).join(',\n')
    : ''
  const rf = clip?.rollFx
  const rfEntries = rf ? Object.entries(rf).filter(([, v]) => v !== undefined) : []
  const rollLine = rfEntries.length
    ? `  rollFx: { ${rfEntries.map(([k, v]) => `${k}: ${v}`).join(', ')} },   // clip-only effects\n`
    : `  // rollFx: { reverbWet: 0.3, distortion: 0.2, filterHz: 1200 },  // clip-only effects — uncomment to add\n`
  return `// "${track.name}"${clip ? ` · clip "${clip.name}"` : ''}
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
    project, dispatch, engine, selectedClipId, expandedPianoRollClipId,
    setView, setSelectedTrackId, setSelectedClipId, setExpandedPianoRollClipId,
  } = useDaw()
  const [code, setCode] = useState(TEMPLATES[1]?.code ?? TEMPLATES[0].code)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GeneratedTrack | null>(null)
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null)
  const [editingClipId, setEditingClipId] = useState<string | null>(null)
  const [newItem, setNewItem] = useState(true)
  const [effectMutes, setEffectMutes] = useState<Record<string, boolean>>({})
  const [showTemplates, setShowTemplates] = useState(false)
  const [showReference, setShowReference] = useState(false)

  const bars = Math.max(1, Math.round(project.loopEnd / project.timeSignatureNum) || 4)
  const selId = expandedPianoRollClipId ?? selectedClipId
  const targetTrack = !newItem ? project.tracks.find((t) => t.id === editingTrackId) : undefined
  const effects = targetTrack?.effects ?? []
  const isEditingClip = !newItem && !!editingClipId

  // Clicking a track item loads its code to edit (unless composing a new item).
  useEffect(() => {
    if (!selId) return
    const clip = project.arrangementClips.find((c) => c.id === selId)
    if (!clip || clip.kind !== 'midi') return
    const track = project.tracks.find((t) => t.id === clip.trackId)
    if (!track || track.instrument.type !== 'poly') return
    setNewItem(false)
    setEditingTrackId(track.id)
    setEditingClipId(clip.id)
    setCode(patchToCode(track, clip as MidiClip, bars * project.timeSignatureNum))
    setPreview(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId])

  // Quietly re-run the code shortly after edits so the preview summary + the
  // drag payload stay in sync with what's typed (errors surface only on Listen).
  useEffect(() => {
    const h = setTimeout(async () => {
      const res = await runPolyCode(code, { tempo: project.tempo, bars })
      if (res.ok) setPreview(res.track)
    }, 500)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, project.tempo, bars])

  // Restore any per-effect mutes when the panel unmounts.
  const muteRef = useRef<{ trackId?: string; effects?: TrackEffect[]; mutes: Record<string, boolean> }>({ mutes: {} })
  muteRef.current = { trackId: targetTrack?.id, effects, mutes: effectMutes }
  useEffect(() => () => {
    const m = muteRef.current
    if (m.trackId && m.effects) {
      for (const e of m.effects) {
        if (m.mutes[e.id]) engine.getEffectHandle(m.trackId, e.id)?.setParam('enabled', e.params.enabled)
      }
    }
  }, [engine])

  function toggleEffectMute(eff: TrackEffect) {
    if (!targetTrack) return
    const on = !effectMutes[eff.id]
    setEffectMutes((m) => ({ ...m, [eff.id]: on }))
    engine.getEffectHandle(targetTrack.id, eff.id)?.setParam('enabled', on ? false : eff.params.enabled)
  }

  function selectEffect() {
    // Reveal this track's device chain in the bottom panel (its tab auto-opens
    // to Devices on track select). Track effects have no per-effect selection.
    if (!targetTrack) return
    setSelectedTrackId(targetTrack.id)
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

  async function listen() {
    const t = preview ?? (await run())
    if (!t || !t.notes.length) return
    if (engine.ctx.state !== 'running') { try { await engine.ctx.resume() } catch { /* ok */ } }
    const inst: TrackInstrument = { type: 'poly', params: t.params }
    const now = engine.ctx.currentTime + 0.06
    const spb = 60 / project.tempo
    for (const n of t.notes) {
      playInstrumentNote(engine.ctx, engine.masterGain, inst, n.pitch, n.velocity, now + n.startBeat * spb, n.durationBeats * spb)
    }
  }

  function makeClip(trackId: string, t: GeneratedTrack): MidiClip {
    return {
      kind: 'midi', id: crypto.randomUUID(), trackId, name: t.name, startBeat: 0,
      durationBeats: t.durationBeats,
      notes: t.notes.map((n) => ({ id: crypto.randomUUID(), ...n })), isDrumClip: false,
      ...(t.rollFx ? { rollFx: t.rollFx } : {}),
    }
  }

  async function addNewTrack() {
    const t = preview ?? (await run())
    if (!t) return
    if (t.notes.length === 0) { setError('No notes — return { notes: [...] }.'); return }
    const trackId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: trackId, name: t.name, instrument: { type: 'poly', params: t.params } })
    const clip = makeClip(trackId, t)
    dispatch({ type: 'ADD_CLIP', clip })
    setSelectedTrackId(trackId)
    setSelectedClipId(clip.id)
    setExpandedPianoRollClipId(clip.id)
    setView('arrangement')
    onDone?.()
  }

  async function saveToClip() {
    const t = preview ?? (await run())
    if (!t || !editingTrackId) return
    dispatch({ type: 'SET_INSTRUMENT', trackId: editingTrackId, instrument: { type: 'poly', params: t.params } })
    const clip = project.arrangementClips.find((c) => c.id === editingClipId && c.kind === 'midi') as MidiClip | undefined
    const notes = t.notes.map((n) => ({ id: crypto.randomUUID(), ...n }))
    if (clip) {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes, durationBeats: t.durationBeats, rollFx: t.rollFx } })
    } else if (notes.length) {
      dispatch({ type: 'ADD_CLIP', clip: makeClip(editingTrackId, t) })
    }
    setSelectedTrackId(editingTrackId)
    onDone?.()
  }

  function pickTemplate(tpl: { code: string }) {
    setNewItem(true); setEditingTrackId(null); setEditingClipId(null)
    setCode(tpl.code); setPreview(null); setError(null); setShowTemplates(false)
  }

  function duplicate() {
    // Turn whatever is in the editor into a new, unsaved item (a copy).
    setNewItem(true); setEditingTrackId(null); setEditingClipId(null)
    setPreview(null); setError(null)
  }

  const btn: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 6,
    cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Status — no code-changing suggestions here (templates live in "Add new"). */}
      <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>
          {isEditingClip ? `Editing this clip — Save applies changes` : 'New item — Add track (or drag it onto a track)'}
        </span>
        <button
          onClick={() => setShowReference(v => !v)}
          title="The helpers and patch fields, at a glance"
          style={{ ...btn, fontSize: 9.5, padding: '2px 8px',
            background: showReference ? 'var(--accent)' : 'var(--bg-card)',
            color: showReference ? '#fff' : 'var(--text-muted)', borderColor: showReference ? 'var(--accent)' : 'var(--border)' }}
        >
          Reference
        </button>
      </div>

      {/* Cheatsheet — the in-context lesson on the language. */}
      {showReference && (
        <div style={{ borderBottom: '1px solid var(--border)', maxHeight: 240, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-surface)', flexShrink: 0 }}>
          {REFERENCE.map(sec => (
            <div key={sec.title} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }}>{sec.title}</div>
              {sec.rows.map(([code, desc]) => (
                <div key={code} style={{ display: 'flex', gap: 8, marginBottom: 2, alignItems: 'baseline' }}>
                  <code style={{ fontSize: 10, color: 'var(--accent-light)', fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{code}</code>
                  <span style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>{desc}</span>
                </div>
              ))}
            </div>
          ))}
          <a href="/learn/code-a-poly-track-with-math" target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>
            Full guide with examples ↗
          </a>
        </div>
      )}

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

      {/* Track effect chain — each box can be muted or clicked to select it. */}
      {effects.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', maxHeight: 150, overflowY: 'auto', background: 'var(--bg-surface)' }}>
          <div style={{ padding: '5px 10px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Track FX · {targetTrack?.name} — click to select · mute to audition
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '0 10px 8px' }}>
            {effects.map((eff) => {
              const muted = !!effectMutes[eff.id] || !eff.params.enabled
              const params = Object.entries(eff.params).filter(([k]) => k !== 'enabled')
              return (
                <div key={eff.id} onClick={selectEffect}
                  title="Click to select this effect in the project"
                  style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', background: 'var(--bg-card)', opacity: muted ? 0.5 : 1, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)' }}>{EFFECT_LABELS[eff.type] ?? eff.type}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleEffectMute(eff) }}
                      title={effectMutes[eff.id] ? 'Un-mute this effect' : 'Mute this effect (audition)'}
                      style={{ ...btn, marginLeft: 'auto', fontSize: 9, padding: '2px 7px',
                        background: effectMutes[eff.id] ? 'var(--accent)' : 'var(--bg-app)',
                        color: effectMutes[eff.id] ? '#fff' : 'var(--text-muted)', borderColor: effectMutes[eff.id] ? 'var(--accent)' : 'var(--border)' }}>
                      {effectMutes[eff.id] ? 'muted' : 'mute'}
                    </button>
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
          <button onClick={listen} disabled={running} style={{ ...btn, opacity: running ? 0.6 : 1 }} title="Play the generated notes">
            {running ? '…' : '▶ Listen'}
          </button>
          <button onClick={() => setShowTemplates((v) => !v)} style={btn}>Add new ▾</button>
          <button onClick={duplicate} style={btn} title="Make a copy of this as a new item">Duplicate</button>
          <span
            draggable={!!preview}
            onDragStart={(e) => {
              if (!preview) { e.preventDefault(); return }
              e.dataTransfer.effectAllowed = 'copy'
              e.dataTransfer.setData('application/x-poly-generated', JSON.stringify({
                name: preview.name, params: preview.params, notes: preview.notes,
                durationBeats: preview.durationBeats, rollFx: preview.rollFx,
              }))
              e.dataTransfer.setData('text/plain', preview.name)
              const ghost = document.createElement('div')
              ghost.textContent = `♪ ${preview.name}`
              ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;background:var(--bg-card-hover);color:#a78bfa;border:1px solid #7c3aed;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;pointer-events:none'
              document.body.appendChild(ghost)
              e.dataTransfer.setDragImage(ghost, 0, 0)
              setTimeout(() => document.body.removeChild(ghost), 0)
            }}
            title={preview ? 'Drag onto a track to add this item' : 'Run once (Listen) to enable drag'}
            style={{ ...btn, cursor: preview ? 'grab' : 'not-allowed', opacity: preview ? 1 : 0.5, userSelect: 'none' }}>
            ⠿ Drag
          </span>
          <button onClick={isEditingClip ? saveToClip : addNewTrack} disabled={running}
            style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', marginLeft: 'auto' }}>
            {isEditingClip ? 'Save' : 'Add track'}
          </button>

          {showTemplates && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowTemplates(false)} />
              <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, zIndex: 41, minWidth: 160,
                background: 'var(--bg-card-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '3px 12px 4px' }}>Templates</div>
                {TEMPLATES.map((tpl) => (
                  <button key={tpl.label} onClick={() => pickTemplate(tpl)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                    {tpl.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
