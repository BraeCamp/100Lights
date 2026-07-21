'use client'

import { memo, useCallback } from 'react'
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
      <input
        type="range" min={min} max={max} step={step} value={value}
        onClick={e => e.stopPropagation()}
        onChange={e => { e.stopPropagation(); onChange(parseFloat(e.target.value)) }}
        style={{ flex: 1, accentColor: C.accent }}
      />
      <span style={{ width: 44, fontSize: 11, color: C.textPrimary, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {fmt ? fmt(value) : value.toFixed(2)}
      </span>
    </div>
  )
})

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
  const pads = p.pads ?? {}

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
        style={{ alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview ▶
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
                style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.keys(POLY_PRESETS).map(k => (
            <button key={k}
              onClick={e => { e.stopPropagation(); onSet({ ...POLY_PRESETS[k] }) }}
              style={{
                padding: '3px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: C.bgCard, color: C.textMuted,
              }}>{k}</button>
          ))}
        </div>
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
        style={{ alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview ▶
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
        style={{ alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview ▶
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
  const p = instrument.params as WavetableInstrumentParams
  const FILTER_TYPES: WavetableInstrumentParams['filterType'][] = ['lowpass', 'highpass', 'bandpass']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Presets */}
      <Section title="Preset">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.keys(WAVETABLE_PRESETS).map(k => (
            <button key={k}
              onClick={e => { e.stopPropagation(); onSet({ ...WAVETABLE_PRESETS[k] }) }}
              style={{
                padding: '3px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                border: `1px solid ${C.border}`,
                background: C.bgCard, color: C.textMuted,
              }}>{k}</button>
          ))}
        </div>
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
        style={{ alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        Preview ▶
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
]

export default memo(function InstrumentPicker({ trackId }: { trackId: string }) {
  const { project, dispatch, engine } = useDaw()

  const track = project.tracks.find(t => t.id === trackId)
  if (!track) return null

  const instrument = track.instrument
  const instrType  = instrument.type

  const setType = useCallback((next: InstrumentType) => {
    let newInstr: TrackInstrument
    if (next === 'drum')      newInstr = defaultDrumInstrument()
    else if (next === 'fm')   newInstr = defaultFmInstrument()
    else if (next === 'poly') newInstr = defaultPolyInstrument()
    else if (next === 'fm4op')     newInstr = defaultFm4opInstrument()
    else if (next === 'wavetable') newInstr = defaultWavetableInstrument()
    else newInstr = { type: 'none', params: {} }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: newInstr })
  }, [dispatch, trackId])

  const setFm = useCallback((changes: Partial<FmInstrumentParams>) => {
    if (instrType !== 'fm') return
    const params = instrument.params as FmInstrumentParams
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'fm', params: { ...params, ...changes } } })
  }, [dispatch, trackId, instrType, instrument.params])

  const setPoly = useCallback((changes: Partial<PolyInstrumentParams>) => {
    if (instrType !== 'poly') return
    const params = instrument.params as PolyInstrumentParams
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'poly', params: { ...params, ...changes } } })
  }, [dispatch, trackId, instrType, instrument.params])

  const setDrum = useCallback((changes: Partial<DrumInstrumentParams>) => {
    const prev = instrType === 'drum' ? instrument.params as DrumInstrumentParams : { pack: 'synth' as const }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'drum', params: { ...prev, ...changes } } })
  }, [dispatch, trackId, instrType, instrument.params])

  const setFm4op = useCallback((changes: Partial<Fm4OpInstrumentParams>) => {
    if (instrType !== 'fm4op') return
    const params = instrument.params as Fm4OpInstrumentParams
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'fm4op', params: { ...params, ...changes } } })
  }, [dispatch, trackId, instrType, instrument.params])

  const setWavetable = useCallback((changes: Partial<WavetableInstrumentParams>) => {
    if (instrType !== 'wavetable') return
    const params = instrument.params as WavetableInstrumentParams
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'wavetable', params: { ...params, ...changes } } })
  }, [dispatch, trackId, instrType, instrument.params])

  return (
    <div style={{
      background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 6,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 380,
    }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TYPE_BUTTONS.map(btn => (
          <TypeBtn key={btn.value} label={btn.label} active={instrType === btn.value} onClick={() => setType(btn.value)} />
        ))}
      </div>

      {instrType === 'drum'      && <DrumPanel      instrument={instrument} onSet={setDrum} />}
      {instrType === 'fm'        && <FmPanel        instrument={instrument} trackId={trackId} onSet={setFm} />}
      {instrType === 'poly'      && <PolyPanel      instrument={instrument} onSet={setPoly} />}
      {instrType === 'fm4op'     && <Fm4OpPanel     instrument={instrument} onSet={setFm4op} />}
      {instrType === 'wavetable' && <WavetablePanel instrument={instrument} onSet={setWavetable} />}
    </div>
  )
})
