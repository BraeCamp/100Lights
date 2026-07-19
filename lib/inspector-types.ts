// Protocol between the editor and the Inspector window (second-screen
// assistant). The editor owns all state and audio; the inspector is a remote
// control that renders the current selection's settings and sends ordinary
// dispatch actions back over a BroadcastChannel.

import type { DawAction } from './daw-state'

export const INSPECTOR_CHANNEL = '100lights-inspector'

export type InspectorSelection =
  | { kind: 'none' }
  | { kind: 'track'; track: { id: string; name: string; color: string; volume: number; pan: number; mute: boolean; solo: boolean; instrumentType: string; tone: { sub?: number; bass?: number; mid?: number; treble?: number } | null } }
  | { kind: 'audio-clip'; trackName: string; clip: { id: string; name: string; gain: number; fadeIn: number; fadeOut: number; pitchSemitones: number; pitchCents: number; reverse: boolean; startBeat: number; durationBeats: number } }
  | { kind: 'midi-clip'; trackName: string; clip: { id: string; name: string; startBeat: number; durationBeats: number; noteCount: number; presetName: string; rollFx: { sustain?: number; reverbWet?: number; distortion?: number; filterHz?: number; sub?: number; bass?: number; mid?: number; treble?: number } | null; isDrumClip: boolean } }
  | { kind: 'effect'; trackName: string; effect: { id: string; type: string; startBeat: number; durationBeats: number; params: Record<string, unknown> } }

export interface InspectorStateMsg {
  type: 'state'
  projectName: string
  selection: InspectorSelection
}

export interface InspectorHelloMsg { type: 'hello' }

export interface InspectorActionMsg {
  type: 'action'
  action: DawAction
}

export type InspectorMsg = InspectorStateMsg | InspectorHelloMsg | InspectorActionMsg

/** Only these action types may cross the bridge — the inspector edits settings, nothing else. */
export const INSPECTOR_ALLOWED_ACTIONS = new Set(['UPDATE_TRACK', 'UPDATE_CLIP', 'UPDATE_CLIP_EFFECT'])
