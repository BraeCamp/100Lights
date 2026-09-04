// Naming one track, or many, out loud.
//
// "all the drum tracks", "every muted track", "the tracks with reverb", "the
// soloed tracks", "the empty tracks", "the audio tracks", "every track except
// the drums". A set of tracks is what a mixer command acts on when it says
// any of these, and until now every mixer command resolved a name to ONE
// track and the rest of the sentence was lost.

import type { DawProject, DawTrack } from './daw-types'
import { foldName } from './voice/resolve'

export type TrackKind = 'audio' | 'midi' | 'drums' | 'apollo' | 'synth' | 'sampler' | 'plugin' | 'empty' | 'group'
export type TrackState = 'muted' | 'unmuted' | 'soloed' | 'unsoloed'

export interface TrackAddress {
  /** A word every track's name must contain — "the bass tracks". */
  name?: string
  /** Every track (before `only`/`except` narrow it). */
  all?: boolean
  /** Only tracks that are all of these. */
  only?: (TrackKind | TrackState)[]
  /** Only tracks carrying this effect (by type or name) — "the tracks with reverb". */
  withEffect?: string
  /** Leave these out — "every track except the drums". */
  except?: string[]
  /** Exactly these — the selection. */
  ids?: string[]
}

/** Words that name a kind or a state of track. */
export const TRACK_WORDS: Record<string, TrackKind | TrackState> = {
  drum: 'drums', drums: 'drums', percussion: 'drums', kit: 'drums', kits: 'drums',
  audio: 'audio', recorded: 'audio', midi: 'midi',
  synth: 'synth', synths: 'synth', synthesizer: 'synth', apollo: 'apollo',
  sampler: 'sampler', samplers: 'sampler', sampled: 'sampler',
  plugin: 'plugin', plugins: 'plugin',
  empty: 'empty', blank: 'empty', unused: 'empty',
  group: 'group', groups: 'group', bus: 'group', buses: 'group',
  muted: 'muted', silent: 'muted', unmuted: 'unmuted',
  soloed: 'soloed', solo: 'soloed', unsoloed: 'unsoloed',
}

function kindsOf(project: DawProject, t: DawTrack): Set<TrackKind | TrackState> {
  const out = new Set<TrackKind | TrackState>()
  const clips = (project.arrangementClips ?? []).filter(c => c.trackId === t.id)
  const type = String(t.instrument?.type ?? '')
  const name = foldName(t.name ?? '')
  if (t.kind === 'group') out.add('group')
  if (!clips.length) out.add('empty')
  if (type === 'drum' || /\b(?:drum|drums|percussion|kit|kick|snare|hats?)\b/.test(name)) out.add('drums')
  if (type === 'apollo') { out.add('apollo'); out.add('synth') }
  if (type === 'poly' || type === 'wavetable' || type === 'helios' || type === 'synth') out.add('synth')
  if (type === 'sampler' || type === 'multisample' || type === 'sample') out.add('sampler')
  if (type === 'plugin') out.add('plugin')
  const audioClips = clips.filter(c => c.kind === 'audio').length
  const midiClips = clips.filter(c => c.kind === 'midi').length
  // The track's own kind first; failing that, a track with no instrument and
  // no MIDI on it. A drum kit with an audio loop on it is still the drum track.
  const trackType = String((t as { type?: string }).type ?? '')
  if (trackType === 'audio' || type === 'audio' || (!trackType && !type && !midiClips)) out.add('audio')
  else if (trackType === 'midi' || midiClips || (type && type !== 'audio' && !audioClips)) out.add('midi')
  if (t.mute) out.add('muted'); else out.add('unmuted')
  if (t.solo) out.add('soloed'); else out.add('unsoloed')
  return out
}

function hasEffect(t: DawTrack, want: string): boolean {
  const w = foldName(want)
  if (!w) return false
  const effects = [...(t.effects ?? []), ...((t as { midiEffects?: { type?: string; name?: string }[] }).midiEffects ?? [])]
  return effects.some(e => {
    const type = foldName(String((e as { type?: string }).type ?? ''))
    const name = foldName(String((e as { name?: string }).name ?? ''))
    return type === w || type.includes(w) || w.includes(type) && type.length >= 4 || (name && name.includes(w))
  })
}

/** The tracks an address names. Empty when it names nothing. */
export function addressTracks(project: DawProject, addr: TrackAddress): DawTrack[] {
  let pool = [...(project.tracks ?? [])]
  if (addr.ids) { const ids = new Set(addr.ids); pool = pool.filter(t => ids.has(t.id)) }
  const want = foldName(addr.name ?? '')
  if (want) {
    const words = want.split(' ').filter(Boolean)
    pool = pool.filter(t => { const n = foldName(t.name ?? ''); return n.includes(want) || words.every(w => n.includes(w)) })
  }
  if (addr.only?.length) pool = pool.filter(t => { const k = kindsOf(project, t); return addr.only!.every(o => k.has(o)) })
  if (addr.withEffect) pool = pool.filter(t => hasEffect(t, addr.withEffect!))
  if (addr.except?.length) {
    const spared = new Set<string>()
    for (const said of addr.except) {
      const s = foldName(said)
      const kind = TRACK_WORDS[s.replace(/s$/, '')] ?? TRACK_WORDS[s]
      for (const t of pool) {
        const n = foldName(t.name ?? '')
        if (n === s || n.includes(s) || (kind && kindsOf(project, t).has(kind))) spared.add(t.id)
      }
    }
    pool = pool.filter(t => !spared.has(t.id))
  }
  return pool
}

/**
 * Read a spoken track set. Null when the words name one track, or none —
 * "mute the drums" stays the one-track command it always was.
 *
 *   "all the drum tracks"            → only [drums]
 *   "every muted track"              → only [muted]
 *   "the tracks with reverb"         → withEffect reverb
 *   "the soloed tracks"              → only [soloed]
 *   "the bass tracks"                → name bass
 *   "every track except the drums"   → all, except [drums]
 *   "all the tracks" / "every track" → all
 */
export function parseTrackAddress(spoken: string): TrackAddress | null {
  let s = String(spoken ?? '').toLowerCase().replace(/[.,!?]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  const out: TrackAddress = {}
  const exceptM = /\b(?:except|excluding|apart from|but not|other than|besides)\s+(?:for\s+)?(?:the\s+)?(.+)$/.exec(s)
  if (exceptM) {
    out.except = exceptM[1].split(/\s*(?:,|\band\b)\s*/).map(x => x.replace(/^the\s+/, '').replace(/\s+tracks?$/, '').trim()).filter(Boolean)
    s = s.slice(0, exceptM.index).trim()
  }
  const withM = /\btracks?\s+(?:with|that have|that has|which have|carrying|using|running)\s+(?:a\s+|an\s+|the\s+|some\s+)?(.+)$/.exec(s)
  if (withM) { out.withEffect = withM[1].replace(/\s+on (?:it|them)$/, '').trim(); s = s.slice(0, withM.index).trim() + ' tracks' }
  const all = /^(?:all|every|each|all of|all the|every one of the|every single)\b/.test(s) || /^(?:everything|every track|all tracks)$/.test(s)
  const plural = /\btracks\b/.test(s) || /^(?:every|each)\b/.test(s)
  const body = s
    .replace(/^(?:all|every|each|all of|all the|every one of the|every single)\s+(?:the\s+|of the\s+)?/, '')
    .replace(/^the\s+/, '')
    .replace(/\s*\btracks?\b\s*$/, '')
    .trim()
  if (!plural && !all && !out.withEffect && !out.except) return null
  const only: (TrackKind | TrackState)[] = []
  const nameWords: string[] = []
  for (const word of body.split(' ').filter(Boolean)) {
    const k = TRACK_WORDS[word]
    if (k) only.push(k)
    else if (!['other', 'remaining', 'rest', 'of', 'these', 'those', 'everything', 'all', 'every', 'each', 'the', 'tracks', 'track', 'ones'].includes(word)) nameWords.push(word)
  }
  if (only.length) out.only = only
  if (nameWords.length) out.name = nameWords.join(' ')
  if (all || (!only.length && !nameWords.length)) out.all = true
  if (!out.only && !out.name && !out.withEffect && !out.except && !plural && !all) return null
  return out
}

/** "3 tracks: Drums, Bass and Pad" */
export function describeTracks(tracks: DawTrack[]): string {
  const names = tracks.map(t => `"${t.name}"`)
  if (names.length <= 1) return names[0] ?? 'no tracks'
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}
