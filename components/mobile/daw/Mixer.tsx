'use client'

// Mobile mixer — one channel strip per track: volume, pan, mute, solo, plus a
// master fader. Edits go through the reducer (UPDATE_TRACK / SET_MASTER_VOLUME);
// volume also nudges the engine directly for a click-free live drag.

import type { MobileDaw } from './engine-hook'
import type { DawTrack } from '@/lib/daw-types'

export function Mixer({ daw }: { daw: MobileDaw }) {
  const { project, dispatch, engine } = daw
  const tracks = project.tracks.filter(t => t.kind !== 'group')
  const anySolo = tracks.some(t => t.solo)

  const setVol = (t: DawTrack, v: number) => {
    engine.setTrackVolume(t.id, v)            // live, click-free
    dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { volume: v } })
  }
  const setPan = (t: DawTrack, p: number) => {
    engine.setTrackPan(t.id, p)
    dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { pan: p } })
  }

  return (
    <div style={{ padding: '12px 14px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {tracks.map(t => {
        const dimmed = anySolo && !t.solo
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', opacity: t.mute || dimmed ? 0.55 : 1 }}>
            <span style={{ width: 8, height: 34, borderRadius: 3, background: t.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>{t.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 22 }}>VOL</span>
                <input type="range" min={0} max={100} value={Math.round(t.volume * 100)} onChange={e => setVol(t, Number(e.target.value) / 100)} style={{ flex: 1, accentColor: t.color }} aria-label={`${t.name} volume`} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 22 }}>PAN</span>
                <input type="range" min={-100} max={100} value={Math.round(t.pan * 100)} onChange={e => setPan(t, Number(e.target.value) / 100)} style={{ flex: 1, accentColor: 'var(--text-muted)' }} aria-label={`${t.name} pan`} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
              <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { mute: !t.mute } })} aria-pressed={t.mute} style={chip(t.mute, '#ef4444')}>M</button>
              <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { solo: !t.solo } })} aria-pressed={t.solo} style={chip(t.solo, '#eab308')}>S</button>
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--accent)', background: 'rgba(139,92,246,0.08)', marginTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent-light)', width: 54 }}>MASTER</span>
        <input type="range" min={0} max={100} value={Math.round((project.masterVolume ?? 0.85) * 100)} onChange={e => { const v = Number(e.target.value) / 100; engine.setMasterVolume(v); dispatch({ type: 'SET_MASTER_VOLUME', volume: v }) }} style={{ flex: 1, accentColor: '#8b5cf6' }} aria-label="Master volume" />
      </div>
    </div>
  )
}

const chip = (on: boolean, color: string): React.CSSProperties => ({
  width: 30, height: 26, borderRadius: 7, fontSize: 12, fontWeight: 800, cursor: 'pointer',
  border: `1px solid ${on ? color : 'var(--border)'}`,
  background: on ? color : 'transparent',
  color: on ? '#fff' : 'var(--text-muted)',
})
