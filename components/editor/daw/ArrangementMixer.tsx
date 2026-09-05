'use client'

// The mixer under the arrangement.
//
// Live shows a mixer section beneath the arrangement without leaving it: one
// row of channel strips, and a drop-down that swaps what the row shows —
// the mixer itself, the sends, the returns, in/out, track options, the
// crossfader, performance impact. Beacon's Mixer was a separate view, a
// keystroke and a context switch away from the clips it balances. This is
// that row: the same ChannelStrip / ReturnChannelStrip the Mixer view draws,
// height-bounded and scrolling sideways, plus section rows built from the
// same dispatches. ⌘⌥M shows and hides it; the section is remembered
// (lib/display-settings.ts).

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { TRACK_COLORS, type DawTrack, type ReturnTrack, type CrossfaderSide } from '@/lib/daw-types'
import { ChannelStrip, ReturnChannelStrip } from './Mixer'
import Knob from './Knob'
import { useResizable, ResizeHandle } from './useResizable'
import { useDisplaySettings, setDisplay, MIXER_SECTIONS, type MixerSection } from '@/lib/display-settings'
import { crossfadeGain, describeCrossfader } from '@/lib/crossfader'
import { describeLatency } from '@/lib/latency'
import { keysFor } from '@/lib/keymap'

const SECTION_LABEL: Record<MixerSection, string> = {
  mixer: 'Mixer', sends: 'Sends', returns: 'Returns', inout: 'In / Out', options: 'Track Options', crossfader: 'Crossfader', performance: 'Performance Impact',
}

const cell: React.CSSProperties = { width: 96, flexShrink: 0, padding: '6px 6px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', boxSizing: 'border-box' }
const nameStyle = (color: string): React.CSSProperties => ({ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', borderLeft: `3px solid ${color}`, paddingLeft: 4, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box' })
const small: React.CSSProperties = { fontSize: 8.5, color: 'var(--text-muted)', letterSpacing: '0.04em' }
const pill = (on: boolean, color = 'var(--accent)'): React.CSSProperties => ({
  fontSize: 9, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
  border: on ? `1px solid ${color}` : '1px solid var(--border)',
  background: on ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-card)',
  color: on ? color : 'var(--text-secondary)',
})

export default function ArrangementMixer() {
  const { project, dispatch, engine } = useDaw()
  const display = useDisplaySettings()
  const { open, section } = display.arrangementMixer
  const resize = useResizable({ key: 'arrangement-mixer', initial: 236, min: 120, max: 520, axis: 'y', invert: true })
  if (!open) return null
  const setSection = (s: MixerSection) => setDisplay({ arrangementMixer: { open: true, section: s } })
  const close = () => setDisplay({ arrangementMixer: { open: false, section } })

  return (
    <div data-help-id="arrangement-mixer" data-mixer-section={section}
      style={{ flexShrink: 0, position: 'relative', borderTop: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      <ResizeHandle axis="y" edge="top" onPointerDown={resize.handleProps.onPointerDown} />
      <div style={{ height: 26, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 9 }}>Mixer</span>
          <select value={section} onChange={e => setSection(e.target.value as MixerSection)} aria-label="Mixer section" data-help-id="arrangement-mixer-section"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 3, padding: '1px 4px', cursor: 'pointer' }}>
            {MIXER_SECTIONS.map(s => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{SECTION_HINT[section]}</span>
        <button onClick={close} title={`Hide the mixer (${keysFor('view.arrangementMixer') ?? '⌘⌥M'})`} aria-label="Hide the mixer under the arrangement"
          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', padding: '0 2px' }}><X size={14} /></button>
      </div>
      <div style={{ height: resize.size, overflowX: 'auto', overflowY: section === 'mixer' || section === 'returns' ? 'hidden' : 'auto', display: 'flex', alignItems: 'stretch' }}>
        {section === 'mixer' && (
          <>
            {project.tracks.map(t => <ChannelStrip key={t.id} track={t} />)}
            <div style={{ flexShrink: 0, borderLeft: '2px solid var(--border-light)' }}><ChannelStrip isMaster /></div>
          </>
        )}
        {section === 'returns' && <Returns project={project} dispatch={dispatch} />}
        {section === 'sends' && project.tracks.map(t => <SendsCell key={t.id} track={t} returns={project.returnTracks} />)}
        {section === 'inout' && project.tracks.map(t => <InOutCell key={t.id} track={t} />)}
        {section === 'options' && project.tracks.map((t, i) => <OptionsCell key={t.id} track={t} index={i} />)}
        {section === 'crossfader' && <CrossfaderRow />}
        {section === 'performance' && project.tracks.map(t => <PerformanceCell key={t.id} track={t} />)}
        {section !== 'mixer' && section !== 'returns' && project.tracks.length === 0 && (
          <span style={{ ...small, padding: 12 }}>No tracks yet.</span>
        )}
      </div>
    </div>
  )

  function SendsCell({ track, returns }: { track: DawTrack; returns: ReturnTrack[] }) {
    return (
      <div style={cell} data-help-id="mixer-sends-cell">
        <span style={nameStyle(track.color)}>{track.name}</span>
        {returns.length === 0 && <span style={small}>no returns</span>}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          {returns.map((rt, idx) => {
            const v = track.sendAmounts?.[rt.id] ?? 0
            const label = String.fromCharCode(65 + idx)
            return (
              <Knob key={rt.id} value={v} min={0} max={1} defaultValue={0} size={22} color={rt.color} label={label}
                spec={{ label: `Send ${label} (${rt.name})`, min: 0, max: 1, unit: '%' }}
                onChange={nv => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { sendAmounts: { ...(track.sendAmounts ?? {}), [rt.id]: nv } } }); engine.setSendAmount(track.id, rt.id, nv) }} />
            )
          })}
        </div>
      </div>
    )
  }

  function InOutCell({ track }: { track: DawTrack }) {
    const src = track.inputSource ?? 'mic'
    return (
      <div style={cell} data-help-id="mixer-inout-cell">
        <span style={nameStyle(track.color)}>{track.name}</span>
        <span style={small}>Audio from</span>
        <select value={src} aria-label={`${track.name} input`} onChange={e => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { inputSource: e.target.value } })}
          style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 9, borderRadius: 3, padding: '1px 2px' }}>
          <option value="mic">Microphone</option>
          <option value="system">System audio</option>
        </select>
        <button style={pill(!!track.armed, '#ef4444')} aria-pressed={!!track.armed} title="Arm for recording"
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !track.armed } })}>● Arm</button>
        <span style={small}>Audio to: {track.groupId ? project.tracks.find(g => g.id === track.groupId)?.name ?? 'group' : 'Master'}</span>
      </div>
    )
  }

  function OptionsCell({ track, index }: { track: DawTrack; index: number }) {
    return (
      <div style={cell} data-help-id="mixer-options-cell">
        <span style={nameStyle(track.color)}>{index + 1} · {track.name}</span>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          {TRACK_COLORS.slice(0, 8).map(c => (
            <button key={c} aria-label={`Colour ${c}`} onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { color: c } })}
              style={{ width: 12, height: 12, borderRadius: 3, background: c, border: track.color === c ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.4)', cursor: 'pointer', padding: 0 }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          <button style={pill(!track.mute)} aria-pressed={!track.mute} title="Track activator — on plays, off is muted"
            onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}>{track.mute ? 'Off' : 'On'}</button>
          <button style={pill(!!track.solo, '#f59e0b')} aria-pressed={!!track.solo} onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}>Solo</button>
        </div>
      </div>
    )
  }

  function PerformanceCell({ track }: { track: DawTrack }) {
    const notes = project.arrangementClips.filter(c => c.trackId === track.id && c.kind === 'midi').reduce((n, c) => n + ((c as { notes?: unknown[] }).notes?.length ?? 0), 0)
    const devices = track.effects.length
    const lat = engine.trackLatencySamples(track.id)
    const heavy = devices >= 4 || notes > 400
    return (
      <div style={cell} data-help-id="mixer-performance-cell">
        <span style={nameStyle(track.color)}>{track.name}</span>
        <span style={{ ...small, color: heavy ? '#f59e0b' : 'var(--text-muted)' }}>{devices} device{devices === 1 ? '' : 's'}</span>
        <span style={small}>{notes} notes</span>
        <span style={small}>{track.instrument.type === 'apollo' ? 'Apollo voice' : track.instrument.type}</span>
        <span style={small}>Δ {describeLatency(lat, engine.ctx.sampleRate)}</span>
      </div>
    )
  }

  function CrossfaderRow() {
    const value = project.crossfaderValue ?? 0.5
    return (
      <>
        <div style={{ ...cell, width: 150 }} data-help-id="crossfader">
          <span style={{ ...small, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>A ⟷ B</span>
          <Knob value={value} min={0} max={1} defaultValue={0.5} size={44} bipolar spec={{ label: 'Crossfader', min: 0, max: 1 }}
            format={describeCrossfader}
            onChange={v => dispatch({ type: 'SET_CROSSFADER', value: v })} />
          <span style={small}>{describeCrossfader(value)}</span>
        </div>
        {project.tracks.map(t => {
          const side: CrossfaderSide = t.crossfader ?? 'none'
          const g = crossfadeGain(side, value)
          return (
            <div key={t.id} style={cell} data-help-id="mixer-crossfader-cell" data-crossfader-side={side}>
              <span style={nameStyle(t.color)}>{t.name}</span>
              <div style={{ display: 'flex', gap: 3 }}>
                {(['A', 'none', 'B'] as CrossfaderSide[]).map(s => (
                  <button key={s} style={pill(side === s)} aria-pressed={side === s} aria-label={`${t.name} crossfader ${s === 'none' ? 'off' : s}`}
                    onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { crossfader: s } })}>{s === 'none' ? '—' : s}</button>
                ))}
              </div>
              <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{side === 'none' ? 'not on the fader' : `${Math.round(g * 100)}%`}</span>
            </div>
          )
        })}
      </>
    )
  }
}

const SECTION_HINT: Record<MixerSection, string> = {
  mixer: 'every strip, as in the Mixer view',
  sends: 'how much of each track goes to each return',
  returns: 'the return buses',
  inout: 'where each track records from and plays to',
  options: 'number, colour, on/off, solo',
  crossfader: 'assign tracks to A or B, then fade between them',
  performance: 'what each track costs to play',
}

function Returns({ project, dispatch }: { project: ReturnType<typeof useDaw>['project']; dispatch: ReturnType<typeof useDaw>['dispatch'] }) {
  const [, tick] = useState(0)
  useEffect(() => { tick(n => n + 1) }, [project.returnTracks.length])
  const add = () => {
    const idx = project.returnTracks.length
    dispatch({ type: 'ADD_RETURN_TRACK', track: { id: crypto.randomUUID(), name: `Return ${String.fromCharCode(65 + idx)}`, color: TRACK_COLORS[(idx + 6) % TRACK_COLORS.length], volume: 0.8, pan: 0, mute: false, effects: [] } })
  }
  return (
    <>
      {project.returnTracks.map((rt, idx) => <ReturnChannelStrip key={rt.id} rt={rt} idx={idx} />)}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '8px 6px' }}>
        <button onClick={add} data-help-id="mixer-add-return"
          style={{ width: 60, padding: '4px 0', fontSize: 10, borderRadius: 4, border: '1px solid #7c5fa8', background: 'rgba(80,40,120,0.18)', color: 'var(--accent-light)', cursor: 'pointer' }}>+ Return</button>
      </div>
    </>
  )
}
