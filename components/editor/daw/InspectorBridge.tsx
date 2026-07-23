'use client'

// The editor side of the Inspector (second-screen assistant): a toolbar
// button that pops the /inspector window, plus the BroadcastChannel bridge
// that streams the current selection's settings out and applies setting
// edits coming back. Audio and state stay in this window — the inspector
// is a remote control.

import { useEffect, useRef, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import { getPresets } from '@/lib/midi-presets'
import { INSPECTOR_CHANNEL, INSPECTOR_ALLOWED_ACTIONS, type InspectorMsg, type InspectorSelection } from '@/lib/inspector-types'

const INSTRUMENT_LABELS: Record<string, string> = {
  none: 'None', drum: 'Drums', fm: 'FM', poly: 'Poly', sampler: 'Sampler', fm4op: 'FM 4-Op', wavetable: 'Wavetable',
}

export function InspectorBridge() {
  const { project, dispatch, selectedTrackId, selectedClipId, selectedClipIds, selectedEffectIds, expandedPianoRollClipId } = useDaw()
  const chanRef = useRef<BroadcastChannel | null>(null)
  const [open, setOpen] = useState(false)

  // Derive what the inspector should show: the most specific selection wins
  function buildSelection(): InspectorSelection {
    const effectId = [...selectedEffectIds][0]
    if (effectId) {
      const eff = (project.clipEffects ?? []).find(e => e.id === effectId)
      if (eff) {
        const track = project.tracks.find(t => t.id === eff.trackId)
        return { kind: 'effect', trackName: track?.name ?? '', effect: { id: eff.id, type: eff.fx ? 'bar' : (eff.type ?? 'effect'), startBeat: eff.startBeat, durationBeats: eff.durationBeats, params: { ...(eff.params ?? {}) } } }
      }
    }
    const clipId = expandedPianoRollClipId ?? selectedClipId ?? [...selectedClipIds][0]
    if (clipId) {
      const clip = project.arrangementClips.find(c => c.id === clipId)
      if (clip) {
        const track = project.tracks.find(t => t.id === clip.trackId)
        if (isMidiClip(clip)) {
          const presetName = clip.presetId
            ? getPresets().find(p => p.id === clip.presetId)?.name ?? '?'
            : track && track.instrument.type !== 'none' ? `${INSTRUMENT_LABELS[track.instrument.type]} (track)` : 'None'
          return {
            kind: 'midi-clip', trackName: track?.name ?? '',
            clip: {
              id: clip.id, name: clip.name, startBeat: clip.startBeat, durationBeats: clip.durationBeats,
              noteCount: clip.notes.length, presetName, rollFx: clip.rollFx ?? null, isDrumClip: clip.isDrumClip,
            },
          }
        }
        if (isAudioClip(clip)) {
          return {
            kind: 'audio-clip', trackName: track?.name ?? '',
            clip: {
              id: clip.id, name: clip.name, gain: clip.gain, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
              pitchSemitones: clip.pitchSemitones ?? 0, pitchCents: clip.pitchCents ?? 0,
              reverse: clip.reverse, startBeat: clip.startBeat, durationBeats: clip.durationBeats,
            },
          }
        }
      }
    }
    if (selectedTrackId) {
      const t = project.tracks.find(x => x.id === selectedTrackId)
      if (t) {
        return { kind: 'track', track: { id: t.id, name: t.name, color: t.color, volume: t.volume, pan: t.pan, mute: t.mute, solo: t.solo, instrumentType: t.instrument.type, tone: t.tone ?? null } }
      }
    }
    return { kind: 'none' }
  }

  const selectionRef = useRef(buildSelection)
  const projectNameRef = useRef(project.name ?? 'Untitled')
  useEffect(() => {
    selectionRef.current = buildSelection
    projectNameRef.current = project.name ?? 'Untitled'
  })

  useEffect(() => {
    const chan = new BroadcastChannel(INSPECTOR_CHANNEL)
    chanRef.current = chan
    chan.onmessage = (e: MessageEvent<InspectorMsg>) => {
      const msg = e.data
      if (msg.type === 'hello') {
        chan.postMessage({ type: 'state', projectName: projectNameRef.current, selection: selectionRef.current() })
      } else if (msg.type === 'action') {
        // Settings edits only — never structural changes from the remote
        if (INSPECTOR_ALLOWED_ACTIONS.has(msg.action.type)) dispatch(msg.action)
      }
    }
    return () => chan.close()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Push fresh state whenever the selection or its underlying data changes
  useEffect(() => {
    chanRef.current?.postMessage({ type: 'state', projectName: project.name ?? 'Untitled', selection: buildSelection() })
  }) // every render — cheap (structured clone of a tiny object), always current

  return (
    <button
      onClick={() => {
        window.open('/assistant', '100lights-assistant', 'width=420,height=760,menubar=no,toolbar=no')
        setOpen(true)
      }}
      title="Open the Assistant — a separate window showing the settings of whatever you select (drag it to a second screen)"
      data-help-id="inspector"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
        background: open ? 'rgba(124,58,237,0.15)' : 'transparent',
        border: '1px solid var(--border)', color: open ? '#a78bfa' : 'var(--text-muted)',
      }}
    >
      <MonitorSmartphone size={13} />
    </button>
  )
}
