'use client'

// Apollo motion recording — "play the loop, move knobs, keep the moves."
//
// The whole surface funnels through Apollo's ctx.setParam(path, value), so
// arming record here captures every knob, slider and MIDI-learned control
// without touching any individual component. Each move becomes a point on an
// automation lane named `apollo:{patchPath}` on the track, which the engine
// plays back through setApolloTrackParam — and which we mirror onto the card
// so the knobs visibly move as the take runs.
//
// Passes are cumulative: recording again over the same span adds to what is
// there (existing points inside the newly-recorded window are replaced, so a
// second pass over the same knob refines it rather than layering noise).
// Every recorded parameter can be reverted on its own, back to the patch value
// it had before recording started.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import type { AutomationLane, AutomationPoint } from '@/lib/daw-types'

export interface LiveParam { path: string; value: number; stamp: number }

/** Points closer together than this are redundant for a knob sweep. */
const MIN_BEAT_GAP = 1 / 24

export interface MotionOptions {
  /** Where "now" comes from while capturing. Apollo plays the hosted item on
   *  its OWN clock, so when that is running the beat must come from there and
   *  be mapped onto the arrangement timeline — otherwise moves land wherever
   *  Beacon's stopped playhead happens to sit. Returning null falls back to
   *  the DAW transport, which is the original behaviour. */
  beatSource?: () => number | null
}

export function useApolloMotion(trackId: string, opts: MotionOptions = {}) {
  const { project, dispatch, engine } = useDaw()
  const [recording, setRecording] = useState(false)
  const [looping, setLooping] = useState(false)
  const [live, setLive] = useState<LiveParam | null>(null)
  const prevLoopRef = useRef<{ enabled: boolean; start: number; end: number } | null>(null)
  // Patch values captured when arming, so a single parameter can be reverted.
  const originalsRef = useRef<Map<string, number>>(new Map())
  const lastWriteRef = useRef<Map<string, number>>(new Map())

  const lanes = project.automationLanes.filter(l => l.trackId === trackId && l.parameter.startsWith('apollo:'))

  // ── Record: every knob move lands on its lane at the current beat ──
  const beatSourceRef = useRef(opts.beatSource)
  beatSourceRef.current = opts.beatSource

  const onParamMove = useCallback((path: string, value: number) => {
    if (!recording) return
    const beat = beatSourceRef.current?.() ?? engine.currentBeat
    const parameter = `apollo:${path}`
    const lane = project.automationLanes.find(l => l.trackId === trackId && l.parameter === parameter)
    // Thin the stream: a knob sweep fires far faster than the curve needs.
    const last = lastWriteRef.current.get(parameter)
    if (last != null && beat - last < MIN_BEAT_GAP) return
    lastWriteRef.current.set(parameter, beat)

    if (!lane) {
      if (!originalsRef.current.has(parameter)) originalsRef.current.set(parameter, value)
      const fresh: AutomationLane = {
        id: crypto.randomUUID(), trackId, parameter,
        label: path, min: 0, max: 1, defaultValue: value, expanded: false,
        points: [{ id: crypto.randomUUID(), beat, value }],
      }
      dispatch({ type: 'ADD_AUTOMATION_LANE', lane: fresh })
      return
    }
    // A later pass over the same moment replaces the earlier point, so
    // re-recording a knob refines the take instead of stacking points on it.
    const kept = lane.points.filter(pt => Math.abs(pt.beat - beat) >= MIN_BEAT_GAP)
    const points: AutomationPoint[] = [...kept, { id: crypto.randomUUID(), beat, value }]
      .sort((a, b) => a.beat - b.beat)
    dispatch({ type: 'UPDATE_AUTOMATION_LANE', laneId: lane.id, patch: { points } })
  }, [recording, engine, project.automationLanes, trackId, dispatch])

  // ── Playback: mirror recorded values onto the card's knobs ──
  useEffect(() => {
    if (recording || lanes.length === 0) return
    let raf = 0
    const tick = () => {
      const hosted = beatSourceRef.current?.()
      if (hosted != null || engine.isPlaying) {
        const beat = hosted ?? engine.currentBeat
        for (const lane of lanes) {
          const pts = [...lane.points].sort((a, b) => a.beat - b.beat)
          if (!pts.length) continue
          // value at the playhead (held before the first / after the last point)
          let v = pts[0].value
          for (let i = 0; i < pts.length; i++) {
            if (pts[i].beat > beat) break
            const nxt = pts[i + 1]
            v = nxt && nxt.beat > pts[i].beat
              ? pts[i].value + (nxt.value - pts[i].value) * Math.min(1, Math.max(0, (beat - pts[i].beat) / (nxt.beat - pts[i].beat)))
              : pts[i].value
          }
          setLive({ path: lane.parameter.slice(7), value: v, stamp: performance.now() })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [recording, lanes, engine])

  // ── Loop the clip under the playhead so passes repeat ──
  const clipForLoop = project.arrangementClips
    .filter(c => c.trackId === trackId)
    .sort((a, b) => a.startBeat - b.startBeat)[0] ?? null

  const stopLoop = useCallback(() => {
    setLooping(false)
    engine.stop()
    const prev = prevLoopRef.current
    if (prev) {
      dispatch({ type: 'SET_LOOP', start: prev.start, end: prev.end })
      dispatch({ type: 'SET_LOOP_ENABLED', enabled: prev.enabled })
      prevLoopRef.current = null
    }
  }, [engine, dispatch])

  const toggleLoop = useCallback(() => {
    if (looping) { stopLoop(); return }
    if (!clipForLoop) return
    prevLoopRef.current = { enabled: project.loopEnabled, start: project.loopStart, end: project.loopEnd }
    dispatch({ type: 'SET_LOOP', start: clipForLoop.startBeat, end: clipForLoop.startBeat + clipForLoop.durationBeats })
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: true })
    setLooping(true)
    void engine.play(clipForLoop.startBeat)
  }, [looping, clipForLoop, project.loopEnabled, project.loopStart, project.loopEnd, dispatch, engine, stopLoop])

  const toggleRecord = useCallback(() => {
    setRecording(r => {
      const next = !r
      if (next) {
        lastWriteRef.current.clear()
        // Start the loop too — recording only means anything while it runs.
        if (!looping && clipForLoop) toggleLoop()
      }
      return next
    })
  }, [looping, clipForLoop, toggleLoop])

  /** Drop one recorded parameter, returning that control to where it was. */
  const revertParam = useCallback((laneId: string) => {
    const lane = project.automationLanes.find(l => l.id === laneId)
    dispatch({ type: 'REMOVE_AUTOMATION_LANE', laneId })
    if (lane) {
      const original = originalsRef.current.get(lane.parameter) ?? lane.defaultValue
      setLive({ path: lane.parameter.slice(7), value: original, stamp: performance.now() })
      originalsRef.current.delete(lane.parameter)
    }
  }, [project.automationLanes, dispatch])

  const revertAll = useCallback(() => {
    for (const lane of lanes) revertParam(lane.id)
  }, [lanes, revertParam])

  useEffect(() => () => { if (looping) stopLoop() }, [looping, stopLoop])

  return {
    recording, looping, live, lanes, canLoop: !!clipForLoop,
    onParamMove, toggleRecord, toggleLoop, revertParam, revertAll,
  }
}
