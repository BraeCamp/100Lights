// "Code a poly track with math": run a small creator script that returns MIDI
// notes + a poly synth patch. The script runs in a Web Worker (blob URL, same
// pattern as lib/stft.ts) with a hard timeout, so an infinite loop can't freeze
// the editor and there's no DOM access. Returns a track ready to dispatch as
// ADD_TRACK (poly) + ADD_CLIP.
import { defaultPolyInstrument, type PolyInstrumentParams } from './daw-types'

export interface GeneratedNote {
  pitch: number
  startBeat: number
  durationBeats: number
  velocity: number
}

export interface GeneratedTrack {
  name: string
  params: PolyInstrumentParams
  notes: GeneratedNote[]
  durationBeats: number
}

export type PolyCodeResult =
  | { ok: true; track: GeneratedTrack }
  | { ok: false; error: string }

// The music helper library + sandbox harness, injected into the worker.
const WORKER_SRC = `
const SCALES = {
  major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10],
  phrygian:[0,1,3,5,7,8,10], lydian:[0,2,4,6,7,9,11], mixolydian:[0,2,4,5,7,9,10],
  locrian:[0,1,3,5,6,8,10], harmonic:[0,2,3,5,7,8,11],
  'penta-min':[0,3,5,7,10], 'penta-maj':[0,2,4,7,9], blues:[0,3,5,6,7,10],
  chromatic:[0,1,2,3,4,5,6,7,8,9,10,11],
};
const NOTE_NAMES = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};

function pitch(name, octave){ return (NOTE_NAMES[name] || 0) + ((octave|0) + 1) * 12; }

function scale(root, name){
  const iv = SCALES[name] || SCALES.minor;
  return {
    root: root, name: name, length: iv.length,
    // degree i (may be negative or beyond one octave — wraps with octaves)
    note: function(i){
      i = Math.round(i);
      const o = Math.floor(i / iv.length);
      const d = ((i % iv.length) + iv.length) % iv.length;
      return root + o * 12 + iv[d];
    },
  };
}

function note(pitch, start, dur, vel){
  return { pitch: Math.round(pitch), startBeat: +start, durationBeats: +dur,
           velocity: vel == null ? 100 : Math.round(vel) };
}

function chord(start, dur, pitches, vel){
  return (pitches || []).map(function(p){ return note(p, start, dur, vel); });
}

// Euclidean rhythm — evenly distribute [pulses] onsets across [steps].
function euclid(steps, pulses){
  steps = Math.max(1, Math.round(steps));
  pulses = Math.max(0, Math.min(steps, Math.round(pulses)));
  const out = []; let bucket = 0;
  for (let i = 0; i < steps; i++){
    bucket += pulses;
    if (bucket >= steps){ bucket -= steps; out.push(true); } else out.push(false);
  }
  return out;
}

function flatten(arr, acc){
  for (let i = 0; i < arr.length; i++){
    const v = arr[i];
    if (Array.isArray(v)) flatten(v, acc);
    else if (v && typeof v === 'object' && typeof v.pitch === 'number') acc.push(v);
  }
  return acc;
}

self.onmessage = function(e){
  const data = e.data || {};
  try {
    // Harden: no network / no nested workers from creator scripts.
    self.fetch = undefined; self.XMLHttpRequest = undefined; self.importScripts = undefined;
    const fn = new Function('scale','note','chord','euclid','pitch','tempo','bars','Math', data.code);
    const out = fn(scale, note, chord, euclid, pitch, data.tempo, data.bars, Math) || {};
    const notes = flatten(Array.isArray(out.notes) ? out.notes : [], []);
    self.postMessage({ ok: true, name: out.name, patch: out.patch || {}, notes: notes, length: out.length });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
`

const WAVES = ['sine', 'square', 'sawtooth', 'triangle']
const FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch']
const LFO_TARGETS = ['pitch', 'filter', 'amp']

function clamp(v: unknown, def: number, lo: number, hi: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def
}

function finalize(
  raw: { name?: unknown; patch?: Record<string, unknown>; notes?: unknown[]; length?: unknown },
  bars: number,
): GeneratedTrack {
  const base = defaultPolyInstrument().params as PolyInstrumentParams
  const p = raw.patch ?? {}
  const params: PolyInstrumentParams = {
    waveform: WAVES.includes(p.waveform as string)
      ? (p.waveform as OscillatorType)
      : base.waveform,
    attack: clamp(p.attack, base.attack, 0, 4),
    decay: clamp(p.decay, base.decay, 0, 4),
    sustain: clamp(p.sustain, base.sustain, 0, 1),
    release: clamp(p.release, base.release, 0, 4),
    detune: clamp(p.detune, base.detune, -100, 100),
    filterType: FILTERS.includes(p.filterType as string)
      ? (p.filterType as BiquadFilterType)
      : base.filterType,
    filterCutoff: clamp(p.cutoff ?? p.filterCutoff, base.filterCutoff, 20, 20000),
    filterResonance: clamp(p.resonance ?? p.filterResonance, base.filterResonance, 0.1, 20),
    lfoEnabled: !!p.lfoEnabled,
    lfoRate: clamp(p.lfoRate, base.lfoRate, 0.1, 20),
    lfoDepth: clamp(p.lfoDepth, base.lfoDepth, 0, 1),
    lfoTarget: LFO_TARGETS.includes(p.lfoTarget as string)
      ? (p.lfoTarget as PolyInstrumentParams['lfoTarget'])
      : base.lfoTarget,
    lfoWaveform: WAVES.includes(p.lfoWaveform as string)
      ? (p.lfoWaveform as OscillatorType)
      : base.lfoWaveform,
  }

  const notes: GeneratedNote[] = (raw.notes ?? [])
    .map((n) => {
      const o = n as Record<string, unknown>
      return {
        pitch: Math.round(clamp(o.pitch, 60, 0, 127)),
        startBeat: Math.max(0, Number(o.startBeat) || 0),
        durationBeats: Math.max(0.01, Number(o.durationBeats) || 0.25),
        velocity: Math.round(clamp(o.velocity ?? 100, 100, 1, 127)),
      }
    })
    .filter((n) => Number.isFinite(n.startBeat))
    .slice(0, 4000)

  const len = Number(raw.length)
  const durationBeats = Number.isFinite(len) && len > 0 ? len : bars * 4
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 40)
      : 'Coded Poly'
  return { name, params, notes, durationBeats }
}

/** Run creator [code] and return a poly track (or an error). Times out at 2 s. */
export function runPolyCode(
  code: string,
  opts: { tempo: number; bars: number },
): Promise<PolyCodeResult> {
  return new Promise((resolve) => {
    let done = false
    const url = URL.createObjectURL(
      new Blob([WORKER_SRC], { type: 'application/javascript' }),
    )
    const worker = new Worker(url)
    const finish = (r: PolyCodeResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(r)
    }
    const timer = setTimeout(
      () => finish({ ok: false, error: 'Timed out — check for an infinite loop.' }),
      2000,
    )
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (!d?.ok) {
        finish({ ok: false, error: d?.error ?? 'Unknown error' })
        return
      }
      try {
        finish({ ok: true, track: finalize(d, opts.bars) })
      } catch (err) {
        finish({ ok: false, error: String((err as Error)?.message ?? err) })
      }
    }
    worker.onerror = (e) => finish({ ok: false, error: e.message || 'Worker error' })
    worker.postMessage({ code, tempo: opts.tempo, bars: opts.bars })
  })
}

/** Starter examples shown in the Code panel and the docs. */
export const POLY_CODE_EXAMPLES: { label: string; code: string }[] = [
  {
    label: 'Arp from a scale',
    code: `// An up-and-down arpeggio over 4 bars, built from the minor scale.
const s = scale(pitch('A', 3), 'minor');
const seq = [0, 2, 4, 6, 4, 2];   // scale degrees
const notes = [];
for (let step = 0; step < 32; step++) {
  const deg = seq[step % seq.length];
  notes.push(note(s.note(deg), step * 0.5, 0.45, 90));
}
return {
  name: 'Math Arp',
  patch: { waveform: 'square', cutoff: 2200, resonance: 4, decay: 0.2, sustain: 0.3 },
  length: 16,
  notes,
};`,
  },
  {
    label: 'Euclidean bass',
    code: `// A driving bass whose hits follow a euclidean rhythm (5 in 8).
const root = pitch('E', 1);
const hits = euclid(16, 7);
const notes = [];
for (let i = 0; i < hits.length; i++) {
  if (hits[i]) notes.push(note(root, i * 0.5, 0.4, 112));
}
return {
  name: 'Euclid Bass',
  patch: { waveform: 'sawtooth', cutoff: 600, resonance: 6, detune: 8, release: 0.2 },
  length: 8,
  notes,
};`,
  },
  {
    label: 'Chord progression',
    code: `// Four bars of chords from the scale (i – VI – III – VII).
const s = scale(pitch('C', 3), 'minor');
const roots = [0, 5, 2, 6];   // scale degrees to build triads on
const notes = [];
roots.forEach((r, bar) => {
  const triad = [s.note(r), s.note(r + 2), s.note(r + 4)];
  notes.push(chord(bar * 4, 3.8, triad, 70));
});
return {
  name: 'Chord Pad',
  patch: { waveform: 'sawtooth', cutoff: 1400, attack: 0.4, release: 0.9 },
  length: 16,
  notes,
};`,
  },
]
