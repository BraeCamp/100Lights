'use client'

import { useEffect, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'

const BANDS = [
  { name: 'Sub',        lo: 20,   hi: 60   },
  { name: 'Bass',       lo: 60,   hi: 250  },
  { name: 'Low-mid',    lo: 250,  hi: 500  },
  { name: 'Mid',        lo: 500,  hi: 2000 },
  { name: 'High-mid',   lo: 2000, hi: 4000 },
  { name: 'Presence',   lo: 4000, hi: 6000 },
  { name: 'Brilliance', lo: 6000, hi: 20000 },
]

type TrackLevel = { id: string; name: string; db: number }
type BandResult = { name: string; range: string; tracks: TrackLevel[]; masked: boolean }

function fmtHz(hz: number) { return hz >= 1000 ? `${hz / 1000}k` : String(hz) }

export default function MaskingPanel() {
  const { project, engine, playing } = useDaw()
  const [results, setResults] = useState<BandResult[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    function analyze() {
      const sampleRate = engine.ctx.sampleRate
      const fftSize = 2048
      const binWidth = sampleRate / fftSize

      const activeTracks = project.tracks.filter(t => t.type === 'audio' && !t.mute)

      const bandResults: BandResult[] = BANDS.map(band => {
        const loIdx = Math.max(0, Math.round(band.lo / binWidth))
        const hiIdx = Math.min(1023, Math.round(band.hi / binWidth))

        const trackLevels: TrackLevel[] = []
        for (const track of activeTracks) {
          const data = engine.getTrackFrequencyData(track.id)
          if (!data) continue
          let sum = 0, count = 0
          for (let i = loIdx; i <= hiIdx; i++) {
            const v = data[i]
            if (isFinite(v) && v > -Infinity) { sum += v; count++ }
          }
          const db = count > 0 ? sum / count : -100
          if (db > -60) trackLevels.push({ id: track.id, name: track.name, db })
        }

        trackLevels.sort((a, b) => b.db - a.db)

        const masked = trackLevels.length >= 2 &&
          (trackLevels[0].db - trackLevels[trackLevels.length - 1].db) < 18

        return { name: band.name, range: `${fmtHz(band.lo)}–${fmtHz(band.hi)}Hz`, tracks: trackLevels, masked }
      })

      setResults(bandResults)
    }

    if (playing) {
      analyze()
      intervalRef.current = setInterval(analyze, 200)
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null } }
  }, [engine, project.tracks, playing])

  return (
    <div style={{ padding: '10px 14px', minWidth: 260 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: '0.06em' }}>
        {playing ? 'LIVE · 200ms refresh' : 'Press play to analyze'}
      </div>
      {BANDS.map(band => {
        const result = results.find(r => r.name === band.name)
        const tracks = result?.tracks ?? []
        const masked = result?.masked ?? false
        return (
          <div key={band.name} style={{
            marginBottom: 5,
            padding: '5px 8px',
            background: masked ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${masked ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
            borderRadius: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, minWidth: 68,
                color: masked ? '#ef4444' : tracks.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>
                {band.name}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{fmtHz(band.lo)}–{fmtHz(band.hi)}Hz</span>
              {masked && (
                <span style={{ marginLeft: 'auto', fontSize: 9, color: '#ef4444', fontWeight: 700, letterSpacing: '0.06em' }}>
                  MASKING
                </span>
              )}
            </div>
            {tracks.map(t => {
              const pct = Math.max(0, Math.min(100, (t.db + 80) * 1.4))
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#3d8fef', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: 44, textAlign: 'right' }}>
                    {Math.round(t.db)} dBFS
                  </span>
                  <div style={{ width: 36, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: masked ? '#ef4444' : '#3d8fef', borderRadius: 2 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
