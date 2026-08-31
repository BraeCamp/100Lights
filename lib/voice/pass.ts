// One take, spoken: what you said, when you said it, and what it becomes.
//
// Brae: "The user can do one drum bit at a time, but they need to say the name
// of the type of drum/symbol in the sequencer to the beat. For example, they'd
// say 'kick clap kick kick crash'."
//
// This is the assembly point. Three things arrive separately and none of them
// is useful alone:
//
//   the WORDS      from the transcriber — which drum, which chord
//   the SPIKES     from the audio       — when, precisely
//   the CLICK      from the transport   — where beat one is
//
// ⚠️ The click is the part that is easy to leave out and impossible to add
// afterwards. Without an origin the first thing you say becomes beat one, so a
// take that starts a beat late is silently pulled forward and lines up with
// nothing. With the count-in's own end as the origin, coming in late stays
// late, which is what makes recording against a metronome mean anything.

import { STEP_BEATS, STEPS_PER_BAR, DRUM_LANES } from '@/lib/drum-presets'
import { drumForWord, chordAt } from './vocab'
import { alignToOnsets, type Onset } from './onsets'
import type { LaneKey } from './beatbox'
import type { MidiNote } from '@/lib/daw-types'

export interface TakeWord { word: string; s?: number; e?: number }

export interface TakeOptions {
  bpm: number
  /** When the grid starts, in the recording's own seconds. The end of the
   *  count-in — not the first thing said. */
  originSec?: number
  /** Cap, so a rambling take does not become forty bars. */
  maxBars?: number
  /** Only this lane, for building a kit one drum at a time. */
  onlyLane?: LaneKey
  /** Where middle C sits for spoken chords. */
  octave?: number
}

export interface TakeHit {
  step: number
  velocity: number
  word: string
  /** Set for a drum take. */
  lane?: LaneKey
  /** Set for a chord take. */
  pitches?: number[]
  label: string
  /** Did this hit's timing come from the audio, or only from the transcript? */
  timing: 'onset' | 'word'
}

export interface Take {
  hits: TakeHit[]
  bars: number
  steps: number
  ignored: string[]
  /** True when at least one hit was placed by a real audio spike. */
  fromAudio: boolean
}

const pitchOf = new Map(DRUM_LANES.map(l => [l.key, l.pitch]))
const labelOf = new Map(DRUM_LANES.map(l => [l.key, l.label]))

/** Velocity from how hard the syllable was said, with the accent on downbeats. */
function velocityFor(step: number, strength: number | undefined): number {
  // A spoken take has real dynamics in it and throwing them away makes every
  // pattern sound typed. Narrow range: speech is not drumming, and mapping it
  // wide turns ordinary variation into a broken-sounding part.
  const base = strength == null ? 96 : Math.round(78 + strength * 38)
  return Math.max(40, Math.min(127, base + (step % 4 === 0 ? 8 : 0)))
}

/**
 * A spoken drum take.
 *
 * Every word is a drum, and words that are not drums are reported rather than
 * dropped silently — "kick clap um kick" should not quietly become three hits
 * with no explanation of where the fourth went.
 */
export function drumTake(words: TakeWord[], onsets: Onset[], opts: TakeOptions): Take {
  const aligned = alignToOnsets(words, onsets)
  const bpm = opts.bpm > 0 ? opts.bpm : 120
  const origin = opts.originSec ?? aligned.find(w => typeof w.s === 'number')?.s ?? 0

  const raw: TakeHit[] = []
  const ignored: string[] = []
  for (const w of aligned) {
    const lane = drumForWord(w.word)
    if (!lane) { ignored.push(w.word); continue }
    if (opts.onlyLane && lane !== opts.onlyLane) { ignored.push(w.word); continue }
    if (typeof w.s !== 'number') { ignored.push(w.word); continue }
    const step = Math.round(((w.s - origin) * bpm / 60) / STEP_BEATS)
    if (step < 0) continue         // said before the count-in ended
    raw.push({
      step, lane, word: w.word, label: labelOf.get(lane) ?? lane,
      velocity: velocityFor(step, w.strength), timing: w.from,
    })
  }
  return assemble(raw, ignored, opts)
}

/**
 * A spoken chord take.
 *
 * Chord names are several words and a beat is one moment, so a chord keeps the
 * time of its FIRST word — the moment you started saying it. This is the reason
 * shorthand matters here more than it does for drums: "four" can land on a
 * beat, "E flat minor seven" cannot.
 */
export function chordTake(words: TakeWord[], onsets: Onset[], opts: TakeOptions): Take {
  const aligned = alignToOnsets(words, onsets)
  const bpm = opts.bpm > 0 ? opts.bpm : 120
  const origin = opts.originSec ?? aligned.find(w => typeof w.s === 'number')?.s ?? 0
  const plain = aligned.map(w => w.word)

  const raw: TakeHit[] = []
  const ignored: string[] = []
  let i = 0
  while (i < aligned.length) {
    const chord = chordAt(plain, i, opts.octave ?? 4)
    if (!chord) { ignored.push(aligned[i].word); i++; continue }
    const head = aligned[i]
    if (typeof head.s !== 'number') { ignored.push(head.word); i += chord.used; continue }
    const step = Math.round(((head.s - origin) * bpm / 60) / STEP_BEATS)
    if (step >= 0) {
      raw.push({
        step, pitches: chord.pitches, word: plain.slice(i, i + chord.used).join(' '),
        label: chord.name, velocity: velocityFor(step, head.strength), timing: head.from,
      })
    }
    i += chord.used
  }
  return assemble(raw, ignored, opts)
}

function assemble(raw: TakeHit[], ignored: string[], opts: TakeOptions): Take {
  if (!raw.length) return { hits: [], bars: 1, steps: STEPS_PER_BAR, ignored, fromAudio: false }
  const last = Math.max(...raw.map(h => h.step))
  const bars = Math.min(opts.maxBars ?? 8, Math.max(1, Math.ceil((last + 1) / STEPS_PER_BAR)))
  const steps = bars * STEPS_PER_BAR

  const seen = new Set<string>()
  const hits: TakeHit[] = []
  for (const h of raw) {
    if (h.step >= steps) continue
    // One drum cannot be hit twice at the same instant, and two chord names on
    // one step is somebody correcting themselves — the first is what they
    // played to the click.
    const key = `${h.lane ?? 'chord'}:${h.step}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(h)
  }
  hits.sort((a, b) => a.step - b.step)
  return { hits, bars, steps, ignored, fromAudio: hits.some(h => h.timing === 'onset') }
}

/** The take as notes. Chords become one note per pitch, all starting together. */
export function takeToNotes(take: Take, newId: () => string, holdBeats = STEP_BEATS): MidiNote[] {
  const out: MidiNote[] = []
  for (const h of take.hits) {
    const startBeat = h.step * STEP_BEATS
    if (h.pitches) {
      for (const pitch of h.pitches) {
        out.push({ id: newId(), pitch, startBeat, durationBeats: holdBeats, velocity: h.velocity })
      }
    } else if (h.lane) {
      out.push({
        id: newId(), pitch: pitchOf.get(h.lane) ?? 36,
        startBeat, durationBeats: STEP_BEATS, velocity: h.velocity,
      })
    }
  }
  return out
}

/** "kick, clap, kick, kick, crash" — what it heard, in order. */
export function describeTake(take: Take): string {
  if (!take.hits.length) return 'nothing I could place'
  return take.hits.map(h => h.label.toLowerCase()).join(', ')
}
