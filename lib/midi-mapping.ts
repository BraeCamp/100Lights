// ── MIDI Controller Mapping engine ───────────────────────────────────────────

export interface MidiMapping {
  id: string
  channel: number | 'any'   // MIDI channel (1–16) or 'any'
  cc: number                // CC number (0–127)
  target: MidiMappingTarget
  min: number               // parameter range min
  max: number               // parameter range max
  curve: 'linear' | 'log' | 'exp'
  label: string             // human-readable description
}

export type MidiMappingTarget =
  | { type: 'masterVolume' }
  | { type: 'bpm' }
  | { type: 'laneLevel';   laneType: string }
  | { type: 'lanePan';     laneType: string }
  | { type: 'laneReverb';  laneType: string }
  | { type: 'laneDelay';   laneType: string }
  | { type: 'fxParam';     laneType: string; effectId: string; paramKey: string }
  | { type: 'automPoint';  automLaneId: string }

export interface MidiMappingStore {
  mappings: MidiMapping[]
  learningTarget: MidiMappingTarget | null
}

/**
 * Apply a raw CC value (0–127) to a mapping, returning the scaled parameter value.
 *
 * Curve shapes:
 *   linear — straight interpolation
 *   log    — logarithmic (emphasises lower values; useful for volume)
 *   exp    — exponential (emphasises higher values; useful for filter cutoff)
 */
export function applyCCValue(rawCc: number, mapping: MidiMapping): number {
  const t = Math.max(0, Math.min(127, rawCc)) / 127  // normalise to 0–1

  let curved: number
  switch (mapping.curve) {
    case 'log':
      curved = t === 0 ? 0 : Math.log(1 + t * 9) / Math.log(10)
      break
    case 'exp':
      curved = t * t
      break
    default: // 'linear'
      curved = t
  }

  return mapping.min + curved * (mapping.max - mapping.min)
}

/** Serialise for project save — plain JSON-safe object. */
export function serializeMappings(store: MidiMappingStore): object {
  return {
    version: 1,
    mappings: store.mappings,
    // learningTarget is transient — never persist an in-progress learn
  }
}

/** Deserialise from project save data. Returns safe defaults on invalid input. */
export function deserializeMappings(data: unknown): MidiMappingStore {
  if (!data || typeof data !== 'object') return { mappings: [], learningTarget: null }
  const d = data as Record<string, unknown>
  return {
    mappings: Array.isArray(d.mappings) ? (d.mappings as MidiMapping[]) : [],
    learningTarget: null,
  }
}

/** Build a human-readable label for a mapping target. */
export function targetLabel(
  target: MidiMappingTarget,
  laneLabels: Record<string, string> = {},
): string {
  const lane = (t: string) => laneLabels[t] ?? t

  switch (target.type) {
    case 'masterVolume': return 'Master Volume'
    case 'bpm':          return 'BPM'
    case 'laneLevel':    return `${lane(target.laneType)} Volume`
    case 'lanePan':      return `${lane(target.laneType)} Pan`
    case 'laneReverb':   return `${lane(target.laneType)} Reverb`
    case 'laneDelay':    return `${lane(target.laneType)} Delay`
    case 'fxParam':      return `${lane(target.laneType)} FX — ${target.paramKey}`
    case 'automPoint':   return `Automation ${target.automLaneId}`
  }
}
