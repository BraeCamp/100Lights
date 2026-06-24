'use client'

import { useDaw } from '@/lib/daw-state'
import type { TrackInstrument, InstrumentType, FmInstrumentParams, DrumInstrumentParams } from '@/lib/daw-types'
import { defaultDrumInstrument, defaultFmInstrument } from '@/lib/daw-types'
import { previewNote } from '@/lib/daw-instruments'

const C = {
  bgBase:      '#141414',
  bgSurface:   '#1c1c1c',
  bgCard:      '#222222',
  border:      '#2c2c2c',
  accent:      '#3d8fef',
  textPrimary: '#d4d4d4',
  textMuted:   '#888888',
} as const

type DrumHit = { label: string; pitch: number }

const DRUM_HITS: DrumHit[] = [
  { label: 'Kick',      pitch: 36 },
  { label: 'Snare',     pitch: 38 },
  { label: 'Hi-Hat',    pitch: 42 },
  { label: 'Open Hat',  pitch: 46 },
  { label: 'Clap',      pitch: 39 },
  { label: 'Rim',       pitch: 51 },
  { label: 'Crash',     pitch: 49 },
  { label: 'Tom',       pitch: 45 },
]

const FM_WAVEFORMS: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle']

export default function InstrumentPicker({ trackId }: { trackId: string }) {
  const { project, dispatch, engine } = useDaw()

  const track = project.tracks.find(t => t.id === trackId)
  if (!track || track.type === 'audio') return null

  const instrument = track.instrument
  const instrType  = instrument.type

  function setType(next: InstrumentType) {
    let newInstrument: TrackInstrument
    if (next === 'drum') newInstrument = defaultDrumInstrument()
    else if (next === 'fm') newInstrument = defaultFmInstrument()
    else newInstrument = { type: 'none', params: {} }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: newInstrument })
  }

  function setFmParam<K extends keyof FmInstrumentParams>(key: K, value: FmInstrumentParams[K]) {
    if (instrType !== 'fm') return
    const params = instrument.params as FmInstrumentParams
    dispatch({
      type: 'SET_INSTRUMENT',
      trackId,
      instrument: { type: 'fm', params: { ...params, [key]: value } },
    })
  }

  function setDrumPack(pack: DrumInstrumentParams['pack']) {
    dispatch({
      type: 'SET_INSTRUMENT',
      trackId,
      instrument: { type: 'drum', params: { pack } },
    })
  }

  const typeButtons: { label: string; value: InstrumentType }[] = [
    { label: 'None',     value: 'none' },
    { label: 'Drum',     value: 'drum' },
    { label: 'FM Synth', value: 'fm'   },
  ]

  return (
    <div
      style={{
        background: C.bgSurface,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minWidth: 320,
      }}
    >
      {/* Type selector */}
      <div style={{ display: 'flex', gap: 4 }}>
        {typeButtons.map(btn => (
          <button
            key={btn.value}
            onClick={e => { e.stopPropagation(); setType(btn.value) }}
            style={{
              flex: 1,
              padding: '5px 0',
              borderRadius: 4,
              border: `1px solid ${instrType === btn.value ? C.accent : C.border}`,
              background: instrType === btn.value ? `${C.accent}22` : C.bgCard,
              color: instrType === btn.value ? C.accent : C.textMuted,
              fontSize: 12,
              fontWeight: instrType === btn.value ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Drum panel */}
      {instrType === 'drum' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Pack selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Pack
            </span>
            <label
              onClick={e => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name={`pack-${trackId}`}
                value="synth"
                checked={(instrument.params as DrumInstrumentParams).pack === 'synth'}
                onChange={e => { e.stopPropagation(); setDrumPack('synth') }}
                onClick={e => e.stopPropagation()}
                style={{ accentColor: C.accent }}
              />
              <span style={{ fontSize: 13, color: C.textPrimary }}>Acoustic</span>
            </label>
          </div>

          {/* Drum pads */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {DRUM_HITS.map(hit => (
              <button
                key={hit.pitch}
                onClick={e => {
                  e.stopPropagation()
                  previewNote(engine.ctx, engine.masterGain, instrument, hit.pitch)
                }}
                style={{
                  padding: '10px 4px',
                  borderRadius: 4,
                  border: `1px solid ${C.border}`,
                  background: C.bgCard,
                  color: C.textPrimary,
                  fontSize: 11,
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'background 80ms',
                }}
                onMouseDown={e => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLButtonElement).style.background = `${C.accent}33`
                }}
                onMouseUp={e => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLButtonElement).style.background = C.bgCard
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = C.bgCard
                }}
              >
                {hit.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FM panel */}
      {instrType === 'fm' && (() => {
        const p = instrument.params as FmInstrumentParams
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* ADSR */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Envelope
              </span>
              {(
                [
                  { label: 'Attack',  key: 'attack'  as const, min: 0.001, max: 2,   step: 0.001 },
                  { label: 'Decay',   key: 'decay'   as const, min: 0.001, max: 2,   step: 0.001 },
                  { label: 'Sustain', key: 'sustain' as const, min: 0,     max: 1,   step: 0.01  },
                  { label: 'Release', key: 'release' as const, min: 0.001, max: 4,   step: 0.001 },
                ] as const
              ).map(row => (
                <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 52, fontSize: 12, color: C.textMuted, flexShrink: 0 }}>{row.label}</span>
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    value={p[row.key]}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); setFmParam(row.key, parseFloat(e.target.value)) }}
                    style={{ flex: 1, accentColor: C.accent }}
                  />
                  <span style={{ width: 38, fontSize: 11, color: C.textPrimary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {p[row.key].toFixed(row.key === 'sustain' ? 2 : 3)}
                  </span>
                </div>
              ))}
            </div>

            {/* Waveform */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Waveform
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {FM_WAVEFORMS.map(w => (
                  <button
                    key={w}
                    onClick={e => { e.stopPropagation(); setFmParam('waveform', w) }}
                    style={{
                      flex: 1,
                      padding: '4px 0',
                      borderRadius: 4,
                      border: `1px solid ${p.waveform === w ? C.accent : C.border}`,
                      background: p.waveform === w ? `${C.accent}22` : C.bgCard,
                      color: p.waveform === w ? C.accent : C.textMuted,
                      fontSize: 11,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {/* Detune, Mod Ratio, Mod Depth */}
            {(
              [
                { label: 'Detune',    key: 'detune'   as const, min: -100, max: 100, step: 1,    fmt: (v: number) => `${v}¢`    },
                { label: 'Mod Ratio', key: 'modRatio' as const, min: 0.5,  max: 8,   step: 0.01, fmt: (v: number) => v.toFixed(2) },
                { label: 'Mod Depth', key: 'modDepth' as const, min: 0,    max: 4,   step: 0.01, fmt: (v: number) => v.toFixed(2) },
              ] as const
            ).map(row => (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 68, fontSize: 12, color: C.textMuted, flexShrink: 0 }}>{row.label}</span>
                <input
                  type="range"
                  min={row.min}
                  max={row.max}
                  step={row.step}
                  value={p[row.key]}
                  onClick={e => e.stopPropagation()}
                  onChange={e => { e.stopPropagation(); setFmParam(row.key, parseFloat(e.target.value)) }}
                  style={{ flex: 1, accentColor: C.accent }}
                />
                <span style={{ width: 38, fontSize: 11, color: C.textPrimary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {row.fmt(p[row.key])}
                </span>
              </div>
            ))}

            {/* Preview */}
            <button
              onClick={e => {
                e.stopPropagation()
                previewNote(engine.ctx, engine.masterGain, instrument, 60)
              }}
              style={{
                alignSelf: 'flex-start',
                padding: '6px 16px',
                borderRadius: 4,
                border: `1px solid ${C.accent}`,
                background: `${C.accent}22`,
                color: C.accent,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Preview
            </button>
          </div>
        )
      })()}
    </div>
  )
}
