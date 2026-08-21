'use client'

// Apollo's transport — always visible in the header.
//
// Apollo is becoming a place to develop a track item, not just a sound, so the
// timing has to be present the whole time you work rather than buried inside
// the Clips module. Everything here already existed in the engine
// (setTransport handles playing/bpm/click/beat and the worklet renders the
// click); what was missing was somewhere to reach it from.
//
// Play/Stop and Click stay in sync with the copies inside ClipPanel: both read
// the same engine meters and write through the same setTransport call, so
// there is one source of truth and no drift between the two surfaces.

import { useApollo, useMeters, UI } from './ApolloContext'

export default function TransportBar() {
  const ctx = useApollo()
  const meters = useMeters()
  const p = ctx.patch
  const playing = meters.playing
  const bpm = p.global.bpm
  const click = !!p.global.click

  const setBpm = (v: number) => {
    const next = Math.max(20, Math.min(300, Math.round(v)))
    ctx.update(d => { d.global.bpm = next })
    ctx.engine.setTransport({ bpm: next })
  }
  const toggleClick = () => {
    const next = !click
    ctx.update(d => { d.global.click = next })
    ctx.engine.setTransport({ click: next })
  }
  const togglePlay = () => {
    // Starting from 0 keeps the bar/beat readout meaningful for a looped item.
    ctx.engine.setTransport({ playing: !playing, bpm, beat: 0, click })
  }

  const btn = (on: boolean, accent?: string): React.CSSProperties => ({
    height: 24, padding: '0 10px', borderRadius: 5, cursor: 'pointer',
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6,
    background: on ? (accent ?? UI.blue) : UI.header,
    color: on ? '#0b0d10' : UI.dim,
    border: `1px solid ${on ? (accent ?? UI.blue) : UI.border}`,
    display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
  })

  const bar = playing ? Math.floor(meters.beat / 4) + 1 : 1
  const beat = playing ? (Math.floor(meters.beat) % 4) + 1 : 1

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={togglePlay} data-apollo-transport={playing ? 'playing' : 'stopped'}
        title={playing ? 'Stop' : 'Play the clip from the top'}
        style={btn(playing, UI.green)}>{playing ? '■' : '▶'}</button>

      <button onClick={toggleClick} data-apollo-click={click ? 'on' : 'off'}
        title="Metronome — a click on every beat, accented on the bar"
        style={btn(click)}>CLICK</button>

      {/* Tempo: drag or type. A track item lives or dies on its tempo, so it
          gets a real control rather than a hidden setting. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px',
        borderRadius: 5, background: UI.inset, border: `1px solid ${UI.border}`,
      }}>
        <input
          type="number" min={20} max={300} value={bpm}
          onChange={e => setBpm(Number(e.target.value))}
          data-apollo-bpm
          title="Tempo (BPM)"
          style={{
            width: 40, background: 'transparent', border: 'none', outline: 'none',
            color: UI.text, fontSize: 11.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          }}
        />
        <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 1, color: UI.dim }}>BPM</span>
      </div>

      {/* Position readout — the bar.beat you are hearing */}
      <div style={{
        height: 24, minWidth: 46, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 5, background: UI.inset, border: `1px solid ${UI.border}`,
        fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
        color: playing ? UI.text : UI.dim,
      }} data-apollo-position>{bar}.{beat}</div>
    </div>
  )
}
