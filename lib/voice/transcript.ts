'use client'
// The conversation, as it happened: what you said, what Light said back, and
// what Light DID.
//
// Brae: "Let's create a voice control transcript / log. It would say what the
// user said, what Light responded with, and what Light did."
//
// ⚠️ THREE COLUMNS, NOT TWO. The ledger knows what a command cost and the trace
// knows which tools ran with which arguments — both are for finding out why
// something went wrong. This is for the person talking: a reply is a claim
// ("reverb on Pad at 80%"), and the list of what actually changed in the song
// is the evidence beside it. "Moved to bar 5" next to "Start a low pass on
// bar 5" is a mistake you can see without opening anything else.

export interface TranscriptEntry {
  at: number
  /** What was heard (or typed). */
  said: string
  source: 'spoken' | 'typed'
  /** What Light said back — the read-back, or the refusal. */
  reply: string
  /** True when the reply was a refusal or a failure rather than a report. */
  problem: boolean
  /** Which rung answered — free rules, the learned cache, a macro, the model. */
  path: 'rules' | 'learned' | 'shared' | 'macro' | 'assistant' | 'failed' | 'browse'
  /** What changed in the song, in plain words. Empty when nothing did. */
  did: string[]
}

const KEY = 'beacon.voice.transcript.v1'
const MAX = 200

const entries: TranscriptEntry[] = []
let loaded = false
const listeners = new Set<() => void>()

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) entries.push(...(JSON.parse(raw) as TranscriptEntry[]))
  } catch { /* private mode, or a corrupt entry — start fresh */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX))) } catch { /* full */ }
  }, 500)
}

function changed(): void { for (const f of listeners) f() }

export function onTranscript(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

export function recordExchange(e: Omit<TranscriptEntry, 'at'> & { at?: number }): void {
  load()
  entries.push({ ...e, at: e.at ?? Date.now(), did: e.did.filter(Boolean) })
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
  save()
  changed()
}

/** Newest last. */
export function transcript(): TranscriptEntry[] { load(); return entries.slice() }

export function clearTranscript(): void {
  load()
  entries.length = 0
  try { localStorage.removeItem(KEY) } catch { /* ok */ }
  changed()
}

// ── What an action means, in words ──────────────────────────────────────────
//
// The reducer's actions are the only honest record of what changed; a tool
// call is only what was asked for. Each one becomes a short sentence. Unknown
// actions still get a line — "did something" is better than a blank, because a
// blank reads as "did nothing".

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v))
const bar = (beat: unknown, beatsPerBar = 4) =>
  typeof beat === 'number' ? `bar ${Math.floor(beat / beatsPerBar) + 1}` : 'there'

export function describeAction(a: unknown, names: { track?: (id: string) => string; clip?: (id: string) => string; beatsPerBar?: number } = {}): string {
  // Loosely typed on purpose: the voice runner hands over reducer actions AND
  // its own intents (TRANSPORT, VIEW_ACTION, BROWSE…), and a description must
  // never be the thing that refuses an action it has not heard of.
  const act = a as { type?: string } & Record<string, unknown>
  const t = (id: unknown) => (typeof id === 'string' && names.track ? names.track(id) : 'the track')
  const c = (id: unknown) => (typeof id === 'string' && names.clip ? names.clip(id) : 'the clip')
  const bpb = names.beatsPerBar ?? 4
  switch (act.type) {
    case 'TRANSPORT': {
      const action = String(act.action ?? '')
      if (action === 'locate') return `Moved the playhead to ${bar(act.beat, bpb)}`
      if (action === 'play') return 'Started playing'
      if (action === 'stop') return 'Stopped'
      if (action === 'restart') return 'Restarted from the top'
      return `Transport: ${action}`
    }
    case 'VIEW_ACTION': return `${act.open === false ? 'Closed' : 'Opened'} the ${String(act.view)} view`
    case 'BROWSE': return `Started browsing ${String(act.kind ?? 'sounds')}${act.asked ? ` ${String(act.asked)}` : ''}`
    case 'PROJECT_ACTION': return `Project: ${String(act.action ?? '')}`
    case 'ADD_TRACK': return `Added a track "${String(act.name ?? 'Track')}"`
    case 'REMOVE_TRACK': return `Removed ${t(act.trackId)}`
    case 'UPDATE_TRACK': {
      const p = (act.patch ?? {}) as Record<string, unknown>
      const parts: string[] = []
      if ('volume' in p) parts.push(`volume ${pct(p.volume)}`)
      if ('pan' in p) parts.push(`pan ${typeof p.pan === 'number' ? (Math.abs(p.pan) < 0.02 ? 'centre' : `${p.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(p.pan) * 100)}`) : String(p.pan)}`)
      if ('mute' in p) parts.push(p.mute ? 'muted' : 'unmuted')
      if ('solo' in p) parts.push(p.solo ? 'soloed' : 'unsoloed')
      if ('name' in p) parts.push(`renamed to "${String(p.name)}"`)
      if ('color' in p) parts.push('recoloured')
      return `${t(act.trackId)}: ${parts.length ? parts.join(', ') : `changed ${Object.keys(p).join(', ')}`}`
    }
    case 'SET_INSTRUMENT': return `${t(act.trackId)}: instrument set to ${String((act.instrument as { type?: string } | undefined)?.type ?? 'a new one')}`
    case 'ADD_CLIP': {
      const clip = act.clip as { name?: string; startBeat?: number; isDrumClip?: boolean; trackId?: string; kind?: string } | undefined
      return `Added ${clip?.kind === 'audio' ? 'an audio clip' : clip?.isDrumClip ? 'a beat' : 'a clip'} "${clip?.name ?? ''}" at ${bar(clip?.startBeat, bpb)} on ${t(clip?.trackId)}`
    }
    case 'REMOVE_CLIP': return `Removed ${c(act.clipId)}`
    case 'MOVE_CLIP': return `Moved ${c(act.clipId)} to ${bar(act.startBeat, bpb)}`
    case 'MOVE_TRACK': return `Moved ${t(act.trackId)} ${act.beforeId ? `above ${t(act.beforeId)}` : 'to the bottom'}`
    case 'WORKSPACE': {
      const w = act as { view?: string; zoom?: string; scrollToBeat?: number; snap?: string; overlay?: string; soundPanelClipId?: string | null; focusTrackId?: string; command?: string }
      const parts: string[] = []
      if (w.view) parts.push(`${w.view} view`)
      if (w.zoom) parts.push(w.zoom === 'fit' ? 'fitted the song to the screen' : `zoomed ${w.zoom}`)
      if (w.scrollToBeat != null) parts.push(`showed ${bar(w.scrollToBeat, bpb)}`)
      if (w.snap) parts.push(`snap ${w.snap}`)
      if (w.overlay) parts.push(w.overlay === 'none' ? 'overlay off' : `${w.overlay} overlay`)
      if (w.soundPanelClipId !== undefined) parts.push(`opened the sound panel${w.soundPanelClipId ? ` for ${c(w.soundPanelClipId)}` : ''}`)
      if (w.focusTrackId) parts.push(`showed ${t(w.focusTrackId)}`)
      if (w.command) parts.push(`ran "${w.command}"`)
      const line = parts.join(', ') || 'workspace'
      return `${line[0].toUpperCase()}${line.slice(1)}`
    }
    case 'SELECT': {
      const ids = (act.clipIds ?? act.ids) as string[] | undefined
      if (Array.isArray(ids)) return ids.length === 1 ? `Selected ${c(ids[0])}` : `Selected ${ids.length} clips`
      return `Selected ${String(act.what ?? act.mode ?? 'clips')}`
    }
    case 'UPDATE_CLIP': {
      const p = (act.patch ?? {}) as Record<string, unknown>
      if ('startBeat' in p) return `Moved ${c(act.clipId)} to ${bar(p.startBeat, bpb)}`
      if ('durationBeats' in p) return `Resized ${c(act.clipId)}`
      if ('name' in p) return `Renamed ${c(act.clipId)} to "${String(p.name)}"`
      if ('color' in p) return `Recoloured ${c(act.clipId)}`
      if ('fadeIn' in p || 'fadeOut' in p) return `${'fadeIn' in p ? 'Faded in' : 'Faded out'} ${c(act.clipId)}`
      if ('gain' in p) return `${c(act.clipId)}: level ${pct(p.gain)}`
      if ('reverse' in p) return `${p.reverse ? 'Reversed' : 'Un-reversed'} ${c(act.clipId)}`
      if ('loopEnabled' in p) return `${p.loopEnabled ? 'Looped' : 'Stopped looping'} ${c(act.clipId)}`
      if ('fxMotion' in p || 'rollFx' in p || 'fxGraphs' in p) return `Changed the sound of ${c(act.clipId)}`
      return `Changed ${c(act.clipId)} (${Object.keys(p).join(', ')})`
    }
    case 'ADD_MIDI_NOTE': return `Added a note on ${c(act.clipId)}`
    case 'REMOVE_MIDI_NOTE': return `Removed a note on ${c(act.clipId)}`
    case 'UPDATE_MIDI_NOTE': return `Edited a note on ${c(act.clipId)}`
    case 'ADD_EFFECT': return `Added ${String((act.effect as { type?: string } | undefined)?.type ?? 'an effect')} to ${t(act.trackId)}`
    case 'REMOVE_EFFECT': return `Removed an effect from ${t(act.trackId)}`
    case 'UPDATE_EFFECT': {
      const p = (act.patch ?? act.params ?? {}) as Record<string, unknown>
      const keys = Object.keys(p)
      const shown = keys.slice(0, 3).map(k => `${k} ${typeof p[k] === 'number' && (p[k] as number) <= 1 && (p[k] as number) >= 0 ? pct(p[k]) : String(p[k])}`)
      return `${t(act.trackId)}: effect ${shown.join(', ') || 'changed'}`
    }
    case 'ADD_CLIP_EFFECT': return `Added an effect bar on ${t((act.effect as { trackId?: string } | undefined)?.trackId)}`
    case 'REMOVE_CLIP_EFFECT': return 'Removed an effect bar'
    case 'UPDATE_CLIP_EFFECT': return 'Changed an effect bar'
    case 'ADD_AUTOMATION_LANE': {
      const lane = act.lane as { label?: string; trackId?: string } | undefined
      return `Opened a ${lane?.label ?? 'parameter'} automation lane on ${t(lane?.trackId)}`
    }
    case 'ADD_AUTOMATION_POINT': {
      const p = act.point as { beat?: number; value?: number } | undefined
      return `Set an automation point at ${bar(p?.beat, bpb)} (${pct(p?.value)})`
    }
    case 'UPDATE_AUTOMATION_POINT': return 'Moved an automation point'
    case 'REMOVE_AUTOMATION_POINT': return 'Removed an automation point'
    case 'REMOVE_AUTOMATION_LANE': return 'Removed an automation lane'
    case 'SET_TEMPO': return `Tempo set to ${String(act.tempo)} bpm`
    case 'ADD_TEMPO_MARKER': { const m = act.marker as { beat?: number; tempo?: number } | undefined; return `Tempo ${m?.tempo} bpm from ${bar(m?.beat, bpb)}` }
    case 'UPDATE_TEMPO_MARKER': return `Tempo marker set to ${String(act.tempo)} bpm`
    case 'SET_TIME_SIG': return `Time signature ${String(act.num)}/${String(act.den)}`
    case 'SET_SWING': return `Swing ${pct(act.swing)}`
    case 'SET_LOOP': return `Loop set from ${bar(act.start, bpb)} to ${bar(act.end, bpb)}`
    case 'SET_LOOP_ENABLED': return act.enabled ? 'Looping on' : 'Looping off'
    case 'SET_MASTER_VOLUME': return `Master volume ${pct(act.volume)}`
    case 'SET_KEY_SCALE': return `Key set to ${String(act.key ?? '')} ${String(act.scale ?? '')}`.trim()
    case 'ADD_MARKER': return `Added a marker "${String((act.marker as { name?: string } | undefined)?.name ?? '')}"`
    case 'REMOVE_MARKER': return 'Removed a marker'
    case 'LOAD_PROJECT': return 'Loaded a project'
    default: {
      const type = String(act.type ?? 'something')
      return type.toLowerCase().replace(/_/g, ' ').replace(/^\w/, ch => ch.toUpperCase())
    }
  }
}
