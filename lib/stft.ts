/**
 * STFT analysis / masked resynthesis for the spectral editor.
 *
 * All heavy math runs in a Web Worker (blob URL, same pattern as
 * spectral-morph.ts) and the magnitude/phase arrays LIVE in the worker —
 * the main thread only ever receives the rendered image, repainted tiles,
 * and final audio. A SpectralSession wraps one worker per open editor.
 *
 * Analysis: Hann window, 75% overlap (hop = fftSize/4) → COLA-compliant,
 * so an unedited mask reconstructs the input transparently. Edits scale
 * bin magnitudes; original phases are reused (clean for attenuate/erase).
 */

export interface SpectralInfo {
  frames: number
  bins: number
  fftSize: number
  hop: number
  sampleRate: number
  length: number      // samples per channel
  channels: number
  image: ImageData    // frames × bins, row 0 = highest bin
}

const WORKER_SRC = `
'use strict';

let S = null; // { mags:[Float32Array], phases:[Float32Array], frames, bins, fftSize, hop, length, win }

function buildHann(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  return w;
}

function fft(re, im) {
  const N = re.length;
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cRe = 1, cIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i+k], uIm = im[i+k];
        const vRe = re[i+k+half]*cRe - im[i+k+half]*cIm;
        const vIm = re[i+k+half]*cIm + im[i+k+half]*cRe;
        re[i+k] = uRe + vRe; im[i+k] = uIm + vIm;
        re[i+k+half] = uRe - vRe; im[i+k+half] = uIm - vIm;
        const nRe = cRe*wRe - cIm*wIm;
        cIm = cRe*wIm + cIm*wRe; cRe = nRe;
      }
    }
  }
}

function ifft(re, im) {
  const N = re.length;
  for (let i = 0; i < N; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < N; i++) { re[i] /= N; im[i] = -im[i] / N; }
}

// dB (-90..0) -> RGBA, dark-to-bright "inferno-ish" ramp
function colorize(db, out, o) {
  const t = Math.min(1, Math.max(0, (db + 90) / 90));
  let r, g, b;
  if (t < 0.25)      { const u = t / 0.25;        r = 8 + 40*u;   g = 6 + 8*u;    b = 26 + 74*u;  }
  else if (t < 0.55) { const u = (t - 0.25) / 0.3; r = 48 + 140*u; g = 14 + 32*u;  b = 100 - 20*u; }
  else if (t < 0.8)  { const u = (t - 0.55) / 0.25; r = 188 + 62*u; g = 46 + 120*u; b = 80 - 60*u; }
  else               { const u = (t - 0.8) / 0.2;  r = 250;        g = 166 + 84*u; b = 20 + 215*u; }
  out[o] = r; out[o+1] = g; out[o+2] = b; out[o+3] = 255;
}

function magDb(m) { return m <= 1e-9 ? -90 : Math.max(-90, 20 * Math.log10(m)); }

function paintRect(mask, f0, f1, b0, b1) {
  const { mags, frames, bins } = S;
  const nCh = mags.length;
  const w = f1 - f0 + 1, h = b1 - b0 + 1;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let f = f0; f <= f1; f++) {
    for (let b = b0; b <= b1; b++) {
      let m = 0;
      for (let c = 0; c < nCh; c++) m = Math.max(m, mags[c][f * bins + b]);
      m *= mask[f * bins + b];
      // row 0 of the image = highest bin
      const y = (b1 - b), x = (f - f0);
      colorize(magDb(m), px, (y * w + x) * 4);
    }
  }
  return px;
}

self.onmessage = function(e) {
  const msg = e.data;

  if (msg.type === 'analyze') {
    const { channels, fftSize, hop } = msg;
    const bins = (fftSize >> 1) + 1;
    const length = channels[0].length;
    const frames = Math.max(1, Math.floor((length - fftSize) / hop) + 1);
    const win = buildHann(fftSize);
    const mags = [], phases = [];
    const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    for (let c = 0; c < channels.length; c++) {
      const x = channels[c];
      const mag = new Float32Array(frames * bins);
      const ph  = new Float32Array(frames * bins);
      for (let f = 0; f < frames; f++) {
        const off = f * hop;
        for (let i = 0; i < fftSize; i++) { re[i] = (x[off + i] || 0) * win[i]; im[i] = 0; }
        fft(re, im);
        for (let b = 0; b < bins; b++) {
          mag[f * bins + b] = Math.hypot(re[b], im[b]);
          ph[f * bins + b]  = Math.atan2(im[b], re[b]);
        }
      }
      mags.push(mag); phases.push(ph);
    }
    S = { mags, phases, frames, bins, fftSize, hop, length, win, channels: channels.length };
    // Full image: mask of ones
    const ones = new Float32Array(frames * bins).fill(1);
    const px = paintRect(ones, 0, frames - 1, 0, bins - 1);
    self.postMessage({ type: 'analyzed', frames, bins, length, channels: channels.length, pixels: px.buffer }, [px.buffer]);
    return;
  }

  if (msg.type === 'repaint') {
    const { mask, f0, f1, b0, b1 } = msg;
    const px = paintRect(new Float32Array(mask), f0, f1, b0, b1);
    self.postMessage({ type: 'repainted', f0, f1, b0, b1, pixels: px.buffer }, [px.buffer]);
    return;
  }

  if (msg.type === 'resynth') {
    const { mags, phases, frames, bins, fftSize, hop, length, win } = S;
    const mask = new Float32Array(msg.mask);
    const out = [];
    const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    const norm = new Float64Array(length);
    for (let f = 0; f < frames; f++) {
      const off = f * hop;
      for (let i = 0; i < fftSize; i++) {
        const n = off + i;
        if (n < length) norm[n] += win[i] * win[i];
      }
    }
    for (let c = 0; c < mags.length; c++) {
      const y = new Float64Array(length);
      const mag = mags[c], ph = phases[c];
      for (let f = 0; f < frames; f++) {
        for (let b = 0; b < bins; b++) {
          const m = mag[f * bins + b] * mask[f * bins + b];
          const p = ph[f * bins + b];
          re[b] = m * Math.cos(p); im[b] = m * Math.sin(p);
          if (b > 0 && b < bins - 1) { // hermitian symmetry
            re[fftSize - b] = re[b]; im[fftSize - b] = -im[b];
          }
        }
        im[0] = 0; im[bins - 1] = 0;
        ifft(re, im);
        const off = f * hop;
        for (let i = 0; i < fftSize; i++) {
          const n = off + i;
          if (n < length) y[n] += re[i] * win[i];
        }
      }
      const ch = new Float32Array(length);
      for (let n = 0; n < length; n++) ch[n] = norm[n] > 1e-9 ? y[n] / norm[n] : 0;
      out.push(ch);
    }
    self.postMessage({ type: 'resynthed', channels: out.map(c => c.buffer) }, out.map(c => c.buffer));
    return;
  }
};
`

export class SpectralSession {
  private worker: Worker
  private url: string
  info: SpectralInfo | null = null

  constructor() {
    this.url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }))
    this.worker = new Worker(this.url)
  }

  private request<T>(match: string, msg: object, transfer: Transferable[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type !== match) return
        this.worker.removeEventListener('message', onMsg)
        resolve(e.data as T)
      }
      const onErr = (e: ErrorEvent) => {
        this.worker.removeEventListener('error', onErr)
        reject(new Error(e.message))
      }
      this.worker.addEventListener('message', onMsg)
      this.worker.addEventListener('error', onErr)
      this.worker.postMessage(msg, transfer)
    })
  }

  async analyze(buffer: AudioBuffer, fftSize = 2048, hop = 512): Promise<SpectralInfo> {
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      // copy — the AudioBuffer stays usable by the engine
      channels.push(buffer.getChannelData(c).slice())
    }
    const res = await this.request<{ frames: number; bins: number; length: number; channels: number; pixels: ArrayBuffer }>(
      'analyzed',
      { type: 'analyze', channels, fftSize, hop },
      channels.map(c => c.buffer),
    )
    const image = new ImageData(new Uint8ClampedArray(res.pixels), res.frames, res.bins)
    this.info = {
      frames: res.frames, bins: res.bins, fftSize, hop,
      sampleRate: buffer.sampleRate, length: res.length, channels: res.channels, image,
    }
    return this.info
  }

  /** Repaint one region of the spectrogram under the given mask. */
  async repaint(mask: Float32Array, f0: number, f1: number, b0: number, b1: number): Promise<ImageData> {
    const res = await this.request<{ f0: number; f1: number; b0: number; b1: number; pixels: ArrayBuffer }>(
      'repainted',
      { type: 'repaint', mask: mask.slice().buffer, f0, f1, b0, b1 },
    )
    return new ImageData(new Uint8ClampedArray(res.pixels), f1 - f0 + 1, b1 - b0 + 1)
  }

  /** Rebuild audio with the mask applied to bin magnitudes (original phases). */
  async resynthesize(mask: Float32Array): Promise<Float32Array[]> {
    const res = await this.request<{ channels: ArrayBuffer[] }>(
      'resynthed',
      { type: 'resynth', mask: mask.slice().buffer },
    )
    return res.channels.map(b => new Float32Array(b))
  }

  dispose(): void {
    this.worker.terminate()
    URL.revokeObjectURL(this.url)
    this.info = null
  }
}
