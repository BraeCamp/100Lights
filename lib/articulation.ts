// Instrument articulation — optional, tag-driven phrasing that makes sampled
// instruments sound played rather than typed. Two systems in v1:
//
//   • legato   — across a run of CONNECTED notes (touching / overlapping on the
//                roll) only the FIRST note gets its attack; the rest skip the
//                sample's onset and don't re-swell, so a bowed/breathed line
//                sounds like the bow keeps moving as the fingers change notes.
//   • slide    — between two connected notes at different pitches, glide the
//                pitch from the previous note into this one (guitar/fretless
//                slide, string portamento).
//
// Which options are OFFERED — and which are ON by default — depends on the
// instrument's tags (its preset `group` / `category` / name). "Unset" on a clip
// means "use the family default", so suitable instruments sound natural with no
// setup, while any clip can still override. Percussion, piano, plucked and other
// decaying instruments get nothing (there's no sustain to carry across notes).

export interface ArticOptions {
  legato: { available: boolean; default: boolean }
  /** defaultAmount / amount are 0–1; 0 = off. Mapped to seconds in resolveArtic. */
  slide: { available: boolean; defaultAmount: number }
}

/** Effective, ready-to-apply articulation for a clip. */
export interface ClipArtic {
  legato: boolean
  /** Portamento glide time in seconds (0 = no slide). */
  slideSec: number
}

/** Per-clip articulation overrides that live on the clip's rollFx bag. Both are
 *  optional; when absent the family default applies. 0 = off, 1 = on. */
export interface ArticFx {
  legato?: number // 0/1
  slide?: number // 0–1 amount (0 = off)
}

function tags(group?: string, category?: string, name = '') {
  const g = group ?? ''
  const c = (category ?? '').toLowerCase()
  const n = name.toLowerCase()
  const plucked = n.includes('harp') || n.includes('pizz') || c.includes('pizz')
  const bowed = c === 'violin' || c === 'viola' || c === 'cello' ||
    (g === 'Strings' && !plucked && !n.includes('pluck'))
  const wind = g === 'Woodwinds'
  const brass = g === 'Brass'
  const guitar = g === 'Guitar'
  const fretless = g === 'Bass' && n.includes('fretless')
  const organ = g === 'Organ'
  // Sustaining synths (pads / choirs / synth-strings) can carry a legato line too.
  const sustainedSynth = g === 'Synth' &&
    (n.includes('pad') || c.includes('pad') || c.includes('choir') || c.includes('string'))
  return { plucked, bowed, wind, brass, guitar, fretless, organ, sustainedSynth }
}

/** Which articulations this instrument offers, and their family defaults. */
export function articOptions(group?: string, category?: string, name?: string): ArticOptions {
  const t = tags(group, category, name)
  const legatoAvail = t.bowed || t.wind || t.brass || t.guitar || t.fretless || t.organ || t.sustainedSynth
  // Auto-on for bow / breath families — that's where a re-attack per note is the
  // giveaway that it was sequenced rather than performed.
  const legatoDefault = t.bowed || t.wind || t.brass
  const slideAvail = t.bowed || t.guitar || t.fretless
  const slideDefault = t.guitar ? 0.4 : t.fretless ? 0.5 : 0 // bowed: offered, off by default
  return {
    legato: { available: legatoAvail, default: legatoDefault },
    slide: { available: slideAvail, defaultAmount: slideDefault },
  }
}

/** True when the instrument offers at least one articulation (→ show the panel). */
export function hasArticulations(group?: string, category?: string, name?: string): boolean {
  const o = articOptions(group, category, name)
  return o.legato.available || o.slide.available
}

/** Resolve the effective articulation for a clip: clip override → family default,
 *  gated by what the instrument actually supports. */
export function resolveArtic(
  group: string | undefined,
  category: string | undefined,
  name: string | undefined,
  fx: ArticFx | undefined,
): ClipArtic {
  const o = articOptions(group, category, name)
  const legato = o.legato.available ? ((fx?.legato ?? (o.legato.default ? 1 : 0)) > 0.5) : false
  const amt = o.slide.available ? (fx?.slide ?? o.slide.defaultAmount) : 0
  const slideSec = amt > 0 ? 0.03 + Math.min(1, amt) * 0.12 : 0 // 30–150 ms
  return { legato, slideSec }
}

/** Two notes are "connected" (one phrase) when the next starts before the prior
 *  ends, or within this small gap after it (touching counts). Beats. */
export const ARTIC_GAP_BEATS = 0.08
/** How far into the sample a legato (non-first) note starts, skipping the
 *  recorded onset transient so it doesn't re-attack. Seconds. */
export const LEGATO_ONSET_SKIP = 0.022
