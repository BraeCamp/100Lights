// Minimal SFZ parser for Apollo's multisample oscillator.
// Supports <global>/<group>/<region> headers and the core opcodes:
// sample, lokey, hikey, lovel, hivel, pitch_keycenter, key, tune, volume,
// loop_mode, loop_start, loop_end, offset.

export interface SfzRegion {
  sample: string
  loKey: number
  hiKey: number
  loVel: number
  hiVel: number
  rootKey: number
  tune: number
  gain: number
  loopMode: 'off' | 'loop' | 'pingpong' | 'tails'
  loopStart: number // samples
  loopEnd: number   // samples
}

const NOTE_RE = /^([a-gA-G])([#b]?)(-?\d+)$/
const NOTE_OFFSETS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

function parseNote(v: string): number {
  const n = Number(v)
  if (!Number.isNaN(n)) return n
  const m = v.match(NOTE_RE)
  if (!m) return 60
  let semis = NOTE_OFFSETS[m[1].toLowerCase()]
  if (m[2] === '#') semis += 1
  if (m[2] === 'b') semis -= 1
  return (Number(m[3]) + 1) * 12 + semis
}

export function parseSfz(text: string): SfzRegion[] {
  // strip comments
  const src = text.replace(/\/\/[^\n]*/g, '')
  const tokens = src.match(/<[^>]+>|[\w.$-]+=(?:"[^"]*"|[^\s<]*)/g) || []
  const regions: SfzRegion[] = []
  let globalOps: Record<string, string> = {}
  let groupOps: Record<string, string> = {}
  let regionOps: Record<string, string> | null = null
  let scope: 'global' | 'group' | 'region' | 'other' = 'other'

  const flush = () => {
    if (!regionOps) return
    const ops = { ...globalOps, ...groupOps, ...regionOps }
    regionOps = null
    const sample = (ops.sample || '').replace(/"/g, '').replace(/\\/g, '/')
    if (!sample) return
    const key = ops.key != null ? parseNote(ops.key) : null
    const loopModeRaw = ops.loop_mode || ops.loopmode || 'no_loop'
    regions.push({
      sample,
      loKey: key != null ? key : ops.lokey != null ? parseNote(ops.lokey) : 0,
      hiKey: key != null ? key : ops.hikey != null ? parseNote(ops.hikey) : 127,
      loVel: ops.lovel != null ? Number(ops.lovel) : 0,
      hiVel: ops.hivel != null ? Number(ops.hivel) : 127,
      rootKey: ops.pitch_keycenter != null ? parseNote(ops.pitch_keycenter) : key != null ? key : 60,
      tune: ops.tune != null ? Number(ops.tune) : 0,
      gain: ops.volume != null ? Number(ops.volume) : 0,
      loopMode: loopModeRaw === 'loop_continuous' ? 'loop' : loopModeRaw === 'loop_sustain' ? 'tails' : 'off',
      loopStart: ops.loop_start != null ? Number(ops.loop_start) : 0,
      loopEnd: ops.loop_end != null ? Number(ops.loop_end) : 0,
    })
  }

  for (const tok of tokens) {
    if (tok.startsWith('<')) {
      flush()
      const h = tok.toLowerCase()
      if (h === '<global>') { scope = 'global'; globalOps = {} }
      else if (h === '<group>') { scope = 'group'; groupOps = {} }
      else if (h === '<region>') { scope = 'region'; regionOps = {} }
      else scope = 'other'
      continue
    }
    const eq = tok.indexOf('=')
    if (eq < 0) continue
    const k = tok.slice(0, eq).toLowerCase()
    const v = tok.slice(eq + 1)
    if (scope === 'global') globalOps[k] = v
    else if (scope === 'group') groupOps[k] = v
    else if (scope === 'region' && regionOps) regionOps[k] = v
  }
  flush()
  return regions
}

// Match region sample paths against user-provided files by basename.
export function matchSfzFiles(regions: SfzRegion[], files: File[]): Map<string, File> {
  const byName = new Map<string, File>()
  for (const f of files) byName.set(f.name.toLowerCase(), f)
  const out = new Map<string, File>()
  for (const r of regions) {
    const base = r.sample.split('/').pop()?.toLowerCase() || ''
    const f = byName.get(base)
    if (f) out.set(r.sample, f)
  }
  return out
}
