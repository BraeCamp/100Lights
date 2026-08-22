'use client'

// "Draw with an Apollo LFO" — pick one of the patch's ten LFOs, point it at a
// Beacon parameter, and stamp its shape across a span as an automation graph.
//
// Baked rather than live on purpose: the result renders offline, survives a
// reload, and can be reshaped by hand afterwards like any other lane.

import { useMemo, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import type { AutomationLane, DawTrack } from '@/lib/daw-types'
import { bakeLfoToPoints, lfoRateLabel } from '@/lib/apollo/daw-lfo'
import type { ApolloPatch, LfoConfig } from '@/lib/apollo/patch'

export interface BakeTarget { label: string; parameter: string; min: number; max: number }

/** Everything on this track an LFO could usefully move. Mirrors the targets
 *  Beacon's own "add automation" menu offers, so a baked lane is
 *  indistinguishable from a hand-made one. */
export function bakeTargets(track: DawTrack | undefined, lanes: AutomationLane[]): BakeTarget[] {
  if (!track) return []
  const apollo = track.instrument?.type === 'apollo'
    ? track.instrument.params as unknown as { macroNames?: string[] }
    : null
  return [
    { label: 'Volume', parameter: 'volume', min: 0, max: 1 },
    { label: 'Pan', parameter: 'pan', min: -1, max: 1 },
    ...track.effects.map(e => ({ label: `${e.type.toUpperCase()} Wet`, parameter: `fx:${e.id}:wet`, min: 0, max: 1 })),
    ...(apollo ? [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({
      label: apollo.macroNames?.[i] || `Macro ${i + 1}`, parameter: `macro:${i}`, min: 0, max: 1,
    })) : []),
    // Anything already captured from an Apollo knob is a legitimate target too.
    ...lanes.filter(l => l.parameter.startsWith('apollo:'))
      .map(l => ({ label: l.label, parameter: l.parameter, min: l.min, max: l.max })),
  ]
}

export function ApolloLfoBake({ trackId, patch, spanBeats }: {
  trackId: string
  patch: ApolloPatch | null
  /** Length to stamp across — the hosted clip's length when there is one. */
  spanBeats: number
}) {
  const { project, dispatch } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  const lanes = useMemo(
    () => project.automationLanes.filter(l => l.trackId === trackId),
    [project.automationLanes, trackId],
  )
  const targets = useMemo(() => bakeTargets(track, lanes), [track, lanes])

  const [lfoIndex, setLfoIndex] = useState(0)
  const [target, setTarget] = useState('')
  const [depth, setDepth] = useState(1)
  const [done, setDone] = useState<string | null>(null)

  const lfos: LfoConfig[] = (patch?.lfos ?? []) as LfoConfig[]
  const lfo = lfos[lfoIndex] ?? null
  const chosen = targets.find(t => t.parameter === target) ?? targets[0] ?? null
  const span = Math.max(1, spanBeats || 4)

  if (!patch || !lfo || !chosen) return null

  const apply = () => {
    const points = bakeLfoToPoints(lfo, {
      startBeat: 0, lengthBeats: span, bpm: project.tempo,
      min: chosen.min, max: chosen.max, depth,
    }).map(p => ({ id: crypto.randomUUID(), beat: p.beat, value: p.value }))

    const existing = lanes.find(l => l.parameter === chosen.parameter)
    if (existing) {
      // Replace only the span being stamped, so an LFO drawn over bars 1-4
      // leaves anything already automated later in the song alone.
      const kept = existing.points.filter(pt => pt.beat < 0 || pt.beat > span)
      dispatch({ type: 'UPDATE_AUTOMATION_LANE', laneId: existing.id,
        patch: { points: [...kept, ...points].sort((a, b) => a.beat - b.beat) } })
    } else {
      const lane: AutomationLane = {
        id: crypto.randomUUID(), trackId, parameter: chosen.parameter,
        label: chosen.label, min: chosen.min, max: chosen.max,
        defaultValue: points[0]?.value ?? chosen.min, expanded: true, points,
      }
      dispatch({ type: 'ADD_AUTOMATION_LANE', lane })
    }
    setDone(`${chosen.label} ← LFO ${lfoIndex + 1}`)
    window.setTimeout(() => setDone(null), 2600)
  }

  const sel: React.CSSProperties = {
    height: 22, borderRadius: 5, fontSize: 10, fontWeight: 600,
    background: 'var(--bg-deep, #06080a)', color: 'var(--text-primary, #dbe1e8)',
    border: '1px solid var(--border, #262c35)', padding: '0 6px', maxWidth: 150,
  }

  return (
    <div data-apollo-lfobake style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, letterSpacing: 0.4, color: 'var(--text-muted, #8b93a0)' }}>DRAW WITH LFO</span>
      <select data-apollo-lfo-pick value={lfoIndex} onChange={e => setLfoIndex(Number(e.target.value))} style={sel}>
        {lfos.map((l, i) => (
          <option key={i} value={i}>{`LFO ${i + 1} · ${lfoRateLabel(l)}${l.bipolar ? ' · bi' : ''}`}</option>
        ))}
      </select>
      <span style={{ fontSize: 10, color: 'var(--text-muted, #8b93a0)' }}>&#8594;</span>
      <select data-apollo-lfo-target value={chosen.parameter} onChange={e => setTarget(e.target.value)} style={sel}>
        {targets.map(t => <option key={t.parameter} value={t.parameter}>{t.label}</option>)}
      </select>
      <label style={{ fontSize: 9, color: 'var(--text-muted, #8b93a0)', display: 'flex', alignItems: 'center', gap: 4 }}>
        DEPTH
        <input type="range" min={0} max={1} step={0.01} value={depth}
          data-apollo-lfo-depth
          onChange={e => setDepth(Number(e.target.value))}
          style={{ width: 70 }} />
      </label>
      <button
        onClick={apply}
        data-apollo-lfo-apply
        title={`Stamp LFO ${lfoIndex + 1}'s shape across ${span} beats of ${chosen.label} as an automation graph`}
        style={{
          height: 22, padding: '0 9px', borderRadius: 5, cursor: 'pointer', flex: 'none',
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
          background: 'transparent', color: 'var(--text-muted, #8b93a0)',
          border: '1px solid var(--border, #262c35)',
        }}
      >Draw {span} beats</button>
      {done && <span data-apollo-lfo-done style={{ fontSize: 9, color: 'var(--accent, #4aa9ff)' }}>{done}</span>}
    </div>
  )
}
