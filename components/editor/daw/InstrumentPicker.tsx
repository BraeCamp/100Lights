'use client'

import { memo, useCallback } from 'react'
import { useDaw } from '@/lib/daw-state'
import { useState } from 'react'
import type {
  TrackInstrument, InstrumentType,
  FmInstrumentParams, DrumInstrumentParams, PolyInstrumentParams, DrumPadSettings,
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
                style={{ padding: '10px 4px', borderRadius: 4, border: `2px solid ${isSelected ? color : pad.mute ? '#555' : C.border}`, background: isSelected ? `${color}22` : pad.mute ? 'rgba(80,80,80,0.2)' : C.bgCard, color: pad.mute ? '#666' : C.textPrimary, fontSize: 10, cursor: 'pointer', textAlign: 'center', transition: 'all 80ms', fontWeight: 700 }}
              >
                <div>{hit.label}</div>
                <div style={{ fontSize: 8, color: '#666', marginTop: 2 }}>{Math.round(pad.volume * 100)}%{pad.pitch !== 0 ? ` ${pad.pitch > 0 ? '+' : ''}${pad.pitch}` : ''}</div>
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
  if (!track) return null

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

  const setDrum = useCallback((changes: Partial<DrumInstrumentParams>) => {
    const prev = instrType === 'drum' ? instrument.params as DrumInstrumentParams : { pack: 'synth' as const }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'drum', params: { ...prev, ...changes } } })
  }, [dispatch, trackId, instrType, instrument.params])

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

      {instrType === 'drum' && <DrumPanel instrument={instrument} onSet={setDrum} />}
      {instrType === 'fm'   && <FmPanel   instrument={instrument} trackId={trackId} onSet={setFm} />}
      {instrType === 'poly' && <PolyPanel instrument={instrument} onSet={setPoly} />}
    </div>
  )
})
