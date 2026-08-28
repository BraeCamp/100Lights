import { PARAM_MAP, resolvePatchPath, type ApolloPatch } from '@/lib/apollo/patch'

/**
 * What Apollo is made of, as data.
 *
 * The board in Beacon renders this list as bars: a name, a row of knobs, a
 * toggle, an eye. Clicking a bar expands the module's real panel, which is a
 * lazy import and does not exist until then.
 *
 * This file is deliberately free of React and of any panel import, for two
 * reasons. It can be tested in plain Node against a real patch — every knob
 * path and every enable path is checked to exist, which is the difference
 * between a bar of live controls and a bar of dead ones. And it keeps the
 * heavy panels out of the module list itself, which is the whole point: the
 * measured cost of opening Apollo is ~2.9 seconds of mounting eleven panels,
 * nine canvases and 129 SVG nodes, and it is paid again on every open.
 *
 * A module is a PANEL, not an instance — Brae: "compressor is a module,
 * granulator is a module, envelopes is a module". So there is one Oscillators
 * bar, not three; the A/B/C switch lives inside the expanded panel.
 */

export type ModuleGroup = 'voice' | 'modulation' | 'effects' | 'performance'

export interface ApolloModuleDef {
  id: string
  /** Shown on the bar. Stays legible when the module is switched off. */
  name: string
  group: ModuleGroup
  /**
   * Knob param paths for the bar, most useful first.
   *
   * Every one must exist in PARAM_MAP — the Knob resolves range, default,
   * curve and label from there, so a path that does not exist renders a knob
   * that silently does nothing. There is a test for exactly that.
   *
   * The bar shows as many as fit and offers to expand for the rest, so this
   * list can be longer than a bar: Macros has eight and is the case that
   * proves the overflow works.
   */
  knobs: string[]
  /**
   * Shorter labels for knobs whose derived one will not fit.
   *
   * A knob is 30px wide and anything past about seven characters is clipped —
   * and clipped labels are worse than short ones, because "NOISE LE…" and
   * "NOISE PI…" are the same word to a reader glancing at a bar. Only needed
   * where the qualifier carries meaning and so cannot be stripped: Sub / Noise
   * has a Level and a Pan on each of two sources.
   */
  knobLabels?: Record<string, string>
  /**
   * The booleans that switch this module on.
   *
   * A list because a panel can own more than one: Sub / Noise has two
   * generators, Filters has two filters. The module reads as ON when ANY of
   * them is on, switching off clears them all, and switching on lights the
   * first — which is what someone means when they toggle a panel.
   *
   * Empty means the module cannot be switched off yet. Envelopes and LFOs are
   * the only two, because EnvConfig and LfoConfig are the only module configs
   * in the patch with no `enabled` field. Adding it is a schema change, an
   * engine change and a migration, so it is its own piece of work.
   */
  enablePaths: string[]
  /**
   * Does this module have a visual of its own behind the eye?
   *
   * True only where a dedicated view exists as a separate component that can
   * be lazily mounted — the oscillator's engine views, the clip roll. Modules
   * whose "visual" is a curve drawn inside their own panel (envelopes, LFOs,
   * the filter response) are false: their picture arrives when you expand
   * them, so a second way in would be two doors to one room.
   */
  hasVisual: boolean
  /** One line, for the module's tooltip and for a future plugin listing. */
  blurb: string
}

export const APOLLO_MODULES: ApolloModuleDef[] = [
  {
    id: 'osc',
    name: 'Oscillators',
    group: 'voice',
    knobs: ['osc0.level', 'osc0.pan', 'osc0.semi', 'osc0.fine', 'osc0.detune', 'osc0.wt.pos'],
    enablePaths: ['osc0.enabled'],
    hasVisual: true,
    blurb: 'Three oscillators across five engines — wavetable, sample, multisample, granular, spectral.',
  },
  {
    id: 'subnoise',
    name: 'Sub / Noise',
    group: 'voice',
    knobs: ['sub.level', 'sub.pan', 'noise.level', 'noise.pan', 'noise.pitch'],
    knobLabels: {
      'sub.level': 'SUB', 'sub.pan': 'S PAN',
      'noise.level': 'NOISE', 'noise.pan': 'N PAN', 'noise.pitch': 'N PITCH',
    },
    enablePaths: ['sub.enabled', 'noise.enabled'],
    hasVisual: false,
    blurb: 'A sub oscillator under the voice, and a noise source that can play any sample.',
  },
  {
    id: 'filters',
    name: 'Filters',
    group: 'voice',
    knobs: ['f1.cutoff', 'f1.res', 'f1.drive', 'f1.fat', 'f1.mix', 'f1.pan'],
    knobLabels: { 'f1.fat': 'FAT' },
    enablePaths: ['f1.enabled', 'f2.enabled'],
    hasVisual: false,
    blurb: 'Two filters per voice, serial or parallel, across thirty-one types.',
  },
  {
    id: 'env',
    name: 'Envelopes',
    group: 'modulation',
    knobs: ['env1.attack', 'env1.decay', 'env1.sustain', 'env1.release'],
    enablePaths: [],
    hasVisual: false,
    blurb: 'Four envelopes with curve control on every stage.',
  },
  {
    id: 'lfo',
    name: 'LFOs',
    group: 'modulation',
    knobs: ['lfo1.rate'],
    enablePaths: [],
    hasVisual: false,
    blurb: 'Ten drawable LFOs, including 2D paths and chaos sources.',
  },
  {
    id: 'macros',
    name: 'Macros',
    group: 'modulation',
    knobs: ['macro1', 'macro2', 'macro3', 'macro4', 'macro5', 'macro6', 'macro7', 'macro8'],
    enablePaths: [],
    hasVisual: false,
    blurb: 'Eight performance knobs you can route anywhere.',
  },
  {
    id: 'arp',
    name: 'Arp',
    group: 'performance',
    knobs: [],
    enablePaths: ['arp.on'],
    hasVisual: false,
    blurb: 'Arpeggiator with pattern mode, running on the engine clock.',
  },
  {
    id: 'clip',
    name: 'Clips',
    group: 'performance',
    knobs: [],
    enablePaths: [],
    hasVisual: true,
    blurb: 'A sequencer inside the instrument, for phrases that belong to the sound.',
  },
  {
    id: 'global',
    name: 'Global',
    group: 'performance',
    knobs: ['global.masterGain', 'global.glide'],
    enablePaths: [],
    hasVisual: false,
    blurb: 'Voice mode, glide, tuning, master level.',
  },
]

export const MODULE_BY_ID: Record<string, ApolloModuleDef> =
  Object.fromEntries(APOLLO_MODULES.map(m => [m.id, m]))

export const GROUP_LABEL: Record<ModuleGroup, string> = {
  voice: 'Voice',
  modulation: 'Modulation',
  effects: 'Effects',
  performance: 'Performance',
}

// ── Reading and writing a module's state ────────────────────────────────────

function readPath(patch: unknown, path: string): unknown {
  let cur: unknown = patch
  for (const part of resolvePatchPath(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function writePath(patch: unknown, path: string, value: unknown): void {
  const parts = resolvePatchPath(path).split('.')
  let cur: unknown = patch
  for (const part of parts.slice(0, -1)) {
    if (cur == null || typeof cur !== 'object') return
    cur = (cur as Record<string, unknown>)[part]
  }
  if (cur && typeof cur === 'object') (cur as Record<string, unknown>)[parts[parts.length - 1]] = value
}

/** On when ANY of its switches is on. A module with no switches is always on. */
export function moduleIsOn(patch: ApolloPatch, def: ApolloModuleDef): boolean {
  if (!def.enablePaths.length) return true
  return def.enablePaths.some(p => readPath(patch, p) === true)
}

/** Can this module be switched off at all? */
export function moduleCanToggle(def: ApolloModuleDef): boolean {
  return def.enablePaths.length > 0
}

/**
 * Switch a module on or off, in place on a draft patch.
 *
 * Off clears every switch; on lights only the FIRST. Lighting all of them
 * would turn on a noise source someone never asked for just because they
 * re-enabled Sub.
 */
export function setModuleOn(patch: ApolloPatch, def: ApolloModuleDef, on: boolean): void {
  if (!def.enablePaths.length) return
  if (!on) { for (const p of def.enablePaths) writePath(patch, p, false); return }
  writePath(patch, def.enablePaths[0], true)
}

/** The knob paths that actually exist. Anything else would render dead. */
export function liveKnobs(def: ApolloModuleDef): string[] {
  return def.knobs.filter(p => !!PARAM_MAP[p])
}

/**
 * A short label for a bar knob.
 *
 * PARAM_MAP labels are written for a full panel — "Osc A Level", "Filter 1
 * Res", "Env 1 Attack" — and at bar size the qualifier eats the word that
 * matters. The bar already says which module it is, so the prefix is noise
 * here; the first attempt kept the last two words and produced "A Pan" and
 * "1 Res", which is the qualifier and none of the meaning.
 *
 * So: drop leading words that only say WHICH instance this is, and keep the
 * rest. "Osc A Smp Rate" keeps "Smp Rate", because that is two words of
 * meaning rather than a qualifier and a word.
 */
const QUALIFIER = /^(osc|env|envelope|lfo|filter|macro|fx)$/i
const INSTANCE = /^([a-c]|\d+)$/i
export function shortLabel(path: string, def?: ApolloModuleDef): string {
  const override = def?.knobLabels?.[path]
  if (override) return override
  const full = PARAM_MAP[path]?.label ?? path
  const words = full.split(/\s+/)
  // Strip a qualifier only when an instance marker follows it — "Osc A",
  // "Filter 1", "Env 1". Stripping bare qualifiers turned "Sub Level" and
  // "Noise Level" into two knobs both labelled "Level" on the same bar, which
  // is worse than the long label it was fixing: on Sub / Noise the qualifier
  // IS the distinguishing word.
  let i = 0
  while (i + 1 < words.length && QUALIFIER.test(words[i]) && INSTANCE.test(words[i + 1] ?? '')) i += 2
  const rest = words.slice(i).join(' ')
  if (rest) return rest
  // Nothing but the qualifier and its number — "Macro 1". Under a bar already
  // headed "Macros", the number alone is the whole meaning.
  return words[i - 1] ?? full
}
