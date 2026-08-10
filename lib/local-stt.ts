// Local (on-device) speech-to-text — the FREE half of the caption hybrid. Lazy-loads
// @huggingface/transformers and runs Whisper (ONNX) entirely in the browser: WebGPU when available,
// else WASM. The model is fetched once (HuggingFace CDN — allowed under our `credentialless` COEP)
// and cached by the browser, then every transcription is $0. Returns the video editor's Caption[]
// shape with word timings, plus a per-caption confidence so the caller can escalate only the
// low-confidence parts to the paid Deepgram route (that's the "AI for the hard bits" half).
//
// Split into transcribeSamples() (pure over 16 kHz mono samples — node-testable with real speech) and
// transcribeLocally() (browser decode wrapper). Client-only: dynamic-imports the model at call time.
import type { Caption } from './types'

// whisper-base.en: ~English, good accuracy for clean speech, ~75 MB quantized. Swap to whisper-small.en
// for noisier audio at ~240 MB, or whisper-tiny.en (~40 MB) for the fastest/cheapest pass.
export const STT_MODEL = 'Xenova/whisper-base.en'
// A tiny second model used ONLY to verify the base model. Where the two disagree, the transcript is
// unreliable — a far better confidence signal than audio energy alone (which only catches
// silence/noise hallucinations, not real word errors on clear-but-hard speech). Cheap: ~40 MB, fast.
export const VERIFY_MODEL = 'Xenova/whisper-tiny.en'

export interface SttProgress { status: string; file?: string; progress?: number }
export interface LocalCaption extends Caption { confidence: number }
export interface LocalSttResult {
  captions: LocalCaption[]
  lowConfidenceFraction: number   // share of captions the local pass is unsure about → escalate to AI
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const _pipes: Record<string, Promise<any>> = {}
async function getPipeline(model: string, device: string, onProgress?: (p: SttProgress) => void): Promise<any> {
  if (!_pipes[model]) {
    _pipes[model] = (async () => {
      const tf: any = await import('@huggingface/transformers')
      return tf.pipeline('automatic-speech-recognition', model, {
        dtype: 'q8', device,
        progress_callback: (p: any) => onProgress?.({ status: p.status, file: p.file, progress: p.progress }),
      })
    })()
  }
  return _pipes[model]
}

const normWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
// Normalized word-edit distance in [0,1] — 0 = identical, 1 = fully different. Used to score how much
// the base and verifier models disagree over a caption's words.
function wordDisagreement(a: string[], b: string[]): number {
  const m = a.length, n = b.length
  if (!m && !n) return 0
  if (!m || !n) return 1
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1])
  return Math.min(1, d[m][n] / Math.max(m, n))
}

// Browser: WebGPU when available (fast), else WASM. Node/testing can override via opts.device ('cpu').
function autoDevice(): string {
  return typeof navigator !== 'undefined' && (navigator as any).gpu ? 'webgpu' : 'wasm'
}

/** Root-mean-square energy of the 16 kHz samples over [start,end] seconds. */
function rmsOver(samples: Float32Array, start: number, end: number): number {
  const a = Math.max(0, Math.floor(start * 16000)), b = Math.min(samples.length, Math.ceil(end * 16000))
  if (b <= a) return 0
  let s = 0
  for (let i = a; i < b; i++) s += samples[i] * samples[i]
  return Math.sqrt(s / (b - a))
}

// Group Whisper word chunks into readable caption lines: break on a real pause, sentence-ending
// punctuation, or ~7 words / ~5 s, whichever comes first.
function groupWords(chunks: Array<{ text: string; timestamp: [number, number] }>): Caption[] {
  const caps: Caption[] = []
  let cur: { words: Array<{ w: string; s: number; e: number }>; start: number } | null = null
  const flush = () => {
    if (!cur || !cur.words.length) return
    const text = cur.words.map(w => w.w).join('').replace(/\s+/g, ' ').trim()
    caps.push({ start: cur.start, end: cur.words[cur.words.length - 1].e, text, words: cur.words })
    cur = null
  }
  let prevEnd = 0
  for (const c of chunks) {
    const [s, e] = c.timestamp || [prevEnd, prevEnd]
    const w = c.text
    if (!cur) cur = { words: [], start: s }
    else if (s - prevEnd > 0.7 || cur.words.length >= 7 || (cur.words.length && e - cur.start > 5)) flush(), cur = { words: [], start: s }
    cur.words.push({ w, s, e })
    prevEnd = e
    if (/[.!?]$/.test(w.trim())) flush()
  }
  flush()
  return caps
}

/** Transcribe 16 kHz mono samples locally. Pure over the model — node-testable with real speech. */
export async function transcribeSamples(
  samples: Float32Array, opts: { model?: string; device?: string; verify?: boolean; onProgress?: (p: SttProgress) => void } = {},
): Promise<LocalSttResult> {
  const device = opts.device ?? autoDevice()
  const pipe = await getPipeline(opts.model ?? STT_MODEL, device, opts.onProgress)
  opts.onProgress?.({ status: 'transcribing' })
  const out: any = await pipe(samples, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 })
  const raw = groupWords(out?.chunks ?? [])

  // VERIFIER: run a tiny second model. Where the base and tiny models DISAGREE over a caption's words,
  // the transcript is unreliable — this catches confident word-errors that audio energy never could.
  let verifyWords: Array<{ w: string; s: number; e: number }> = []
  if (opts.verify !== false) {
    try {
      const vpipe = await getPipeline(VERIFY_MODEL, device)
      const vout: any = await vpipe(samples, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 })
      verifyWords = (vout?.chunks ?? [])
        .map((c: any) => ({ w: (c.text || '').toLowerCase().replace(/[^a-z0-9]/g, ''), s: c.timestamp?.[0] ?? 0, e: c.timestamp?.[1] ?? 0 }))
        .filter((w: { w: string }) => w.w)
    } catch { /* verifier unavailable → fall back to energy-only confidence */ }
  }

  const peak = Math.max(1e-6, ...Array.from({ length: 20 }, (_, i) => rmsOver(samples, i * (samples.length / 16000 / 20), (i + 1) * (samples.length / 16000 / 20))))
  const captions: LocalCaption[] = raw.map((c, i) => {
    let confidence = 1
    if (verifyWords.length) {
      // Model-agreement confidence — the reliable signal. Compare this caption's words to the verifier's
      // words over the same time window (small padding for timestamp jitter).
      const win = verifyWords.filter(w => w.e > c.start - 0.2 && w.s < c.end + 0.2).map(w => w.w)
      confidence = +(1 - wordDisagreement(normWords(c.text), win)).toFixed(2)
    }
    // Hallucination guards (also apply when the verifier is off): silence, decode-loop, empty.
    const energy = rmsOver(samples, c.start, c.end) / peak
    if (energy < 0.06) confidence = Math.min(confidence, 0.3)
    if (i > 0 && raw[i - 1].text.trim().toLowerCase() === c.text.trim().toLowerCase()) confidence = Math.min(confidence, 0.25)
    if (c.text.replace(/[^a-z0-9]/gi, '').length === 0) confidence = 0.1
    return { ...c, confidence }
  }).filter(c => c.confidence > 0.1)               // drop empty hallucinations outright
  // "Low" = below 0.7; on the LibriSpeech test-other calibration that catches every wrong clip.
  const lowConfidenceFraction = captions.length ? captions.filter(c => c.confidence < 0.7).length / captions.length : 0
  return { captions, lowConfidenceFraction }
}

/** Decode an audio Blob/File to 16 kHz mono, then transcribe locally. Browser only. */
export async function transcribeLocally(
  audio: Blob, opts: { model?: string; device?: string; verify?: boolean; onProgress?: (p: SttProgress) => void } = {},
): Promise<LocalSttResult> {
  if (typeof window === 'undefined') throw new Error('transcribeLocally must run in the browser')
  const AC = window.AudioContext || (window as any).webkitAudioContext
  const ac = new AC()
  const buf = await ac.decodeAudioData(await audio.arrayBuffer())
  const ch = buf.getChannelData(0), srcRate = buf.sampleRate
  await ac.close()
  let samples: Float32Array
  if (srcRate === 16000) samples = new Float32Array(ch)
  else {
    const ratio = srcRate / 16000, n = Math.floor(ch.length / ratio)
    samples = new Float32Array(n)
    for (let i = 0; i < n; i++) { const idx = i * ratio, i0 = Math.floor(idx), f = idx - i0; samples[i] = ch[i0] * (1 - f) + (ch[i0 + 1] ?? ch[i0]) * f }
  }
  return transcribeSamples(samples, opts)
}
