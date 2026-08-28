// ============================================================================
//  Beacon Plugin Format v1 — types
//
//  A Beacon plugin is a folder (local or remote) containing a manifest, an
//  AudioWorklet processor, and optionally a WASM binary and a custom UI.
//  Browsers cannot load AU/VST3/CLAP, so this is the web-native equivalent:
//  everything runs in the page, no install, no native code.
//
//  Real AU/VST3/CLAP plug-ins are reached a different way — through the
//  Beacon Bridge, a native host process. See lib/beacon-plugins/bridge.ts.
//  Both appear in the same picker; `PluginDescriptor.source` says which.
// ============================================================================

/** Bumped only for breaking changes to the manifest or the message contract. */
export const BEACON_PLUGIN_FORMAT_VERSION = 1

export type PluginKind = 'instrument' | 'effect'

/** Where a plugin comes from, which decides how it is loaded and run. */
export type PluginSource =
  | 'builtin'   // shipped with Beacon, served from /plugins/<id>/
  | 'url'       // a manifest URL the user added
  | 'bridge'    // a native AU/VST3/CLAP hosted by the Beacon Bridge

// ---------------------------------------------------------------------------
//  Parameters
// ---------------------------------------------------------------------------

export type ParamCurve = 'linear' | 'log' | 'exp'

export interface PluginParamBase {
  id: string
  name: string
  /** Optional grouping for the generated UI, e.g. "Filter". */
  group?: string
  /** Short help shown on hover. */
  tooltip?: string
}

export interface PluginParamFloat extends PluginParamBase {
  kind: 'float'
  min: number
  max: number
  default: number
  unit?: string
  /** How the control maps value to position. Frequencies want 'log'. */
  curve?: ParamCurve
  /** Decimal places in the readout. */
  precision?: number
}

export interface PluginParamInt extends PluginParamBase {
  kind: 'int'
  min: number
  max: number
  default: number
  unit?: string
}

export interface PluginParamBool extends PluginParamBase {
  kind: 'bool'
  default: boolean
}

export interface PluginParamChoice extends PluginParamBase {
  kind: 'choice'
  choices: string[]
  default: number
}

export type PluginParam =
  | PluginParamFloat
  | PluginParamInt
  | PluginParamBool
  | PluginParamChoice

export type PluginParamValue = number | boolean

// ---------------------------------------------------------------------------
//  Manifest
// ---------------------------------------------------------------------------

export interface PluginPreset {
  name: string
  /** Sparse: only the parameters that differ from their defaults. */
  values: Record<string, PluginParamValue>
  category?: string
}

export interface PluginManifest {
  formatVersion: number
  /** Reverse-DNS and stable forever — it is what a saved project stores. */
  id: string
  name: string
  vendor: string
  version: string
  kind: PluginKind

  description?: string
  homepage?: string

  /** AudioWorklet module, relative to the manifest. */
  processor: string
  /** The name the module passes to registerProcessor(). */
  processorName: string

  /**
   * Optional WASM binary, relative to the manifest.
   *
   * The host fetches this and hands the BYTES to the processor in its `init`
   * message. A worklet has no fetch() and no network access at all, so a
   * processor that tries to load its own wasm will simply never start. This is
   * the single most common way to get the format wrong.
   */
  wasm?: string

  /** Optional custom UI, loaded in a sandboxed iframe. Falls back to the
      generated parameter panel when absent. */
  ui?: string
  /** Preferred size for the custom UI. */
  uiWidth?: number
  uiHeight?: number

  icon?: string
  /** Output channel count. 1 or 2; anything else is rejected. */
  outputs?: number

  parameters: PluginParam[]
  presets?: PluginPreset[]
}

// ---------------------------------------------------------------------------
//  What the host works with
// ---------------------------------------------------------------------------

export interface PluginDescriptor {
  id: string
  name: string
  vendor: string
  version: string
  kind: PluginKind
  source: PluginSource
  /** Absolute base URL for a web plugin's files; empty for bridge plugins. */
  baseUrl: string
  manifest: PluginManifest | null
  /** Set for bridge plugins: the native format and file path. */
  nativeFormat?: 'AudioUnit' | 'VST3' | 'CLAP'
  nativePath?: string
  /** Populated when a scan or load failed, so the picker can say why. */
  error?: string
}

/** What a project stores on a track. Deliberately small and portable. */
export interface PluginInstrumentParams {
  pluginId: string
  /** Parameter values by id. Sparse — missing means "the default". */
  values: Record<string, PluginParamValue>
  /**
   * Opaque state the plugin asked to keep (wavetables, sample references,
   * anything not expressible as a parameter). Base64 or JSON, plugin's choice.
   */
  state?: string
  /** Remembered so the UI can show the name before the plugin has loaded. */
  displayName?: string
}

// ---------------------------------------------------------------------------
//  Host -> processor messages
// ---------------------------------------------------------------------------

export interface MsgInit {
  type: 'init'
  sampleRate: number
  /** Present only when the manifest declares `wasm`. */
  wasmBinary?: ArrayBuffer
  /** Initial parameter values, already merged with the defaults. */
  values: Record<string, PluginParamValue>
  state?: string
}

export interface MsgNote {
  type: 'note'
  on: boolean
  pitch: number        // MIDI note
  velocity: number     // 0..1
  /** Absolute AudioContext time. Scheduling by time rather than by timer is
      what makes an offline render come out identical to live playback. */
  time: number
  /** Optional: lets the processor schedule the note-off itself. */
  duration?: number
  channel?: number
}

export interface MsgParam {
  type: 'param'
  id: string
  value: PluginParamValue
  /** Absolute time for automation; immediate when absent. */
  time?: number
}

export interface MsgParams {
  type: 'params'
  values: Record<string, PluginParamValue>
}

export interface MsgState {
  type: 'state'
  state: string
}

export interface MsgTransport {
  type: 'transport'
  bpm: number
  playing: boolean
  /** Position in quarter notes, for synced LFOs and delays. */
  ppq?: number
}

export interface MsgPanic { type: 'panic' }
export interface MsgRequestState { type: 'requestState' }

export type HostMessage =
  | MsgInit | MsgNote | MsgParam | MsgParams
  | MsgState | MsgTransport | MsgPanic | MsgRequestState

// ---------------------------------------------------------------------------
//  Processor -> host messages
// ---------------------------------------------------------------------------

export interface MsgReady { type: 'ready'; latencySamples?: number }
export interface MsgStateOut { type: 'state'; state: string }
export interface MsgMeter { type: 'meter'; peak: number }
export interface MsgError { type: 'error'; message: string }

export type ProcessorMessage = MsgReady | MsgStateOut | MsgMeter | MsgError

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

export function paramDefault(p: PluginParam): PluginParamValue {
  return p.default
}

/** Every parameter's default, as a plain object. */
export function defaultValues(manifest: PluginManifest): Record<string, PluginParamValue> {
  const out: Record<string, PluginParamValue> = {}
  for (const p of manifest.parameters) out[p.id] = paramDefault(p)
  return out
}

/** Clamp a value into a parameter's range, and coerce it to the right type. */
export function coerceParam(p: PluginParam, value: unknown): PluginParamValue {
  switch (p.kind) {
    case 'bool':
      return Boolean(value)
    case 'choice': {
      const n = Math.round(Number(value))
      return Number.isFinite(n) ? Math.min(p.choices.length - 1, Math.max(0, n)) : p.default
    }
    case 'int': {
      const n = Math.round(Number(value))
      return Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default
    }
    case 'float':
    default: {
      const n = Number(value)
      return Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default
    }
  }
}

/** Merge stored values over the manifest defaults, dropping unknown ids. */
export function mergeValues(
  manifest: PluginManifest,
  stored: Record<string, PluginParamValue> | undefined,
): Record<string, PluginParamValue> {
  const out = defaultValues(manifest)
  if (!stored) return out
  for (const p of manifest.parameters) {
    if (p.id in stored) out[p.id] = coerceParam(p, stored[p.id])
  }
  return out
}

/** 0..1 position for a knob, honouring the parameter's curve. */
export function paramToNorm(p: PluginParam, value: PluginParamValue): number {
  if (p.kind === 'bool') return value ? 1 : 0
  if (p.kind === 'choice') return p.choices.length < 2 ? 0 : Number(value) / (p.choices.length - 1)

  const v = Number(value)
  const { min, max } = p
  if (max <= min) return 0
  if (p.kind === 'float' && p.curve === 'log' && min > 0)
    return Math.log(v / min) / Math.log(max / min)
  if (p.kind === 'float' && p.curve === 'exp')
    return Math.sqrt((v - min) / (max - min))
  return (v - min) / (max - min)
}

/** The inverse of paramToNorm. */
export function normToParam(p: PluginParam, norm: number): PluginParamValue {
  const t = Math.min(1, Math.max(0, norm))
  if (p.kind === 'bool') return t >= 0.5
  if (p.kind === 'choice') return Math.round(t * (p.choices.length - 1))

  const { min, max } = p
  if (p.kind === 'float' && p.curve === 'log' && min > 0)
    return min * Math.pow(max / min, t)
  if (p.kind === 'float' && p.curve === 'exp')
    return min + (max - min) * t * t
  const raw = min + (max - min) * t
  return p.kind === 'int' ? Math.round(raw) : raw
}

/** Human readable value for a readout. */
export function formatParam(p: PluginParam, value: PluginParamValue): string {
  if (p.kind === 'bool') return value ? 'On' : 'Off'
  if (p.kind === 'choice')
    return p.choices[Math.min(p.choices.length - 1, Math.max(0, Number(value)))] ?? ''

  const v = Number(value)
  const unit = p.unit ?? ''
  if (unit === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(2)} kHz`
  const dp = p.kind === 'float' ? (p.precision ?? (Math.abs(v) < 10 ? 2 : 0)) : 0
  return `${v.toFixed(dp)}${unit ? ' ' + unit : ''}`
}

/** Validates a manifest enough to refuse a broken plugin with a real reason. */
export function validateManifest(
  m: unknown,
): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  const x = m as Partial<PluginManifest>
  if (!x || typeof x !== 'object') return { ok: false, error: 'The manifest is not an object.' }
  if (typeof x.id !== 'string' || !x.id) return { ok: false, error: 'The manifest has no id.' }
  if (typeof x.name !== 'string' || !x.name) return { ok: false, error: 'The manifest has no name.' }
  if (typeof x.processor !== 'string' || !x.processor)
    return { ok: false, error: 'The manifest does not say which file the processor is in.' }
  if (typeof x.processorName !== 'string' || !x.processorName)
    return { ok: false, error: 'The manifest does not give the registerProcessor name.' }
  if (x.kind !== 'instrument' && x.kind !== 'effect')
    return { ok: false, error: `Unknown plugin kind "${String(x.kind)}".` }
  if (!Array.isArray(x.parameters))
    return { ok: false, error: 'The manifest has no parameter list (use [] if there are none).' }
  if (typeof x.formatVersion !== 'number' || x.formatVersion > BEACON_PLUGIN_FORMAT_VERSION)
    return {
      ok: false,
      error:
        `This plugin needs a newer Beacon (format ${String(x.formatVersion)}, ` +
        `this build reads ${BEACON_PLUGIN_FORMAT_VERSION}).`,
    }

  for (const p of x.parameters as PluginParam[]) {
    if (!p || typeof p.id !== 'string' || !p.id)
      return { ok: false, error: 'A parameter is missing its id.' }
    if (p.kind === 'choice' && (!Array.isArray(p.choices) || p.choices.length === 0))
      return { ok: false, error: `Parameter "${p.id}" is a choice with no choices.` }
  }

  return { ok: true, manifest: x as PluginManifest }
}
