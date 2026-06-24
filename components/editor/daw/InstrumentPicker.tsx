'use client'

import { memo, useCallback } from 'react'
import { useDaw } from '@/lib/daw-state'
import type {
  TrackInstrument, InstrumentType,
  FmInstrumentParams, DrumInstrumentParams, PolyInstrumentParams,
} from '@/lib/daw-types'
import { defaultDrumInstrument, defaultFmInstrument, defaultPolyInstrument } from '@/lib/daw-types'
import { previewNote } from '@/lib/daw-instruments'

const C = {
  bgBase:      '#141414',
  bgSurface:   '#1c1c1c',
  bgCard:      '#222222',
  border:      '#2c2c2c',
  accent:      '#3d8fef',
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

const DrumPanel = memo(function DrumPanel({ instrument, onPack }: {
  instrument: TrackInstrument
  onPack: (pack: DrumInstrumentParams['pack']) => void
}) {
  const { engine } = useDaw()
  const p = instrument.params as DrumInstrumentParams
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Section title="Pack">
        <label onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="radio" name="pack" value="synth" checked={p.pack === 'synth'}
            onChange={e => { e.stopPropagation(); onPack('synth') }}
            onClick={e => e.stopPropagation()} style={{ accentColor: C.accent }} />
          <span style={{ fontSize: 13, color: C.textPrimary }}>Acoustic</span>
        </label>
      </Section>
      <Section title="Pads">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {DRUM_HITS.map(hit => (
            <button key={hit.pitch}
              onClick={e => { e.stopPropagation(); previewNote(engine.ctx, engine.masterGain, instrument, hit.pitch) }}
              onMouseDown={e => { e.stopPropagation(); (e.currentTarget as HTMLButtonElement).style.background = `${C.accent}33` }}
              onMouseUp={e => { e.stopPropagation(); (e.currentTarget as HTMLButtonElement).style.background = C.bgCard }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = C.bgCard }}
              style={{ padding: '10px 4px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontSize: 11, cursor: 'pointer', textAlign: 'center', transition: 'background 80ms' }}
            >{hit.label}</button>
          ))}
        </div>
      </Section>
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

const PolyPanel = memo(function PolyPanel({ instrument, onSet }: {
  instrument: TrackInstrument
  onSet: (changes: Partial<PolyInstrumentParams>) => void
}) {
  const { engine } = useDaw()
  const p = instrument.params as PolyInstrumentParams
  const FILTER_TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Section title="Oscillator">
        <WaveRow label="Wave" value={p.waveform} onChange={w => onSet({ waveform: w })} />
        <SliderRow label="Detune" value={p.detune} min={-100} max={100} step={1} fmt={v => `${v}¢`} onChange={v => onSet({ detune: v })} />
      </Section>

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

// ── Main export ────────────────────────────────────────────────────────────────

const TYPE_BUTTONS: { label: string; value: InstrumentType }[] = [
  { label: 'None',       value: 'none' },
  { label: 'Drum',       value: 'drum' },
  { label: 'FM Synth',   value: 'fm'   },
  { label: 'Poly Synth', value: 'poly' },
]

export default memo(function InstrumentPicker({ trackId }: { trackId: string }) {
  const { project, dispatch, engine } = useDaw()

  const track = project.tracks.find(t => t.id === trackId)
  if (!track || track.type === 'audio') return null

  const instrument = track.instrument
  const instrType  = instrument.type

  const setType = useCallback((next: InstrumentType) => {
    let newInstr: TrackInstrument
    if (next === 'drum') newInstr = defaultDrumInstrument()
    else if (next === 'fm') newInstr = defaultFmInstrument()
    else if (next === 'poly') newInstr = defaultPolyInstrument()
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

  const setDrumPack = useCallback((pack: DrumInstrumentParams['pack']) => {
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'drum', params: { pack } } })
  }, [dispatch, trackId])

  return (
    <div style={{
      background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 6,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 360,
    }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {TYPE_BUTTONS.map(btn => (
          <TypeBtn key={btn.value} label={btn.label} active={instrType === btn.value} onClick={() => setType(btn.value)} />
        ))}
      </div>

      {instrType === 'drum' && <DrumPanel instrument={instrument} onPack={setDrumPack} />}
      {instrType === 'fm'   && <FmPanel   instrument={instrument} trackId={trackId} onSet={setFm} />}
      {instrType === 'poly' && <PolyPanel instrument={instrument} onSet={setPoly} />}
    </div>
  )
})
