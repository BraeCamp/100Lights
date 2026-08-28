'use client'

import { memo, useCallback , useMemo } from 'react'
import Knob from './Knob'
import { Play, Mic, Circle, X } from 'lucide-react'
import { useApolloMotion } from './ApolloMotion'
import { useDaw } from '@/lib/daw-state'
import { useState, useEffect } from 'react'
import { libraryGetAll, type LibraryEntry } from '@/lib/sound-library'
import { ensurePolySample } from '@/lib/poly-sample-cache'
import type {
  TrackInstrument, InstrumentType,
  FmInstrumentParams, DrumInstrumentParams, PolyInstrumentParams, PolyOscLayer, DrumPadSettings,
  Fm4OpInstrumentParams, Fm4OpOperator, Fm4OpAlgorithm,
  WavetableInstrumentParams,
} from '@/lib/daw-types'
import { defaultDrumInstrument, defaultFmInstrument, defaultPolyInstrument, defaultFm4opInstrument, defaultWavetableInstrument, POLY_PRESETS, defaultOscLayer, polyOscLayers } from '@/lib/daw-types'
import { previewNote } from '@/lib/daw-instruments'
import { FM_ALGORITHMS, FM_PRESETS } from '@/lib/fm-synth'
import { WAVETABLE_PRESETS } from '@/lib/wavetable-synth'
import { useIsMobile } from '@/lib/use-is-mobile'
import { initPatch as initApolloPatch } from '@/lib/apollo/patch'
import { FACTORY_PRESETS as APOLLO_FACTORY } from '@/lib/apollo/presets'
import type { ApolloInstrumentParams } from '@/lib/daw-types'
import dynamic from 'next/dynamic'
import type { ApolloCardScope } from '@/components/apps/apollo/ApolloCard'
// Lazy: the full Apollo UI only loads when a card is actually opened.
const ApolloCard = dynamic(() => import('@/components/apps/apollo/ApolloCard'), { ssr: false })
// Lazy for the same reason: the plugin registry fetches manifests, and a
// track that is not using a plugin should never pay for that.
const PluginPanel = dynamic(() => import('./PluginPanel'), { ssr: false })

const C = {
  bgBase:      '#141414',
  bgSurface:   '#1c1c1c',
  bgCard:      '#222222',
  border:      'var(--border)',
  accent:      'var(--accent)',
  textPrimary: '#e8e8e8',
  textMuted:   '#7c7c7c',
} as const

// ── Shared row components ──────────────────────────────────────────────────────

const SliderRow = memo(function SliderRow({ label, value, min, max, step = 0.01, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step?: number
  fmt?: (v: number) => string; onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
        <Knob value={value} min={min} max={max} defaultValue={value} size={30} color={C.accent}
          bipolar={min < 0 && max > 0}
          onChange={onChange}
          format={fmt ?? (v => v.toFixed(2))} />
      </div>
      <span style={{ width: 44, fontSize: 11, color: C.textPrimary, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {fmt ? fmt(value) : value.toFixed(2)}
      </span>
    </div>
  )
})

// Native <select> menu — a large, single touch target that replaces walls of
// tiny preset/type chips on mobile ("consolidate things into menus").
// Record the mic to a base64 data-URI so it can be baked onto a drum pad
// (DrumPadSettings.sample). Returns a stop() that resolves the recorded audio.
async function startMicRecording(): Promise<{ stop: () => Promise<string> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
    : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  rec.start()
  return {
    stop: () => new Promise<string>((resolve, reject) => {
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: mime || 'audio/webm' })
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result as string)
        fr.onerror = () => reject(new Error('read failed'))
        fr.readAsDataURL(blob)
      }
      try { rec.stop() } catch { reject(new Error('stop failed')) }
    }),
  }
}

function PresetMenu({ options, value, onPick, placeholder }: {
  options: { value: string; label: string }[]
  value?: string
  onPick: (v: string) => void
  placeholder?: string
}) {
  const has = value != null && options.some(o => o.value === value)
  return (
    <select
      value={has ? value : ''}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); if (e.target.value) onPick(e.target.value) }}
      style={{
        width: '100%', padding: '11px 12px', borderRadius: 8, fontSize: 15,
        border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary,
        WebkitAppearance: 'none', appearance: 'none', cursor: 'pointer',
      }}
    >
      <option value="" disabled>{placeholder ?? 'Choose…'}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function TypeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        flex: 1, padding: '5px 0', borderRadius: 4,
        border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? `${C.accent}22` : C.bgCard,
        color: active ? C.accent : C.textMuted,
        fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer',
      }}
    >{label}</button>
  )
}

function WaveRow({ label, value, onChange }: { label: string; value: OscillatorType; onChange: (v: OscillatorType) => void }) {
  const waves: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {waves.map(w => (
          <button
            key={w}
            onClick={e => { e.stopPropagation(); onChange(w) }}
            style={{
              flex: 1, padding: '3px 0', borderRadius: 3,
              border: `1px solid ${value === w ? C.accent : C.border}`,
              background: value === w ? `${C.accent}22` : C.bgCard,
              color: value === w ? C.accent : C.textMuted,
              fontSize: 10, cursor: 'pointer', textTransform: 'capitalize',
            }}
          >{w.slice(0, 3)}</button>
        ))}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      {children}
    </div>
  )
}

// ── Drum panel ─────────────────────────────────────────────────────────────────

type DrumHit = { label: string; pitch: number }
const DRUM_HITS: DrumHit[] = [
  { label: 'Kick', pitch: 36 }, { label: 'Snare', pitch: 38 },
  { label: 'Hi-Hat', pitch: 42 }, { label: 'Open Hat', pitch: 46 },
  { label: 'Clap', pitch: 39 }, { label: 'Rim', pitch: 51 },
  { label: 'Crash', pitch: 49 }, { label: 'Tom', pitch: 45 },
]

const DRUM_PAD_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6']

const DrumPanel = memo(function DrumPanel({ instrument, onSet }: {
  instrument: TrackInstrument
  onSet: (changes: Partial<DrumInstrumentParams>) => void
}) {
  const { engine } = useDaw()
  const p = instrument.params as DrumInstrumentParams
  const [selectedPad, setSelectedPad] = useState<number | null>(null)
  const [recorder, setRecorder] = useState<{ stop: () => Promise<string> } | null>(null)
  const [recErr, setRecErr] = useState('')
  const pads = p.pads ?? {}

  async function toggleRecord(pitch: number) {
    if (recorder) {
      try { const data = await recorder.stop(); updatePad(pitch, { sample: { id: crypto.randomUUID(), name: 'Recording', data } }) } catch { /* ok */ }
      setRecorder(null)
    } else {
      setRecErr('')
      try { setRecorder(await startMicRecording()) } catch { setRecErr('Microphone permission is needed to record.') }
    }
  }

  function getPad(pitch: number): DrumPadSettings {
    return pads[pitch] ?? { volume: 0.8, pitch: 0, pan: 0, mute: false }
  }
  function updatePad(pitch: number, changes: Partial<DrumPadSettings>) {
    const current = getPad(pitch)
    onSet({ pads: { ...pads, [pitch]: { ...current, ...changes } } })
  }

  const sel = selectedPad !== null ? getPad(selectedPad) : null
  const selHit = DRUM_HITS.find(h => h.pitch === selectedPad)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Pack selector */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['synth', '808'] as const).map(pack => (
          <button key={pack} onClick={e => { e.stopPropagation(); onSet({ pack }) }}
            style={{ padding: '3px 12px', borderRadius: 3, border: `1px solid ${p.pack === pack ? C.accent : C.border}`, background: p.pack === pack ? `${C.accent}22` : C.bgCard, color: p.pack === pack ? C.accent : C.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
            {pack === 'synth' ? 'Acoustic' : '808'}
          </button>
        ))}
      </div>

      {/* 16-pad grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
        {DRUM_HITS.map((hit, idx) => {
          const pad     = getPad(hit.pitch)
          const color   = DRUM_PAD_COLORS[idx % DRUM_PAD_COLORS.length]
          const isSelected = selectedPad === hit.pitch
          return (
            <div key={hit.pitch} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button
                onClick={e => { e.stopPropagation(); setSelectedPad(isSelected ? null : hit.pitch); previewNote(engine.ctx, engine.masterGain, instrument, hit.pitch) }}
                onMouseDown={e => e.stopPropagation()}
                style={{ padding: '10px 4px', borderRadius: 4, border: `2px solid ${isSelected ? color : pad.mute ? 'var(--text-muted)' : C.border}`, background: isSelected ? `${color}22` : pad.mute ? 'rgba(80,80,80,0.2)' : C.bgCard, color: pad.mute ? 'var(--text-muted)' : C.textPrimary, fontSize: 10, cursor: 'pointer', textAlign: 'center', transition: 'all 80ms', fontWeight: 700 }}
              >
                <div>{hit.label}</div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>{Math.round(pad.volume * 100)}%{pad.pitch !== 0 ? ` ${pad.pitch > 0 ? '+' : ''}${pad.pitch}` : ''}</div>
              </button>
            </div>
          )
        })}
      </div>

      {/* Per-pad detail editor */}
      {selectedPad !== null && sel !== null && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textPrimary, marginBottom: 2 }}>{selHit?.label ?? 'Pad'}</div>
          <SliderRow label="Volume" value={sel.volume} min={0} max={1} step={0.01} fmt={v => `${Math.round(v * 100)}%`} onChange={v => updatePad(selectedPad, { volume: v })} />
          <SliderRow label="Pitch"  value={sel.pitch}  min={-24} max={24} step={1} fmt={v => `${v > 0 ? '+' : ''}${v}st`} onChange={v => updatePad(selectedPad, { pitch: v })} />
          <SliderRow label="Pan"    value={sel.pan}    min={-1}  max={1}  step={0.01} fmt={v => v === 0 ? 'C' : v > 0 ? `R${Math.round(v * 100)}` : `L${Math.round(-v * 100)}`} onChange={v => updatePad(selectedPad, { pan: v })} />
          <label onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: C.textMuted }}>
            <input type="checkbox" checked={sel.mute} onChange={e => { e.stopPropagation(); updatePad(selectedPad, { mute: e.target.checked }) }} onClick={e => e.stopPropagation()} style={{ accentColor: C.accent }} />
            Mute
          </label>
          {/* Choke group — pads sharing a group cut each other off (hi-hats). */}
          <label onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.textMuted }}>
            <span style={{ width: 72, flexShrink: 0 }}>Choke</span>
            <select value={sel.chokeGroup === undefined ? 'auto' : String(sel.chokeGroup)}
              onClick={e => e.stopPropagation()}
              onChange={e => { e.stopPropagation(); const v = e.target.value; updatePad(selectedPad, { chokeGroup: v === 'auto' ? undefined : Number(v) }) }}
              style={{ flex: 1, background: C.bgSurface, border: `1px solid ${C.border}`, color: C.textPrimary, borderRadius: 3, padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
              <option value="auto">Auto — hi-hats cut each other</option>
              <option value="0">None — always rings out</option>
              <option value="1">Group 1</option>
              <option value="2">Group 2</option>
              <option value="3">Group 3</option>
            </select>
          </label>
          {/* Record a sample onto this pad from the mic (baked into the kit). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={e => { e.stopPropagation(); void toggleRecord(selectedPad) }}
              style={{ flex: 1, padding: '6px 0', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                border: `1px solid ${recorder ? '#ef4444' : C.border}`, background: recorder ? 'rgba(239,68,68,0.16)' : C.bgCard, color: recorder ? '#ef4444' : C.textPrimary }}>
              {recorder ? <><Circle size={12} /> Stop & use</> : <><Mic size={12} /> {sel.sample ? 'Re-record' : 'Record sample'}</>}
            </button>
            {sel.sample && !recorder && (
              <button onClick={e => { e.stopPropagation(); updatePad(selectedPad, { sample: undefined }) }}
                title="Remove recorded sample (back to the synth pad)"
                style={{ padding: '6px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', border: `1px solid ${C.border}`, background: C.bgCard, color: C.textMuted }}>Clear</button>
            )}
          </div>
          {recErr && <div style={{ fontSize: 10, color: '#ef4444' }}>{recErr}</div>}
          {sel.sample && !recorder && <div style={{ fontSize: 9.5, color: C.textMuted }}>🎙 {sel.sample.name || 'Recorded sample'} plays on this pad.</div>}
        </div>
      )}
    </div>
  )
})

// ── FM panel ───────────────────────────────────────────────────────────────────

const FmPanel = memo(function FmPanel({ instrument, trackId, onSet }: {
  instrument: TrackInstrument; trackId: string
  onSet: (changes: Partial<FmInstrumentParams>) => void
}) {
  const { engine } = useDaw()
  const p = instrument.params as FmInstrumentParams
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Section title="Waveform">
        <WaveRow label="" value={p.waveform} onChange={w => onSet({ waveform: w })} />
      </Section>
      <Section title="Envelope">
        <SliderRow label="Attack"  value={p.attack}  min={0.001} max={2}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ attack: v })} />
        <SliderRow label="Decay"   value={p.decay}   min={0.001} max={2}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ decay: v })} />
        <SliderRow label="Sustain" value={p.sustain} min={0}     max={1}   step={0.01}  fmt={v => v.toFixed(2)} onChange={v => onSet({ sustain: v })} />
        <SliderRow label="Release" value={p.release} min={0.001} max={4}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ release: v })} />
      </Section>
      <Section title="FM">
        <SliderRow label="Mod Ratio" value={p.modRatio} min={0.5} max={8}  step={0.01} fmt={v => v.toFixed(2)} onChange={v => onSet({ modRatio: v })} />
        <SliderRow label="Mod Depth" value={p.modDepth} min={0}   max={4}  step={0.01} fmt={v => v.toFixed(2)} onChange={v => onSet({ modDepth: v })} />
        <SliderRow label="Detune"    value={p.detune}   min={-100} max={100} step={1}  fmt={v => `${v}¢`}     onChange={v => onSet({ detune: v })} />
      </Section>
      <button onClick={e => { e.stopPropagation(); previewNote(engine.ctx, engine.masterGain, instrument, 60) }}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview <Play size={13} />
      </button>
    </div>
  )
})

// ── Poly synth panel ───────────────────────────────────────────────────────────

const LFO_TARGETS: { label: string; value: PolyInstrumentParams['lfoTarget'] }[] = [
  { label: 'Pitch',  value: 'pitch'  },
  { label: 'Filter', value: 'filter' },
  { label: 'Amp',    value: 'amp'    },
]

function srcBtn(active: boolean): React.CSSProperties {
  return {
    padding: '2px 8px', borderRadius: 3, fontSize: 9, cursor: 'pointer',
    border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? `${C.accent}22` : C.bgCard, color: active ? C.accent : C.textMuted,
  }
}
const addOscBtn: React.CSSProperties = {
  flex: 1, padding: '4px 0', borderRadius: 3, fontSize: 10, cursor: 'pointer',
  border: `1px dashed ${C.border}`, background: C.bgCard, color: C.textMuted,
}
const octaveLabel = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`)

// Dropdown of the user's library samples for a 'sample' oscillator layer.
function SamplePicker({ layer, onPick, onWarm }: {
  layer: PolyOscLayer
  onPick: (patch: Partial<PolyOscLayer>) => void
  onWarm: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  useEffect(() => {
    if (open && entries === null) libraryGetAll().then(setEntries).catch(() => setEntries([]))
  }, [open, entries])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Sample</span>
        <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          style={{ flex: 1, textAlign: 'left', padding: '4px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer', border: `1px solid ${C.border}`, background: C.bgCard, color: layer.sampleName ? C.textPrimary : C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {layer.sampleName ?? 'Pick a sample…'}
        </button>
      </div>
      {open && (
        <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, border: `1px solid ${C.border}`, borderRadius: 4, padding: 4 }}>
          {entries === null ? (
            <span style={{ fontSize: 10, color: C.textMuted, padding: 4 }}>Loading…</span>
          ) : entries.length === 0 ? (
            <span style={{ fontSize: 10, color: C.textMuted, padding: 4, lineHeight: 1.4 }}>No samples in your library yet. Record or import one, then it&apos;ll show here.</span>
          ) : entries.map(en => (
            <button key={en.id}
              onClick={e => { e.stopPropagation(); onPick({ sampleId: en.id, sampleName: en.name, sampleRoot: en.renderSpec?.midiNote ?? 60 }); onWarm(en.id); setOpen(false) }}
              style={{ textAlign: 'left', padding: '3px 6px', borderRadius: 3, fontSize: 10, cursor: 'pointer', border: `1px solid ${layer.sampleId === en.id ? C.accent : 'transparent'}`, background: layer.sampleId === en.id ? `${C.accent}22` : 'transparent', color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {en.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Stacked oscillator editor: osc 1 + osc 2 + a sub…, each a waveform or a
// pitched library sample, with its own octave / fine detune / level and a
// unison count that fans a layer into up to 7 detuned voices (supersaw / Reese).
function OscillatorStack({ layers, onChange, onWarm }: {
  layers: PolyOscLayer[]
  onChange: (next: PolyOscLayer[]) => void
  onWarm: (id: string) => void
}) {
  const update = (i: number, changes: Partial<PolyOscLayer>) =>
    onChange(layers.map((l, j) => (j === i ? { ...l, ...changes } : l)))
  const remove = (i: number) => {
    const next = layers.filter((_, j) => j !== i)
    onChange(next.length ? next : [defaultOscLayer()])
  }
  const addOsc = () => onChange([...layers, defaultOscLayer({ waveform: 'sawtooth', detune: 6 })])
  const addSub = () => onChange([...layers, defaultOscLayer({ waveform: 'sine', octave: -1, level: 0.6 })])

  return (
    <Section title="Oscillators">
      {layers.map((l, i) => (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: '0.05em' }}>OSC {i + 1}</span>
            <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
              <button onClick={e => { e.stopPropagation(); update(i, { source: 'wave' }) }} style={srcBtn(l.source === 'wave')}>Wave</button>
              <button onClick={e => { e.stopPropagation(); update(i, { source: 'sample' }) }} style={srcBtn(l.source === 'sample')}>Sample</button>
            </div>
            {layers.length > 1 && (
              <button onClick={e => { e.stopPropagation(); remove(i) }} title="Remove oscillator"
                style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.textMuted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}><X size={14} /></button>
            )}
          </div>
          {l.source === 'sample'
            ? <SamplePicker layer={l} onPick={patch => update(i, patch)} onWarm={onWarm} />
            : <WaveRow label="Wave" value={l.waveform} onChange={w => update(i, { waveform: w })} />}
          <SliderRow label="Octave" value={l.octave} min={-2} max={2} step={1} fmt={octaveLabel} onChange={v => update(i, { octave: Math.round(v) })} />
          <SliderRow label="Detune" value={l.detune} min={-100} max={100} step={1} fmt={v => `${v}¢`} onChange={v => update(i, { detune: v })} />
          <SliderRow label="Voices" value={l.unison} min={1} max={7} step={1} fmt={v => `${v}`} onChange={v => update(i, { unison: Math.round(v) })} />
          {l.unison > 1 && (
            <SliderRow label="Spread" value={l.spread} min={0} max={50} step={1} fmt={v => `${v}¢`} onChange={v => update(i, { spread: v })} />
          )}
          <SliderRow label="Level" value={l.level} min={0} max={1} step={0.01} fmt={v => v.toFixed(2)} onChange={v => update(i, { level: v })} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={e => { e.stopPropagation(); addOsc() }} style={addOscBtn}>+ Oscillator</button>
        <button onClick={e => { e.stopPropagation(); addSub() }} style={addOscBtn}>+ Sub</button>
      </div>
    </Section>
  )
}

const PolyPanel = memo(function PolyPanel({ instrument, onSet }: {
  instrument: TrackInstrument
  onSet: (changes: Partial<PolyInstrumentParams>) => void
}) {
  const { engine } = useDaw()
  const isMobile = useIsMobile()
  const p = instrument.params as PolyInstrumentParams
  const FILTER_TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch']

  // Warm any sample-oscillator buffers so preview/playback isn't silent while
  // they decode. Keyed on the set of sample ids, so it only fires when it changes.
  const sampleIds = polyOscLayers(p).filter(l => l.source === 'sample' && l.sampleId).map(l => l.sampleId!).join(',')
  useEffect(() => {
    if (!sampleIds) return
    for (const id of sampleIds.split(',')) void ensurePolySample(engine.ctx, id)
  }, [sampleIds, engine])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Section title="Preset">
        {isMobile ? (
          <PresetMenu options={Object.keys(POLY_PRESETS).map(k => ({ value: k, label: k }))} onPick={k => onSet({ ...POLY_PRESETS[k], preset: k })} placeholder="Load preset…" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.keys(POLY_PRESETS).map(k => (
              <button key={k}
                onClick={e => { e.stopPropagation(); onSet({ ...POLY_PRESETS[k], preset: k }) }}
                style={{
                  padding: '3px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                  border: `1px solid ${p.preset === k ? C.accent : C.border}`,
                  background: p.preset === k ? `${C.accent}22` : C.bgCard,
                  color: p.preset === k ? C.accent : C.textMuted,
                }}>{k}</button>
            ))}
          </div>
        )}
      </Section>

      <OscillatorStack layers={polyOscLayers(p)} onChange={next => onSet({ oscillators: next })} onWarm={id => void ensurePolySample(engine.ctx, id)} />

      <Section title="Filter">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Type</span>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {FILTER_TYPES.map(t => (
              <button key={t}
                onClick={e => { e.stopPropagation(); onSet({ filterType: t }) }}
                style={{
                  flex: 1, padding: '3px 0', borderRadius: 3,
                  border: `1px solid ${p.filterType === t ? C.accent : C.border}`,
                  background: p.filterType === t ? `${C.accent}22` : C.bgCard,
                  color: p.filterType === t ? C.accent : C.textMuted,
                  fontSize: 9, cursor: 'pointer', textTransform: 'uppercase',
                }}
              >{t.slice(0, 4)}</button>
            ))}
          </div>
        </div>
        <SliderRow label="Cutoff" value={p.filterCutoff} min={20} max={20000} step={10}
          fmt={v => v >= 1000 ? `${(v / 1000).toFixed(1)}kHz` : `${Math.round(v)}Hz`}
          onChange={v => onSet({ filterCutoff: v })} />
        <SliderRow label="Resonance" value={p.filterResonance} min={0.1} max={20} step={0.1}
          fmt={v => v.toFixed(1)} onChange={v => onSet({ filterResonance: v })} />
      </Section>

      <Section title="Envelope">
        <SliderRow label="Attack"  value={p.attack}  min={0.001} max={2}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ attack: v })} />
        <SliderRow label="Decay"   value={p.decay}   min={0.001} max={2}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ decay: v })} />
        <SliderRow label="Sustain" value={p.sustain} min={0}     max={1}   step={0.01}  fmt={v => v.toFixed(2)}       onChange={v => onSet({ sustain: v })} />
        <SliderRow label="Release" value={p.release} min={0.001} max={4}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ release: v })} />
      </Section>

      <Section title="LFO">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Enable</span>
          <input type="checkbox" checked={p.lfoEnabled}
            onClick={e => e.stopPropagation()}
            onChange={e => { e.stopPropagation(); onSet({ lfoEnabled: e.target.checked }) }}
            style={{ accentColor: C.accent, width: 14, height: 14, cursor: 'pointer' }} />
        </div>
        {p.lfoEnabled && <>
          <WaveRow label="Shape" value={p.lfoWaveform} onChange={w => onSet({ lfoWaveform: w })} />
          <SliderRow label="Rate"  value={p.lfoRate}  min={0.1} max={20}  step={0.1}  fmt={v => `${v.toFixed(1)}Hz`} onChange={v => onSet({ lfoRate: v })} />
          <SliderRow label="Depth" value={p.lfoDepth} min={0}   max={1}   step={0.01} fmt={v => `${Math.round(v * 100)}%`} onChange={v => onSet({ lfoDepth: v })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Target</span>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              {LFO_TARGETS.map(t => (
                <button key={t.value}
                  onClick={e => { e.stopPropagation(); onSet({ lfoTarget: t.value }) }}
                  style={{
                    flex: 1, padding: '3px 0', borderRadius: 3,
                    border: `1px solid ${p.lfoTarget === t.value ? C.accent : C.border}`,
                    background: p.lfoTarget === t.value ? `${C.accent}22` : C.bgCard,
                    color: p.lfoTarget === t.value ? C.accent : C.textMuted,
                    fontSize: 10, cursor: 'pointer',
                  }}
                >{t.label}</button>
              ))}
            </div>
          </div>
        </>}
      </Section>

      <button onClick={e => { e.stopPropagation(); previewNote(engine.ctx, engine.masterGain, instrument, 60) }}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview <Play size={13} />
      </button>
    </div>
  )
})

// ── FM 4-op panel ─────────────────────────────────────────────────────────────

// Operator center positions [cx, cy] for each algorithm (viewBox 0 0 80 52, box 16×12)
const ALGO_OP_POSITIONS: Record<number, [number, number][]> = {
  1: [[11,26],[28,26],[45,26],[62,26]],  // series chain: all horizontal
  2: [[11,13],[28,13],[11,40],[62,26]],  // Y-branch
  3: [[18,13],[18,40],[54,13],[54,40]],  // twin stacks
  4: [[11,26],[28,26],[45,26],[62,26]],  // cascade+free (carriers idx 2,3)
  5: [[12,26],[58,10],[58,26],[58,42]],  // fan-out
  6: [[11,30],[28,30],[45,30],[62,30]],  // series+skip
  7: [[12,10],[12,26],[12,42],[60,26]],  // triple mod
  8: [[11,26],[28,26],[45,26],[62,26]],  // additive
}

function AlgorithmDiagram({ algo }: { algo: number }) {
  const def = FM_ALGORITHMS[algo as Fm4OpAlgorithm]
  const positions = ALGO_OP_POSITIONS[algo]
  if (!positions || !def) return null
  const BW = 16, BH = 12, W = 80, H = 52
  const markerId = `fm-arr-${algo}`

  function boxEdgePoint(fromIdx: number, toIdx: number, isStart: boolean): [number, number] {
    const [fx, fy] = positions[fromIdx]
    const [tx, ty] = positions[toIdx]
    const dx = tx - fx, dy = ty - fy
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) return [fx, fy]
    const ux = dx / len, uy = dy / len
    const tScale = Math.min(
      Math.abs(ux) > 0.001 ? BW / 2 / Math.abs(ux) : Infinity,
      Math.abs(uy) > 0.001 ? BH / 2 / Math.abs(uy) : Infinity,
    )
    if (isStart) return [fx + ux * tScale, fy + uy * tScale]
    return [tx - ux * (tScale + 2), ty - uy * (tScale + 2)]
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <marker id={markerId} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <polygon points="0,0 5,2.5 0,5" fill="var(--text-muted)" />
        </marker>
      </defs>
      {/* Arrows */}
      {def.modulators.map(({ from, to }, i) => {
        // Skip arrow for algo 6: Op1→Op4 arcs over the top
        if (algo === 6 && from === 0 && to === 3) {
          const [sx, sy] = positions[from]
          const [ex, ey] = positions[to]
          const midX = (sx + ex) / 2
          return (
            <path key={i}
              d={`M${sx},${sy - BH / 2} Q${midX},${sy - 22} ${ex},${ey - BH / 2 - 2}`}
              stroke="var(--text-muted)" strokeWidth={1} fill="none"
              markerEnd={`url(#${markerId})`}
            />
          )
        }
        const [sx, sy] = boxEdgePoint(from, to, true)
        const [ex, ey] = boxEdgePoint(from, to, false)
        return (
          <line key={i} x1={sx} y1={sy} x2={ex} y2={ey}
            stroke="var(--text-muted)" strokeWidth={1}
            markerEnd={`url(#${markerId})`}
          />
        )
      })}
      {/* Operator boxes */}
      {positions.map(([cx, cy], i) => {
        const isCarrier = def.carriers.includes(i)
        return (
          <g key={i}>
            <rect
              x={cx - BW / 2} y={cy - BH / 2} width={BW} height={BH} rx={2}
              fill={isCarrier ? `${C.accent}22` : C.bgCard}
              stroke={isCarrier ? C.accent : '#555'}
              strokeWidth={isCarrier ? 1.5 : 1}
            />
            <text
              x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
              fontSize={8} fill={isCarrier ? C.accent : '#999'}
              fontWeight={isCarrier ? 700 : 400}
            >{i + 1}</text>
          </g>
        )
      })}
    </svg>
  )
}

const Fm4OpPanel = memo(function Fm4OpPanel({ instrument, onSet }: {
  instrument: TrackInstrument
  onSet: (changes: Partial<Fm4OpInstrumentParams>) => void
}) {
  const { engine } = useDaw()
  const isMobile = useIsMobile()
  const p = instrument.params as Fm4OpInstrumentParams
  const [selectedOp, setSelectedOp] = useState(0)

  function updateOp(idx: number, changes: Partial<Fm4OpOperator>) {
    const newOps = p.operators.map((o, i) => i === idx ? { ...o, ...changes } : o) as Fm4OpInstrumentParams['operators']
    onSet({ operators: newOps })
  }

  const op  = p.operators[selectedOp]
  const def = FM_ALGORITHMS[p.algorithm as Fm4OpAlgorithm]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Presets */}
      <Section title="Preset">
        {isMobile ? (
          <PresetMenu options={Object.keys(FM_PRESETS).map(k => ({ value: k, label: k }))} value={p.name} onPick={k => onSet({ ...FM_PRESETS[k] })} placeholder="Load preset…" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.keys(FM_PRESETS).map(k => (
              <button key={k}
                onClick={e => { e.stopPropagation(); onSet({ ...FM_PRESETS[k] }) }}
                style={{
                  padding: '3px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                  border: `1px solid ${p.name === k ? C.accent : C.border}`,
                  background: p.name === k ? `${C.accent}22` : C.bgCard,
                  color: p.name === k ? C.accent : C.textMuted,
                }}>{k}</button>
            ))}
          </div>
        )}
      </Section>

      {/* Algorithm */}
      <Section title="Algorithm">
        <div style={{ display: 'flex', gap: 4 }}>
          {([1, 2, 3, 4, 5, 6, 7, 8] as const).map(a => (
            <TypeBtn key={a} label={String(a)} active={p.algorithm === a} onClick={() => onSet({ algorithm: a })} />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <AlgorithmDiagram algo={p.algorithm} />
          <span style={{ fontSize: 10, color: C.textMuted }}>{def.name}</span>
        </div>
        {/* Operator role indicators */}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          {[0, 1, 2, 3].map(i => {
            const isCarrier = def.carriers.includes(i)
            return (
              <div key={i} style={{
                flex: 1, textAlign: 'center', fontSize: 9, padding: '2px 0', borderRadius: 3,
                border: `1px solid ${isCarrier ? C.accent : C.border}`,
                background: isCarrier ? `${C.accent}22` : C.bgCard,
                color: isCarrier ? C.accent : C.textMuted,
                fontWeight: isCarrier ? 700 : 400,
              }}>Op{i + 1} {isCarrier ? 'C' : 'M'}</div>
            )
          })}
        </div>
      </Section>

      <SliderRow label="Master Gain" value={p.masterGain} min={0} max={1} step={0.01}
        fmt={v => `${Math.round(v * 100)}%`} onChange={v => onSet({ masterGain: v })} />

      {/* Per-operator editor */}
      <Section title="Operator">
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2, 3].map(i => (
            <TypeBtn key={i} label={`Op${i + 1}`} active={selectedOp === i} onClick={() => setSelectedOp(i)} />
          ))}
        </div>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <SliderRow label="Ratio"   value={op.ratio}   min={0.25} max={16}   step={0.25} fmt={v => v.toFixed(2)} onChange={v => updateOp(selectedOp, { ratio: v })} />
          <SliderRow label="Level"   value={op.level}   min={0}    max={1}    step={0.01} fmt={v => v.toFixed(2)} onChange={v => updateOp(selectedOp, { level: v })} />
          <SliderRow label="Attack"  value={op.attack}  min={0.001} max={5}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => updateOp(selectedOp, { attack: v })} />
          <SliderRow label="Decay"   value={op.decay}   min={0.001} max={5}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => updateOp(selectedOp, { decay: v })} />
          <SliderRow label="Sustain" value={op.sustain} min={0}    max={1}    step={0.01}  fmt={v => v.toFixed(2)}       onChange={v => updateOp(selectedOp, { sustain: v })} />
          <SliderRow label="Release" value={op.release} min={0.001} max={5}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => updateOp(selectedOp, { release: v })} />
          <SliderRow label="Detune"  value={op.detune}  min={-100} max={100}  step={1}     fmt={v => `${v}¢`}            onChange={v => updateOp(selectedOp, { detune: v })} />
          {selectedOp === 0 && (
            <SliderRow label="Feedback" value={op.feedback} min={0} max={1}   step={0.01} fmt={v => v.toFixed(2)} onChange={v => updateOp(selectedOp, { feedback: v })} />
          )}
        </div>
      </Section>

      <button onClick={e => { e.stopPropagation(); previewNote(engine.ctx, engine.masterGain, instrument, 60) }}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview <Play size={13} />
      </button>
    </div>
  )
})

// ── Wavetable panel ────────────────────────────────────────────────────────────

type WtType = WavetableInstrumentParams['oscAWavetable']
const WT_TYPES: WtType[] = ['analog', 'digital', 'vocal', 'strings', 'brass', 'custom']

function WtTypeRow({ label, value, onChange }: { label: string; value: WtType; onChange: (v: WtType) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', gap: 3, flex: 1, flexWrap: 'wrap' }}>
        {WT_TYPES.map(t => (
          <button key={t}
            onClick={e => { e.stopPropagation(); onChange(t) }}
            style={{
              padding: '2px 6px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
              border: `1px solid ${value === t ? C.accent : C.border}`,
              background: value === t ? `${C.accent}22` : C.bgCard,
              color: value === t ? C.accent : C.textMuted,
              textTransform: 'capitalize',
            }}>{t}</button>
        ))}
      </div>
    </div>
  )
}

type LfoShape = WavetableInstrumentParams['lfoShape']
const LFO_SHAPES: { label: string; value: LfoShape }[] = [
  { label: 'Sin', value: 'sine' }, { label: 'Tri', value: 'triangle' },
  { label: 'Sqr', value: 'square' }, { label: 'Saw', value: 'sawtooth' },
]

type WtLfoTarget = WavetableInstrumentParams['lfoTarget']
const WT_LFO_TARGETS: { label: string; value: WtLfoTarget }[] = [
  { label: 'Pitch',  value: 'pitch'     },
  { label: 'Filter', value: 'filter'    },
  { label: 'Wave',   value: 'wavetable' },
  { label: 'Pan',    value: 'pan'       },
]

const WavetablePanel = memo(function WavetablePanel({ instrument, onSet }: {
  instrument: TrackInstrument
  onSet: (changes: Partial<WavetableInstrumentParams>) => void
}) {
  const { engine } = useDaw()
  const isMobile = useIsMobile()
  const p = instrument.params as WavetableInstrumentParams
  const FILTER_TYPES: WavetableInstrumentParams['filterType'][] = ['lowpass', 'highpass', 'bandpass']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Presets */}
      <Section title="Preset">
        {isMobile ? (
          <PresetMenu options={Object.keys(WAVETABLE_PRESETS).map(k => ({ value: k, label: k }))} onPick={k => onSet({ ...WAVETABLE_PRESETS[k], preset: k })} placeholder="Load preset…" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.keys(WAVETABLE_PRESETS).map(k => (
              <button key={k}
                onClick={e => { e.stopPropagation(); onSet({ ...WAVETABLE_PRESETS[k], preset: k }) }}
                style={{
                  padding: '3px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                  border: `1px solid ${p.preset === k ? C.accent : C.border}`,
                  background: p.preset === k ? `${C.accent}22` : C.bgCard,
                  color: p.preset === k ? C.accent : C.textMuted,
                }}>{k}</button>
            ))}
          </div>
        )}
      </Section>

      {/* Oscillator A */}
      <Section title="Oscillator A">
        <WtTypeRow label="Wavetable" value={p.oscAWavetable} onChange={v => onSet({ oscAWavetable: v })} />
        <SliderRow label="Position" value={p.oscAPosition} min={0} max={1} step={0.01} fmt={v => v.toFixed(2)} onChange={v => onSet({ oscAPosition: v })} />
        <SliderRow label="Detune"   value={p.oscADetune}   min={-24} max={24} step={1} fmt={v => `${v > 0 ? '+' : ''}${v}st`} onChange={v => onSet({ oscADetune: v })} />
        <SliderRow label="Gain"     value={p.oscAGain}     min={0} max={1} step={0.01} fmt={v => v.toFixed(2)} onChange={v => onSet({ oscAGain: v })} />
      </Section>

      {/* Oscillator B */}
      <Section title="Oscillator B">
        <WtTypeRow label="Wavetable" value={p.oscBWavetable} onChange={v => onSet({ oscBWavetable: v })} />
        <SliderRow label="Position" value={p.oscBPosition} min={0} max={1} step={0.01} fmt={v => v.toFixed(2)} onChange={v => onSet({ oscBPosition: v })} />
        <SliderRow label="Detune"   value={p.oscBDetune}   min={-24} max={24} step={1} fmt={v => `${v > 0 ? '+' : ''}${v}st`} onChange={v => onSet({ oscBDetune: v })} />
        <SliderRow label="Gain"     value={p.oscBGain}     min={0} max={1} step={0.01} fmt={v => v.toFixed(2)} onChange={v => onSet({ oscBGain: v })} />
      </Section>

      {/* Filter */}
      <Section title="Filter">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Type</span>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {FILTER_TYPES.map(t => (
              <button key={t}
                onClick={e => { e.stopPropagation(); onSet({ filterType: t }) }}
                style={{
                  flex: 1, padding: '3px 0', borderRadius: 3,
                  border: `1px solid ${p.filterType === t ? C.accent : C.border}`,
                  background: p.filterType === t ? `${C.accent}22` : C.bgCard,
                  color: p.filterType === t ? C.accent : C.textMuted,
                  fontSize: 9, cursor: 'pointer', textTransform: 'uppercase',
                }}>{t.slice(0, 4)}</button>
            ))}
          </div>
        </div>
        <SliderRow label="Cutoff"    value={p.filterCutoff}    min={20} max={20000} step={10}
          fmt={v => v >= 1000 ? `${(v / 1000).toFixed(1)}kHz` : `${Math.round(v)}Hz`}
          onChange={v => onSet({ filterCutoff: v })} />
        <SliderRow label="Resonance" value={p.filterResonance} min={0} max={30} step={0.1}
          fmt={v => v.toFixed(1)} onChange={v => onSet({ filterResonance: v })} />
        <SliderRow label="Env Amt"   value={p.filterEnvAmount} min={-1} max={1} step={0.01}
          fmt={v => v.toFixed(2)} onChange={v => onSet({ filterEnvAmount: v })} />
      </Section>

      {/* Amplitude envelope */}
      <Section title="Amplitude">
        <SliderRow label="Attack"  value={p.attack}  min={0.001} max={4}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ attack: v })} />
        <SliderRow label="Decay"   value={p.decay}   min={0.001} max={4}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ decay: v })} />
        <SliderRow label="Sustain" value={p.sustain} min={0}     max={1}   step={0.01}  fmt={v => v.toFixed(2)}       onChange={v => onSet({ sustain: v })} />
        <SliderRow label="Release" value={p.release} min={0.001} max={8}   step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ release: v })} />
      </Section>

      {/* Filter envelope */}
      <Section title="Filter Env">
        <SliderRow label="Attack"  value={p.fAttack}  min={0.001} max={4}  step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ fAttack: v })} />
        <SliderRow label="Decay"   value={p.fDecay}   min={0.001} max={4}  step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ fDecay: v })} />
        <SliderRow label="Sustain" value={p.fSustain} min={0}     max={1}  step={0.01}  fmt={v => v.toFixed(2)}       onChange={v => onSet({ fSustain: v })} />
        <SliderRow label="Release" value={p.fRelease} min={0.001} max={8}  step={0.001} fmt={v => `${v.toFixed(3)}s`} onChange={v => onSet({ fRelease: v })} />
      </Section>

      {/* LFO */}
      <Section title="LFO">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Shape</span>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {LFO_SHAPES.map(s => (
              <button key={s.value}
                onClick={e => { e.stopPropagation(); onSet({ lfoShape: s.value }) }}
                style={{
                  flex: 1, padding: '3px 0', borderRadius: 3,
                  border: `1px solid ${p.lfoShape === s.value ? C.accent : C.border}`,
                  background: p.lfoShape === s.value ? `${C.accent}22` : C.bgCard,
                  color: p.lfoShape === s.value ? C.accent : C.textMuted,
                  fontSize: 10, cursor: 'pointer',
                }}>{s.label}</button>
            ))}
          </div>
        </div>
        <SliderRow label="Rate"  value={p.lfoRate}  min={0.1} max={20}  step={0.1}  fmt={v => `${v.toFixed(1)}Hz`} onChange={v => onSet({ lfoRate: v })} />
        <SliderRow label="Depth" value={p.lfoDepth} min={0}   max={1}   step={0.01} fmt={v => `${Math.round(v * 100)}%`} onChange={v => onSet({ lfoDepth: v })} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 72, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Target</span>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {WT_LFO_TARGETS.map(t => (
              <button key={t.value}
                onClick={e => { e.stopPropagation(); onSet({ lfoTarget: t.value }) }}
                style={{
                  flex: 1, padding: '3px 0', borderRadius: 3,
                  border: `1px solid ${p.lfoTarget === t.value ? C.accent : C.border}`,
                  background: p.lfoTarget === t.value ? `${C.accent}22` : C.bgCard,
                  color: p.lfoTarget === t.value ? C.accent : C.textMuted,
                  fontSize: 10, cursor: 'pointer',
                }}>{t.label}</button>
            ))}
          </div>
        </div>
      </Section>

      <SliderRow label="Master Gain" value={p.masterGain} min={0} max={1} step={0.01}
        fmt={v => `${Math.round(v * 100)}%`} onChange={v => onSet({ masterGain: v })} />

      <button onClick={e => { e.stopPropagation(); previewNote(engine.ctx, engine.masterGain, instrument, 60) }}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview <Play size={13} />
      </button>
    </div>
  )
})

// ── Main export ────────────────────────────────────────────────────────────────

const TYPE_BUTTONS: { label: string; value: InstrumentType }[] = [
  { label: 'None',       value: 'none'      },
  { label: 'Drum',       value: 'drum'      },
  { label: 'FM',         value: 'fm'        },
  { label: 'FM 4-Op',    value: 'fm4op'     },
  { label: 'Wavetable',  value: 'wavetable' },
  { label: 'Poly',       value: 'poly'      },
  { label: 'Apollo',     value: 'apollo'    },
  { label: 'Plugin',     value: 'plugin'    },
]

export default memo(function InstrumentPicker({ trackId }: { trackId: string }) {
  const { project, dispatch, engine } = useDaw()
  const isMobile = useIsMobile()

  // NB: derive-then-guard, but call every hook FIRST. A track can vanish while this panel is open
  // (delete a track), so `track`/`instrument` may be undefined — but bailing before the useCallbacks
  // below would change the hook count between renders and crash ("rendered fewer hooks than expected").
  // So the hooks run unconditionally and the early-return lives just above the JSX.
  const track = project.tracks.find(t => t.id === trackId)
  const instrument = track?.instrument
  const instrType  = instrument?.type

  const setType = useCallback((next: InstrumentType) => {
    let newInstr: TrackInstrument
    if (next === 'drum')      newInstr = defaultDrumInstrument()
    else if (next === 'fm')   newInstr = defaultFmInstrument()
    else if (next === 'poly') newInstr = defaultPolyInstrument()
    else if (next === 'fm4op')     newInstr = defaultFm4opInstrument()
    else if (next === 'wavetable') newInstr = defaultWavetableInstrument()
    else if (next === 'apollo')    newInstr = { type: 'apollo', params: initApolloPatch() }
    // An empty pluginId means "not chosen yet", which is what makes the panel
    // show its picker instead of an error.
    else if (next === 'plugin')    newInstr = { type: 'plugin', params: { pluginId: '', values: {} } }
    else newInstr = { type: 'none', params: {} }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: newInstr })
  }, [dispatch, trackId])

  const setFm = useCallback((changes: Partial<FmInstrumentParams>) => {
    if (!instrument || instrType !== 'fm') return
    const params = instrument.params as FmInstrumentParams
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'fm', params: { ...params, ...changes } } })
  }, [dispatch, trackId, instrType, instrument?.params])

  const setPoly = useCallback((changes: Partial<PolyInstrumentParams>) => {
    if (!instrument || instrType !== 'poly') return
    const params = instrument.params as PolyInstrumentParams
    // A hand-edit (any change that isn't loading a preset) drops the preset tag
    // so the sound reads as "custom" again.
    const next = { ...params, ...changes }
    if (!('preset' in changes)) delete next.preset
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'poly', params: next } })
  }, [dispatch, trackId, instrType, instrument?.params])

  const setDrum = useCallback((changes: Partial<DrumInstrumentParams>) => {
    const prev = (instrType === 'drum' && instrument) ? instrument.params as DrumInstrumentParams : { pack: 'synth' as const }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'drum', params: { ...prev, ...changes } } })
  }, [dispatch, trackId, instrType, instrument?.params])

  const setFm4op = useCallback((changes: Partial<Fm4OpInstrumentParams>) => {
    if (!instrument || instrType !== 'fm4op') return
    const params = instrument.params as Fm4OpInstrumentParams
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'fm4op', params: { ...params, ...changes } } })
  }, [dispatch, trackId, instrType, instrument?.params])

  const setWavetable = useCallback((changes: Partial<WavetableInstrumentParams>) => {
    if (!instrument || instrType !== 'wavetable') return
    const params = instrument.params as WavetableInstrumentParams
    const next = { ...params, ...changes }
    if (!('preset' in changes)) delete next.preset
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'wavetable', params: next } })
  }, [dispatch, trackId, instrType, instrument?.params])

  if (!track || !instrument) return null

  return (
    <div style={{
      background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 6,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 16,
      minWidth: isMobile ? 0 : 380,
    }}>
      {isMobile ? (
        <PresetMenu
          options={TYPE_BUTTONS.map(b => ({ value: b.value, label: b.label }))}
          value={instrType}
          onPick={v => setType(v as InstrumentType)}
          placeholder="Instrument type"
        />
      ) : (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {TYPE_BUTTONS.map(btn => (
            <TypeBtn key={btn.value} label={btn.label} active={instrType === btn.value} onClick={() => setType(btn.value)} />
          ))}
          {(instrType === 'poly' || instrType === 'wavetable' || instrType === 'fm') && <HeliosSynthChip trackId={trackId} />}
          <OpenInApolloButton trackId={trackId} />
        </div>
      )}

      {instrType === 'drum'      && <DrumPanel      instrument={instrument} onSet={setDrum} />}
      {instrType === 'fm'        && <FmPanel        instrument={instrument} trackId={trackId} onSet={setFm} />}
      {instrType === 'poly'      && <PolyPanel      instrument={instrument} onSet={setPoly} />}
      {instrType === 'fm4op'     && <Fm4OpPanel     instrument={instrument} onSet={setFm4op} />}
      {instrType === 'wavetable' && <WavetablePanel instrument={instrument} onSet={setWavetable} />}
      {instrType === 'plugin' && <PluginPanel trackId={trackId} instrument={instrument} />}
      {instrType === 'apollo'    && <ApolloPanel    instrument={instrument} trackId={trackId} />}
    </div>
  )
})

// The "plugin" affordance: open ANY convertible track in Apollo. Legacy synth
// settings translate into a real Apollo patch, the instrument converts to
// type 'apollo', and the full synth card opens above the studio — exactly the
// open-a-plugin flow. Empty tracks get a fresh Init patch.

// Apollo hosted in Beacon with motion recording: loop the clip, arm record,
// and every knob you move is captured as automation on this track. Playing
// back drives the engine AND moves the knobs. Each captured parameter can be
// reverted on its own.
function ApolloCardWithMotion({ trackId, patch, title, onChange, onClose }: {
  trackId: string
  patch: ApolloInstrumentParams
  title?: string
  onChange: (p: ApolloInstrumentParams) => void
  onClose: () => void
}) {
  const m = useApolloMotion(trackId)
  const btn = (on: boolean, tone?: string): React.CSSProperties => ({
    height: 22, padding: '0 9px', borderRadius: 5, cursor: 'pointer',
    fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
    background: on ? (tone ?? 'var(--accent)') : 'transparent',
    color: on ? '#0b0d10' : 'var(--text-muted, #8b93a0)',
    border: `1px solid ${on ? (tone ?? 'var(--accent)') : 'var(--border, #262c35)'}`,
  })
  return (
    <ApolloCard
      patch={patch}
      title={title}
      onChange={onChange}
      onClose={() => { if (m.looping) m.toggleLoop(); onClose() }}
      onParamMove={m.onParamMove}
      liveParams={m.live}
      headerExtra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={m.toggleLoop}
            disabled={!m.canLoop}
            data-apollo-loop={m.looping ? 'on' : 'off'}
            title={m.canLoop ? 'Loop this track\u2019s clip so you can shape the sound over repeated passes' : 'Add a clip to this track to loop it'}
            style={{ ...btn(m.looping), opacity: m.canLoop ? 1 : 0.4 }}
          >{m.looping ? '\u25a0 Stop' : '\u25b6 Loop'}</button>
          <button
            onClick={m.toggleRecord}
            data-apollo-record={m.recording ? 'on' : 'off'}
            title="Record the moves you make here as automation on this track \u2014 each pass adds to the take"
            style={btn(m.recording, '#ef4444')}
          >{m.recording ? '\u25cf Recording' : '\u25cf Record'}</button>
          {m.lanes.length > 0 && (
            <>
              <span style={{ fontSize: 9, color: 'var(--text-muted, #8b93a0)', letterSpacing: 0.4 }}>
                {m.lanes.length} recorded
              </span>
              {m.lanes.map(l => (
                <button key={l.id}
                  onClick={() => m.revertParam(l.id)}
                  data-apollo-revert={l.parameter}
                  title={`Reset ${l.label} back to where it was before recording`}
                  style={{ ...btn(false), textTransform: 'none', fontWeight: 600 }}
                >{l.label} \u00d7</button>
              ))}
              <button onClick={m.revertAll} style={{ ...btn(false), textTransform: 'none' }}>Reset all</button>
            </>
          )}
        </div>
      }
    />
  )
}

function OpenInApolloButton({ trackId }: { trackId: string }) {
  const { project, dispatch } = useDaw()
  const [card, setCard] = useState(false)
  const track = project.tracks.find(t => t.id === trackId)
  if (!track) return null
  const t2 = track.instrument?.type
  const convertible = t2 === 'none' || t2 === 'poly' || t2 === 'wavetable' || t2 === 'fm' || !track.instrument
  // stay mounted while the card is open — conversion flips the track to
  // type 'apollo' mid-flight, and unmounting here would tear the card down
  if (!convertible && !card) return null
  const open = async () => {
    const { translateInstrument } = await import('@/lib/apollo/daw-synth')
    const { initPatch } = await import('@/lib/apollo/patch')
    let patch = track.instrument ? translateInstrument(track.instrument) : null
    if (!patch) patch = initPatch()
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'apollo', params: patch as ApolloInstrumentParams } })
    setCard(true)
  }
  const live = project.tracks.find(t3 => t3.id === trackId)
  const params = live?.instrument?.type === 'apollo' ? live.instrument.params as ApolloInstrumentParams : null
  return (
    <>
      <button
        onClick={() => { void open() }}
        title={t2 === 'none' || !track.instrument
          ? 'Open Apollo on this track — the full synth, as a card above the studio'
          : 'Convert this synth to Apollo (settings carry over) and open the full editor'}
        style={{
          height: 24, padding: '0 12px', borderRadius: 5, marginLeft: 6, cursor: 'pointer',
          fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
          background: 'var(--accent)', color: '#0b0d10', border: '1px solid var(--accent)',
        }}
      >☀︎ Open in Apollo</button>
      {card && params && (
        <ApolloCardWithMotion
          trackId={trackId}
          patch={params}
          title={track.name}
          onChange={next => dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'apollo', params: next } })}
          onClose={() => setCard(false)}
        />
      )}
    </>
  )
}

// Legacy synths render on the Helios (Apollo) engine by default when their
// settings translate; the chip drops a track back to the legacy voices.
function HeliosSynthChip({ trackId }: { trackId: string }) {
  const { project, dispatch } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  if (!track) return null
  // poly defaults to Helios; wavetable is opt-in (approximate table mapping)
  const on = track.instrument?.type === 'poly' ? track.heliosSynth !== false : track.heliosSynth === true
  return (
    <button
      onClick={() => dispatch({ type: 'SET_TRACK_HELIOS_SYNTH', trackId, on: !on })}
      title={on
        ? 'Voices render on the Helios engine (Apollo) — click for the legacy synth voices'
        : 'Voices render on the legacy synth — click for the Helios engine'}
      style={{
        height: 22, padding: '0 9px', borderRadius: 5, marginLeft: 4,
        fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', cursor: 'pointer',
        background: on ? 'var(--accent)' : 'transparent',
        color: on ? '#0b0d10' : 'var(--text-muted)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
      }}
    >{on ? 'Helios' : 'Legacy'}</button>
  )
}

// ── Apollo (hybrid worklet synth) ──────────────────────────────────────────────
// Compact panel: patch selection + handoff to the full Apollo editor at
// /apollo. Patch data is the instrument params (whole ApolloPatch).

const ApolloPanel = memo(function ApolloPanel({ instrument, trackId }: { instrument: TrackInstrument; trackId: string }) {
  const { dispatch } = useDaw()
  const patch = instrument.params as ApolloInstrumentParams
  // Serum-style: the synth opens as its own card above the studio — the whole
  // instrument, or any single module.
  const [cardScope, setCardScope] = useState<ApolloCardScope | null>(null)
  interface ApolloPresetOpt { group: string; name: string; load: () => ApolloInstrumentParams }
  const presets = useMemo<ApolloPresetOpt[]>(() => {
    const user: { name: string; json: string }[] = []
    try {
      const raw = localStorage.getItem('apollo_presets_v1')
      if (raw) user.push(...(JSON.parse(raw) as { name: string; json: string }[]))
    } catch { /* none */ }
    return [
      ...APOLLO_FACTORY.map((fp): ApolloPresetOpt => ({ group: 'Factory', name: fp.name, load: () => structuredClone(fp.patch) })),
      ...user.map((u): ApolloPresetOpt => ({ group: 'User', name: u.name, load: () => ({ ...initApolloPatch(), ...(JSON.parse(u.json) as Partial<ApolloInstrumentParams>) }) })),
    ]
  }, [])
  const apply = (idx: number) => {
    const pr = presets[idx]
    if (!pr) return
    try {
      dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'apollo', params: pr.load() } })
    } catch { /* bad preset json */ }
  }
  const current = presets.findIndex(pr => pr.name === patch.name)
  return (
    <Section title="Apollo patch">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={current >= 0 ? String(current) : ''}
          onChange={e => apply(Number(e.target.value))}
          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12, minWidth: 160 }}
        >
          <option value="" disabled>{patch.name || 'Pick a patch…'}</option>
          <optgroup label="Factory">
            {presets.map((pr, k) => pr.group === 'Factory' && <option key={pr.name} value={String(k)}>{pr.name}</option>)}
          </optgroup>
          <optgroup label="User (saved in Apollo)">
            {presets.map((pr, k) => pr.group === 'User' && <option key={pr.name + k} value={String(k)}>{pr.name}</option>)}
          </optgroup>
        </select>
        <button
          onClick={() => setCardScope('all')}
          style={{
            fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
            background: 'var(--accent)', color: '#0b0d10', border: '1px solid var(--accent)',
          }}
        >Open Apollo</button>
      </div>
      {/* open a single module straight into its own card */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>Modules</span>
        {([
          ['osc', 'Osc'], ['subnoise', 'Sub/Noise'], ['filters', 'Filters'], ['env', 'Env'],
          ['lfo', 'LFO'], ['macros', 'Macros'], ['fx', 'FX'], ['arp', 'Arp'], ['global', 'Global'],
        ] as [ApolloCardScope, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setCardScope(id)} style={{
            fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
            background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)',
          }}>{label}</button>
        ))}
      </div>
      {cardScope && (
        <ApolloCard
          patch={patch}
          scope={cardScope}
          title={patch.name || 'Untitled patch'}
          onChange={next => dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'apollo', params: next } })}
          onClose={() => setCardScope(null)}
        />
      )}
      {/* performance macros — the patch's own 8 assignable controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {patch.macros.map((mv, mi) => (
          <SliderRow
            key={mi}
            label={patch.macroNames?.[mi] || `Macro ${mi + 1}`}
            value={mv}
            min={0} max={1} step={0.01}
            fmt={v => `${Math.round(v * 100)}%`}
            onChange={v => {
              const next = { ...patch, macros: patch.macros.map((m2, k) => (k === mi ? v : m2)) }
              dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'apollo', params: next } })
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Full hybrid synth: wavetable · sample · granular · spectral. Edit sounds in the Apollo
        app, hit Save there, then pick the patch here. Sample-based patches pull their audio
        from your Sound Library automatically.
      </div>
    </Section>
  )
})
