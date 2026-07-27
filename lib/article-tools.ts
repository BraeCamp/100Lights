// The registry of standalone /tools that can be embedded in Learn articles via
// `@tool(<id>) caption`. This is the SINGLE SOURCE OF TRUTH for tool embeds:
//
//  - `load` imports the exact same `@/components/tools/*` module the /tools route
//    uses, so editing a tool updates the route AND every article embed at once.
//  - Add a tool here and `@tool(<id>)` works in any article immediately.
//  - `blurb` is what an author (human or AI) reads when choosing a tool to add.
//
// See CONTEXT.md ("Learn articles: interactive widgets & audio") for the full
// catalog of embeddable pieces (these tools + the @-widgets).

import type { ComponentType } from 'react'

export interface ArticleToolDef {
  id: string
  label: string
  emoji: string
  blurb: string
  needsMic?: boolean     // gated behind a Start button, but prompts for the mic
  wide?: boolean         // wider than the article column — scroll horizontally
  load: () => Promise<{ default: ComponentType<Record<string, unknown>> }>
}

// Loose-typed loader so tools with different optional props share one registry.
const L = (fn: () => Promise<{ default: ComponentType<never> }>) =>
  fn as unknown as () => Promise<{ default: ComponentType<Record<string, unknown>> }>

export const ARTICLE_TOOLS: ArticleToolDef[] = [
  { id: 'metronome',       label: 'Metronome',            emoji: '🥁', blurb: 'Tap or set a tempo and play a click — for tempo/timing articles.',           load: L(() => import('@/components/tools/Metronome')) },
  { id: 'circle-of-fifths',label: 'Circle of Fifths',     emoji: '🎡', blurb: 'Interactive circle of fifths — keys, relative minors, key signatures.',      load: L(() => import('@/components/tools/CircleOfFifths')) },
  { id: 'chords',          label: 'Chord explorer',       emoji: '🎹', blurb: 'Build progressions, hear chords, identify them — theory/chord articles.',    load: L(() => import('@/components/tools/ChordTeacher')) },
  { id: 'chord-identifier',label: 'Chord identifier',     emoji: '🔎', blurb: 'Click notes on a piano and name the chord — for chord-spelling articles.',    load: L(() => import('@/components/tools/ChordIdentifier')) },
  { id: 'fretboard',       label: 'Scale fretboard',      emoji: '🎸', blurb: 'Guitar fretboard with scales lit up — for scale/guitar articles.',           wide: true, load: L(() => import('@/components/tools/Fretboard')) },
  { id: 'delay-calculator',label: 'Delay calculator',     emoji: '⏱', blurb: 'BPM → note-value delay/reverb times in ms — for mixing/FX articles.',        load: L(() => import('@/components/tools/DelayCalculator')) },
  { id: 'tuner',           label: 'Tuner',                emoji: '🎯', blurb: 'Mic-based instrument tuner — for tuning/recording articles.',                 needsMic: true, load: L(() => import('@/components/tools/StandaloneTuner')) },
  { id: 'vocal-range',     label: 'Vocal range finder',   emoji: '🎤', blurb: 'Sing to find your range — for vocal/recording articles.',                    needsMic: true, load: L(() => import('@/components/tools/VocalRange')) },
]

export const toolById = (id: string): ArticleToolDef | undefined => ARTICLE_TOOLS.find(t => t.id === id)
