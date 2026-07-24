'use client'

// Mobile DAW ⇆ engine wiring. Holds the SAME reducer + DawEngine the desktop
// uses, so a phone project IS a desktop project. Transport is imperative on the
// engine; all data/mixer edits go through `dispatch`. The engine re-syncs on
// every project change (updateProject is diff-aware), and the playhead is read
// from engine.currentBeat in a RAF while playing.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { reducer } from '@/lib/daw-state'
import { DawEngine } from '@/lib/daw-engine'
import { getPresets } from '@/lib/midi-presets'
import type { DawProject } from '@/lib/daw-types'

export interface MobileDaw {
  project: DawProject
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>
  engine: DawEngine
  playing: boolean
  position: number      // playhead, in beats
  play: () => void
  stop: () => void
  seek: (beat: number) => void
  toggle: () => void
}

export function useDawEngine(init: () => DawProject): MobileDaw {
  const [project, dispatch] = useReducer(reducer, undefined, init)

  const engineRef = useRef<DawEngine | null>(null)
  if (engineRef.current === null || engineRef.current.isClosed) {
    engineRef.current = new DawEngine()
  }
  const engine = engineRef.current

  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)

  // MIDI clips that reference a presetId need the preset library.
  useEffect(() => { engine.setPresets(getPresets()) }, [engine])

  // Single source of truth: push the whole project into the engine on change.
  useEffect(() => { engine.updateProject(project) }, [project, engine])

  // Tear the engine down (closes its AudioContext + BroadcastChannel) on unmount.
  useEffect(() => () => { engineRef.current?.dispose() }, [])

  // Playing flag comes from the engine's transport event (also fires when another
  // tab grabs playback via the BroadcastChannel).
  useEffect(() => {
    const onTransport = (e: Event) => setPlaying(!!(e as CustomEvent).detail?.playing)
    engine.addEventListener('transport', onTransport)
    return () => engine.removeEventListener('transport', onTransport)
  }, [engine])

  // Playhead RAF while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => { setPosition(engine.currentBeat); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, engine])

  const play = useCallback(() => { void engine.play() }, [engine])
  const stop = useCallback(() => { engine.stop() }, [engine])
  const seek = useCallback((beat: number) => { engine.seek(beat); setPosition(beat) }, [engine])
  const toggle = useCallback(() => { if (engine.isPlaying) engine.stop(); else void engine.play() }, [engine])

  return { project, dispatch, engine, playing, position, play, stop, seek, toggle }
}
