// Apollo's own dials, by the names people say out loud.
//
// Apollo has 166 registered parameters. Writing a voice command for each one is
// not a plan — it is 166 chances to disagree with the synth, and the registry
// already holds the truth about every one of them: its path, its range, whether
// it is log or linear, what unit it is in. `PARAMS` is that registry, and the
// mod matrix and the UI both read it. So voice reads it too.
//
// What this module adds is the only part the registry cannot hold: what a person
// says. Nobody says "Osc A WT Pos". They say "the wavetable position on
// oscillator one", or just "the wave position", and mean the same dial.
//
// ⚠️ The registry is the MODULATION-DESTINATION list, not every field in the
// patch. Things nobody can modulate at audio rate — which filter model is
// loaded, for one — are real controls that are simply not in it. Those are
// listed separately below rather than pretended into PARAMS, because adding
// them there would offer the mod matrix destinations the engine cannot smooth.

import {
  PARAMS, PARAM_MAP, FILTER_TYPES, resolvePatchPath, getByPath, setByPath,
  type ParamDef, type ApolloPatch, type FilterType,
} from '@/lib/apollo/patch'

// ── Hz ⇄ the 0..1 the filter actually stores ───────────────────────────────
//
// ⚠️ Apollo's cutoff is normalised, not Hertz — `cutoffHz(n) = 8 * 2500^n` in
// engine.js. Somebody saying "cutoff to 800 hertz" and getting 800 clamped into
// a 0..1 field would open the filter all the way: the loudest possible wrong
// answer to a request to close it. These two functions are that mapping,
// mirrored, and they are why a spoken frequency lands where it was aimed.
export const cutoffHz = (norm: number): number => 8 * Math.pow(2500, Math.min(1, Math.max(0, norm)))
export const cutoffNorm = (hz: number): number =>
  Math.min(1, Math.max(0, Math.log(Math.max(8, hz) / 8) / Math.log(2500)))

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ── Percent across a parameter's own range ─────────────────────────────────
//
// "Halfway" has to mean halfway to the EAR, not halfway along the number line.
// Grain density runs 0.5 to 200 and is logarithmic; halfway linearly is 100
// grains a second, which is nearly the top of what anyone hears as a change.
export function fromPercent(def: ParamDef, pct: number): number {
  const p = clamp(pct, 0, 100) / 100
  if (def.curve === 'log' && def.min > 0) return def.min * Math.pow(def.max / def.min, p)
  // A log parameter that starts at zero has no ratio to work with — envelope
  // attack is the common case. A cubic gets the same feel: most of the travel
  // in the short times, where the ear is.
  if (def.curve === 'log') return def.min + (def.max - def.min) * Math.pow(p, 3)
  return def.min + (def.max - def.min) * p
}

export function toPercent(def: ParamDef, value: number): number {
  const v = clamp(value, def.min, def.max)
  if (def.curve === 'log' && def.min > 0) return 100 * Math.log(v / def.min) / Math.log(def.max / def.min)
  if (def.curve === 'log') return 100 * Math.cbrt((v - def.min) / (def.max - def.min))
  return 100 * (v - def.min) / (def.max - def.min)
}

// ── What each dial is called out loud ──────────────────────────────────────
//
// Keyed by the tail of the registry label, so a parameter added to PARAMS is
// reachable by nickname the moment it is named here — and if it is not named
// here it is still reachable by its literal label, just not by nickname.
//
// `needsModule` marks the dials that exist in more than one place. "Level"
// belongs to three oscillators, the sub and the noise; guessing which one is
// worse than asking, because five things called level all sound different and
// only one of them is the one that was meant.
interface DialSpec { aliases: string[]; needsModule?: boolean; defaultModule?: string }

const DIALS: Record<string, DialSpec> = {
  level: { aliases: ['level', 'volume', 'loudness'], needsModule: true },
  pan: { aliases: ['pan', 'panning'], needsModule: true },
  fine: { aliases: ['fine', 'fine tune', 'fine tuning', 'cents'], defaultModule: 'osc1' },
  semi: { aliases: ['semi', 'semitones', 'coarse'], defaultModule: 'osc1' },
  detune: { aliases: ['detune', 'detuning'], defaultModule: 'osc1' },
  blend: { aliases: ['blend'], defaultModule: 'osc1' },
  width: { aliases: ['width', 'unison width'], defaultModule: 'osc1' },
  phase: { aliases: ['phase', 'start phase'], defaultModule: 'osc1' },
  'wt pos': { aliases: ['wavetable position', 'wave position', 'table position', 'wavetable pos', 'wt pos'], defaultModule: 'osc1' },
  'scan start': { aliases: ['scan start'], defaultModule: 'osc1' },
  'scan end': { aliases: ['scan end'], defaultModule: 'osc1' },
  'scan rate': { aliases: ['scan rate', 'scan speed'], defaultModule: 'osc1' },
  'warp 1': { aliases: ['warp', 'warp 1'], defaultModule: 'osc1' },
  'warp 2': { aliases: ['warp 2', 'second warp'], defaultModule: 'osc1' },
  'spectral warp': { aliases: ['spectral warp', 'harmonic warp'], defaultModule: 'osc1' },
  'smp rate': { aliases: ['sample rate', 'sample speed', 'playback rate', 'playback speed'], defaultModule: 'osc1' },
  'smp start': { aliases: ['sample start'], defaultModule: 'osc1' },
  'smp warp 1': { aliases: ['sample warp'], defaultModule: 'osc1' },
  'smp warp 2': { aliases: ['sample warp 2'], defaultModule: 'osc1' },
  'loop start': { aliases: ['loop start'], defaultModule: 'osc1' },
  'loop end': { aliases: ['loop end'], defaultModule: 'osc1' },
  'grain density': { aliases: ['grain density', 'density', 'grains per second'], defaultModule: 'osc1' },
  'grain length': { aliases: ['grain length', 'grain size'], defaultModule: 'osc1' },
  'grain scan': { aliases: ['grain scan'], defaultModule: 'osc1' },
  'grain pos': { aliases: ['grain position', 'grain pos', 'playhead'], defaultModule: 'osc1' },
  spray: { aliases: ['spray'], defaultModule: 'osc1' },
  'pitch rand': { aliases: ['pitch randomness', 'pitch random', 'pitch rand'], defaultModule: 'osc1' },
  'pan rand': { aliases: ['pan randomness', 'pan random', 'pan rand'], defaultModule: 'osc1' },
  window: { aliases: ['window', 'window shape'], defaultModule: 'osc1' },
  'spec speed': { aliases: ['spectral speed'], defaultModule: 'osc1' },
  'spec pos': { aliases: ['spectral position', 'spectral pos'], defaultModule: 'osc1' },
  smear: { aliases: ['smear', 'spectral smear'], defaultModule: 'osc1' },
  'spec shift': { aliases: ['spectral shift', 'bin shift'], defaultModule: 'osc1' },
  'spec pitch': { aliases: ['spectral pitch'], defaultModule: 'osc1' },
  formant: { aliases: ['formant'], defaultModule: 'osc1' },
  spread: { aliases: ['spread', 'harmonic spread'], defaultModule: 'osc1' },
  'spec gate': { aliases: ['spectral gate'], defaultModule: 'osc1' },
  // The filter, where most sentences land. Filter 1 is "the filter" — saying
  // which one it moved is what keeps that default honest.
  cutoff: { aliases: ['cutoff', 'cut off'], defaultModule: 'f1' },
  res: { aliases: ['resonance', 'res'], defaultModule: 'f1' },
  drive: { aliases: ['drive', 'filter drive'], defaultModule: 'f1' },
  'fat/morph': { aliases: ['fat', 'morph', 'vowel'], defaultModule: 'f1' },
  mix: { aliases: ['filter mix', 'wet dry'], defaultModule: 'f1' },
  // Envelope 1 is the amp envelope. attack/decay/sustain/release with no number
  // is that one, every time.
  attack: { aliases: ['attack'], defaultModule: 'env1' },
  decay: { aliases: ['decay'], defaultModule: 'env1' },
  sustain: { aliases: ['sustain'], defaultModule: 'env1' },
  release: { aliases: ['release', 'tail'], defaultModule: 'env1' },
  rate: { aliases: ['rate'], needsModule: true },
  master: { aliases: ['master', 'master gain', 'patch volume'], defaultModule: 'global' },
  glide: { aliases: ['glide', 'portamento'], defaultModule: 'global' },
  'bus 1 return': { aliases: ['bus 1 return'], defaultModule: 'global' },
  'bus 2 return': { aliases: ['bus 2 return'], defaultModule: 'global' },
  macro: { aliases: ['macro'], needsModule: true },
  pitch: { aliases: ['noise pitch'], defaultModule: 'noise' },
}

// ── One entry per registered parameter ─────────────────────────────────────
export interface SpokenParam {
  def: ParamDef
  /** 'osc1' | 'sub' | 'noise' | 'f1' | 'env2' | 'lfo3' | 'macro5' | 'global' */
  module: string
  /** Human module name for the read-back: "oscillator 1", "filter 2". */
  moduleLabel: string
  /** Key into DIALS. */
  dial: string
}

function parseLabel(def: ParamDef): SpokenParam {
  const l = def.label
  let m: RegExpMatchArray | null
  if ((m = l.match(/^Osc ([ABC]) (.+)$/))) {
    const n = 'ABC'.indexOf(m[1]) + 1
    return { def, module: `osc${n}`, moduleLabel: `oscillator ${n}`, dial: m[2].toLowerCase() }
  }
  if ((m = l.match(/^(Sub|Noise) (.+)$/))) {
    return { def, module: m[1].toLowerCase(), moduleLabel: m[1].toLowerCase(), dial: m[2].toLowerCase() }
  }
  if ((m = l.match(/^Filter ([12]) (.+)$/))) return { def, module: `f${m[1]}`, moduleLabel: `filter ${m[1]}`, dial: m[2].toLowerCase() }
  if ((m = l.match(/^Env ([1-4]) (.+)$/))) return { def, module: `env${m[1]}`, moduleLabel: `envelope ${m[1]}`, dial: m[2].toLowerCase() }
  if ((m = l.match(/^LFO (\d+) (.+)$/))) return { def, module: `lfo${m[1]}`, moduleLabel: `LFO ${m[1]}`, dial: m[2].toLowerCase() }
  if ((m = l.match(/^Macro ([1-8])$/))) return { def, module: `macro${m[1]}`, moduleLabel: `macro ${m[1]}`, dial: 'macro' }
  return { def, module: 'global', moduleLabel: 'Apollo', dial: l.toLowerCase() }
}

export const SPOKEN_PARAMS: SpokenParam[] = PARAMS.map(parseLabel)

/** Every dial name a person could say, longest first so "scan rate" beats "rate". */
const ALIAS_INDEX: { alias: string; dial: string }[] = Object.entries(DIALS)
  .flatMap(([dial, spec]) => spec.aliases.map(alias => ({ alias, dial })))
  .sort((a, b) => b.alias.length - a.alias.length)

const NUM_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  first: '1', second: '2', third: '3', fourth: '4',
  a: '1', b: '2', c: '3',
}

export function normalisePhrase(text: string): string {
  return ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
}

/**
 * Which module a sentence is talking about, if it says.
 *
 * ⚠️ "osc a" and "osc one" are the same oscillator — the panel prints letters
 * and the registry counts from one. Someone reading the screen and someone
 * counting out loud have to land in the same place.
 */
export function moduleHint(phrase: string): string | null {
  const p = normalisePhrase(phrase)
  const word = (re: RegExp): string | null => {
    const m = p.match(re)
    if (!m) return null
    const raw = (m[1] ?? '').trim()
    return NUM_WORDS[raw] ?? (/^\d+$/.test(raw) ? raw : null)
  }
  let n: string | null
  if ((n = word(/\b(?:osc|oscillator)\s*(\d+|one|two|three|first|second|third|a|b|c)\b/))) return `osc${n}`
  if ((n = word(/\b(?:filter|filt)\s*(\d+|one|two|first|second)\b/))) return `f${n}`
  if ((n = word(/\b(?:env|envelope)\s*(\d+|one|two|three|four|first|second|third|fourth)\b/))) return `env${n}`
  if ((n = word(/\blfo\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/))) return `lfo${n}`
  if ((n = word(/\bmacro\s*(\d+|one|two|three|four|five|six|seven|eight)\b/))) return `macro${n}`
  if (/\bsub\b/.test(p)) return 'sub'
  if (/\bnoise\b/.test(p)) return 'noise'
  // A bare "the filter" or "the envelope" means the first one, which is the one
  // the panel opens on and the one people mean.
  if (/\bfilter\b/.test(p)) return 'f1'
  if (/\benvelope\b/.test(p)) return 'env1'
  if (/\blfo\b/.test(p)) return 'lfo1'
  if (/\bosc|oscillator\b/.test(p)) return 'osc1'
  return null
}

export type ParamMatch =
  | { ok: true; param: SpokenParam }
  | { ok: false; reason: 'unknown' }
  | { ok: false; reason: 'needs-module'; dial: string; options: string[] }

/**
 * A spoken phrase → one registered parameter.
 *
 * Refuses in two different ways on purpose. "I don't know that dial" and "which
 * one did you mean" are different problems and want different answers back.
 */
export function matchApolloParam(phrase: string): ParamMatch {
  const p = normalisePhrase(phrase)
  const hit = ALIAS_INDEX.find(a => p.includes(` ${a.alias} `))
  if (!hit) {
    // Last resort: the literal registry label, for anyone reading it off screen.
    const literal = SPOKEN_PARAMS.find(s => p.includes(` ${s.def.label.toLowerCase()} `))
    return literal ? { ok: true, param: literal } : { ok: false, reason: 'unknown' }
  }
  const spec = DIALS[hit.dial]
  const candidates = SPOKEN_PARAMS.filter(s => s.dial === hit.dial)
  if (!candidates.length) return { ok: false, reason: 'unknown' }

  const hinted = moduleHint(phrase)
  if (hinted) {
    const exact = candidates.find(s => s.module === hinted)
    if (exact) return { ok: true, param: exact }
  }
  if (spec.needsModule) {
    return { ok: false, reason: 'needs-module', dial: hit.dial, options: candidates.map(c => c.moduleLabel) }
  }
  const fallback = candidates.find(s => s.module === spec.defaultModule) ?? candidates[0]
  return { ok: true, param: fallback }
}

// ── Setting one ────────────────────────────────────────────────────────────

const fmtHz = (hz: number) => hz >= 1000 ? `${+(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`

/** How a value reads back — in the dial's own terms, never as a raw 0..1. */
export function describeValue(param: SpokenParam, v: number): string {
  const { def } = param
  if (def.path.endsWith('.cutoff')) return fmtHz(cutoffHz(v))
  if (def.unit) return `${+v.toFixed(def.unit === 's' ? 3 : 1)} ${def.unit}`
  if (def.min === 0 && def.max === 1) return `${Math.round(v * 100)}%`
  if (def.min === -1 && def.max === 1) return `${Math.round(v * 100)}%`
  return String(+v.toFixed(2))
}

/**
 * Work out the new value for a parameter, in the parameter's own terms.
 *
 * `direction` moves in PERCENT space rather than by a fixed number, so a step on
 * a logarithmic dial is a step the ear registers: "a bit more grain density"
 * moves by a ratio, the way the dial itself does.
 */
export function resolveValue(
  param: SpokenParam,
  current: number,
  opts: { value?: number | null; percent?: number | null; direction?: 'more' | 'less' | null },
): number | null {
  const { def } = param
  if (opts.percent != null && Number.isFinite(opts.percent)) return clamp(fromPercent(def, opts.percent), def.min, def.max)
  if (opts.value != null && Number.isFinite(opts.value)) {
    const v = opts.value
    // A cutoff said in Hertz. Anything above 30 cannot be the 0..1 the field
    // stores, and anything at or below it is a plausible percentage.
    if (def.path.endsWith('.cutoff')) return v > 30 ? cutoffNorm(v) : clamp(v / 100, 0, 1)
    // "Detune to 20" on a 0..1 dial is twenty percent — nobody says "point two".
    if (def.min === 0 && def.max === 1 && v > 1) return clamp(v / 100, 0, 1)
    return clamp(v, def.min, def.max)
  }
  if (opts.direction) {
    const step = opts.direction === 'more' ? 12 : -12
    return clamp(fromPercent(def, toPercent(def, current) + step), def.min, def.max)
  }
  return null
}

/** Read the parameter's current value out of a patch. */
export function readParam(patch: ApolloPatch, param: SpokenParam): number {
  const v = getByPath(patch, resolvePatchPath(param.def.path))
  return typeof v === 'number' ? v : param.def.default
}

/** Write it. Mutates — hand it a copy. */
export function writeParam(patch: ApolloPatch, param: SpokenParam, value: number): void {
  setByPath(patch, resolvePatchPath(param.def.path), value)
}

// ── The controls the registry does not carry ───────────────────────────────
//
// Filter MODEL is the biggest single change to a sound Apollo can make — a
// ladder and a comb at the same cutoff are not the same instrument — and it is
// a choice from a list, not a number, so it was never going to be in PARAMS.
const FILTER_ALIASES: { say: string[]; id: FilterType }[] = [
  { say: ['acid ladder', 'acid', '303'], id: 'acidLadder' },
  { say: ['ems ladder', 'ems', 'synthi'], id: 'emsLadder' },
  { say: ['ladder', 'moog'], id: 'ladder24' },
  { say: ['mg dirty', 'dirty'], id: 'mgDirty' },
  { say: ['german'], id: 'germanLP' },
  { say: ['french'], id: 'frenchLP' },
  { say: ['formant', 'vowel'], id: 'formant' },
  { say: ['comb'], id: 'combPlus' },
  { say: ['flange', 'flanger'], id: 'flangePlus' },
  { say: ['phaser'], id: 'phasePlus' },
  { say: ['ring mod', 'ring modulator'], id: 'ringMod' },
  { say: ['sample and hold', 'samp hold'], id: 'sampHold' },
  { say: ['downsample', 'downsampler'], id: 'downsample' },
  { say: ['reverb filter'], id: 'reverbFilter' },
  { say: ['dj'], id: 'dj' },
  { say: ['diffuser'], id: 'diffuser' },
  { say: ['morph svf', 'state variable'], id: 'morphSVF' },
  { say: ['notch'], id: 'notch12' },
  { say: ['peak'], id: 'peak12' },
  { say: ['band pass', 'bandpass'], id: 'bp12' },
  { say: ['high pass', 'highpass', 'hi pass'], id: 'hp12' },
  { say: ['low pass', 'lowpass', 'lo pass'], id: 'lp12' },
]

/**
 * A spoken filter name → a model Apollo has.
 *
 * Slope is honoured when it is said: "24 dB low pass" is a different filter
 * from "low pass", and someone who says the number means it.
 */
export function matchFilterType(phrase: string): { id: FilterType; label: string } | null {
  const p = normalisePhrase(phrase)
  const slope = p.match(/\b(6|12|18|24)\s*(?:db|pole)?\b/)?.[1]
  const hit = FILTER_ALIASES
    .flatMap(f => f.say.map(say => ({ say, id: f.id })))
    .sort((a, b) => b.say.length - a.say.length)
    .find(f => p.includes(` ${f.say} `))
  if (!hit) return null
  let id = hit.id
  if (slope) {
    const family = id.replace(/\d+$/, '')
    const withSlope = FILTER_TYPES.find(t => t.id === `${family}${slope}`)
    if (withSlope) id = withSlope.id
  }
  const def = FILTER_TYPES.find(t => t.id === id)
  return def ? { id: def.id, label: def.label } : null
}

/** Named so a caller can list what it could have said. */
export const FILTER_NAMES: string[] = FILTER_ALIASES.map(f => f.say[0])

/** Registry sanity: every dial name in DIALS belongs to a real parameter. */
export function unmatchedDials(): string[] {
  const known = new Set(SPOKEN_PARAMS.map(s => s.dial))
  return Object.keys(DIALS).filter(d => !known.has(d))
}

/** And the reverse: registry parameters no spoken name reaches. */
export function unspokenParams(): string[] {
  return SPOKEN_PARAMS.filter(s => !DIALS[s.dial]).map(s => s.def.label)
}

export { PARAM_MAP }
