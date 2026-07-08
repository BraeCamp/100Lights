/**
 * STFT analysis / masked resynthesis for the spectral editor.
 *
 * All heavy math runs in a Web Worker (blob URL, same pattern as
 * spectral-morph.ts) and the magnitude/phase arrays LIVE in the worker —
 * the main thread only ever receives rendered pixels, updated masks, and
 * final audio. A SpectralSession wraps one worker per open editor.
 *
 * Analysis: Hann window, 75% overlap (hop = fftSize/4) → COLA-compliant,
 * so an unedited mask reconstructs the input transparently. Edits scale
 * bin magnitudes; original phases are reused (clean for attenuate/erase).
 *
 * Layers: harmonic/percussive soft masks (median filtering à la HPSS) are
 * computed on demand; layer-aware edits scale the mask by the layer weight
 * so "erase harmonic" leaves the percussive energy in place.
 */

export type SpectralLayer = 'all' | 'h' | 'p'

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

let S = null; // { mags, phases, frames, bins, fftSize, hop, length, win, dispMax, Mh }

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

function colorize(db, out, o) {
  const t = Math.min(1, Math.max(0, (db + 90) / 90));
  let r, g, b;
  if (t < 0.25)      { const u = t / 0.25;         r = 8 + 40*u;   g = 6 + 8*u;    b = 26 + 74*u;  }
  else if (t < 0.55) { const u = (t - 0.25) / 0.3;  r = 48 + 140*u; g = 14 + 32*u;  b = 100 - 20*u; }
  else if (t < 0.8)  { const u = (t - 0.55) / 0.25; r = 188 + 62*u; g = 46 + 120*u; b = 80 - 60*u;  }
  else               { const u = (t - 0.8) / 0.2;   r = 250;        g = 166 + 84*u; b = 20 + 215*u; }
  out[o] = r; out[o+1] = g; out[o+2] = b; out[o+3] = 255;
}

function magDb(m) { return m <= 1e-9 ? -90 : Math.max(-90, 20 * Math.log10(m)); }

// Weight of a cell in the given layer: 1 for 'all', Mh for 'h', 1-Mh for 'p'
function layerWeight(layer, i) {
  if (layer === 'h') return S.Mh ? S.Mh[i] : 1;
  if (layer === 'p') return S.Mh ? 1 - S.Mh[i] : 1;
  return 1;
}

function paintRect(mask, f0, f1, b0, b1, layer) {
  const { dispMax, bins } = S;
  const w = f1 - f0 + 1, h = b1 - b0 + 1;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let f = f0; f <= f1; f++) {
    for (let b = b0; b <= b1; b++) {
      const i = f * bins + b;
      const m = dispMax[i] * mask[i] * layerWeight(layer, i);
      const y = (b1 - b), x = (f - f0);
      colorize(magDb(m), px, (y * w + x) * 4);
    }
  }
  return px;
}

function median17(buf) {
  // insertion sort — buf.length <= 17
  for (let i = 1; i < buf.length; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) { buf[j+1] = buf[j]; j--; }
    buf[j+1] = v;
  }
  return buf[buf.length >> 1];
}

function ensureHpss() {
  if (S.Mh) return;
  const { dispMax, frames, bins } = S;
  const HALF = 8; // 17-tap median windows
  const Mh = new Float32Array(frames * bins);
  const tbuf = new Float64Array(2 * HALF + 1);
  const fbuf = new Float64Array(2 * HALF + 1);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bins; b++) {
      let n = 0;
      for (let df = -HALF; df <= HALF; df++) {
        const ff = Math.min(frames - 1, Math.max(0, f + df));
        tbuf[n++] = dispMax[ff * bins + b];
      }
      const medT = median17(tbuf.subarray(0, n));
      n = 0;
      for (let db = -HALF; db <= HALF; db++) {
        const bb = Math.min(bins - 1, Math.max(0, b + db));
        fbuf[n++] = dispMax[f * bins + bb];
      }
      const medF = median17(fbuf.subarray(0, n));
      const h2 = medT * medT, p2 = medF * medF;
      Mh[f * bins + b] = h2 / (h2 + p2 + 1e-12);
    }
  }
  S.Mh = Mh;
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
    const dispMax = new Float32Array(frames * bins);
    for (let i = 0; i < frames * bins; i++) {
      let m = 0;
      for (let c = 0; c < mags.length; c++) m = Math.max(m, mags[c][i]);
      dispMax[i] = m;
    }
    S = { mags, phases, frames, bins, fftSize, hop, length, win, dispMax, Mh: null };
    const ones = new Float32Array(frames * bins).fill(1);
    const px = paintRect(ones, 0, frames - 1, 0, bins - 1, 'all');
    self.postMessage({ type: 'analyzed', frames, bins, length, channels: channels.length, pixels: px.buffer }, [px.buffer]);
    return;
  }

  if (msg.type === 'hpss') {
    ensureHpss();
    self.postMessage({ type: 'hpssDone' });
    return;
  }

  if (msg.type === 'repaint') {
    const mask = new Float32Array(msg.mask);
    if (msg.layer !== 'all') ensureHpss();
    const px = paintRect(mask, msg.f0, msg.f1, msg.b0, msg.b1, msg.layer);
    self.postMessage({ type: 'repainted', f0: msg.f0, f1: msg.f1, b0: msg.b0, b1: msg.b1, pixels: px.buffer }, [px.buffer]);
    return;
  }

  if (msg.type === 'applyEdit') {
    // mode 'mult': mask *= effective gain; 'set': mask = value (all-layer only)
    const { bins } = S;
    const mask = new Float32Array(msg.mask);
    const sel = msg.selMask ? new Uint8Array(msg.selMask) : null;
    const { f0, f1, b0, b1, mode, value, layer } = msg;
    if (layer !== 'all') ensureHpss();
    for (let f = f0; f <= f1; f++) {
      for (let b = b0; b <= b1; b++) {
        const i = f * bins + b;
        if (sel && !sel[i]) continue;
        if (mode === 'set') {
          mask[i] = value;
        } else {
          const L = layerWeight(layer, i);
          const g = 1 - L * (1 - value); // scale only the layer's share
          mask[i] = Math.min(8, mask[i] * g);
        }
      }
    }
    const px = paintRect(mask, f0, f1, b0, b1, msg.viewLayer);
    self.postMessage(
      { type: 'edited', mask: mask.buffer, f0, f1, b0, b1, pixels: px.buffer },
      [mask.buffer, px.buffer]
    );
    return;
  }

  if (msg.type === 'wand') {
    const { dispMax, frames, bins } = S;
    const { f, b, tolDb, maxCells } = msg;
    if (msg.layer !== 'all') ensureHpss();
    const dbAt = i => magDb(dispMax[i] * layerWeight(msg.layer, i));
    const seed = f * bins + b;
    const seedDb = dbAt(seed);
    const sel = new Uint8Array(frames * bins);
    const stack = [seed];
    sel[seed] = 1;
    let count = 1;
    let f0 = f, f1 = f, b0 = b, b1 = b;
    while (stack.length && count < maxCells) {
      const i = stack.pop();
      const cf = Math.floor(i / bins), cb = i - cf * bins;
      if (cf < f0) f0 = cf; if (cf > f1) f1 = cf;
      if (cb < b0) b0 = cb; if (cb > b1) b1 = cb;
      const nbrs = [];
      if (cf > 0) nbrs.push(i - bins);
      if (cf < frames - 1) nbrs.push(i + bins);
      if (cb > 0) nbrs.push(i - 1);
      if (cb < bins - 1) nbrs.push(i + 1);
      for (const n of nbrs) {
        if (sel[n]) continue;
        if (Math.abs(dbAt(n) - seedDb) <= tolDb) { sel[n] = 1; stack.push(n); count++; }
      }
    }
    self.postMessage({ type: 'wandDone', selMask: sel.buffer, f0, f1, b0, b1, count }, [sel.buffer]);
    return;
  }

  if (msg.type === 'denoise') {
    // Per-bin noise floor = median magnitude over the selected cells of that
    // bin; spectral subtraction across the WHOLE timeline for profiled bins.
    const { dispMax, frames, bins } = S;
    const mask = new Float32Array(msg.mask);
    const sel = new Uint8Array(msg.selMask);
    const amount = msg.amount;       // 0..1
    const FLOOR = 0.0316;            // -30 dB max attenuation per cell
    if (msg.layer !== 'all') ensureHpss();
    for (let b = 0; b < bins; b++) {
      const vals = [];
      for (let f = 0; f < frames; f++) if (sel[f * bins + b]) vals.push(dispMax[f * bins + b]);
      if (vals.length < 3) continue;
      vals.sort((x, y) => x - y);
      const noise = vals[vals.length >> 1];
      if (noise <= 1e-9) continue;
      for (let f = 0; f < frames; f++) {
        const i = f * bins + b;
        const m = dispMax[i];
        if (m <= 1e-9) continue;
        const sub = Math.max(1 - (amount * noise) / m, FLOOR);
        const L = layerWeight(msg.layer, i);
        const g = 1 - L * (1 - sub);
        mask[i] = Math.min(8, mask[i] * g);
      }
    }
    const px = paintRect(mask, 0, frames - 1, 0, bins - 1, msg.viewLayer);
    self.postMessage(
      { type: 'denoised', mask: mask.buffer, pixels: px.buffer },
      [mask.buffer, px.buffer]
    );
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
          if (b > 0 && b < bins - 1) {
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

export interface EditResult { mask: Float32Array; image: ImageData; f0: number; b1: number }
export interface WandResult { selMask: Uint8Array; f0: number; f1: number; b0: number; b1: number; count: number }

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
        this.worker.removeEventListener('error', onErr)
        resolve(e.data as T)
      }
      const onErr = (e: ErrorEvent) => {
        this.worker.removeEventListener('message', onMsg)
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

  /** Compute harmonic/percussive soft masks (idempotent; a few seconds for long clips). */
  async computeLayers(): Promise<void> {
    await this.request('hpssDone', { type: 'hpss' })
  }

  /** Repaint one region of the spectrogram under the given mask and view layer. */
  async repaint(mask: Float32Array, f0: number, f1: number, b0: number, b1: number, layer: SpectralLayer = 'all'): Promise<ImageData> {
    const res = await this.request<{ pixels: ArrayBuffer }>(
      'repainted',
      { type: 'repaint', mask: mask.slice().buffer, f0, f1, b0, b1, layer },
    )
    return new ImageData(new Uint8ClampedArray(res.pixels), f1 - f0 + 1, b1 - b0 + 1)
  }

  /** Apply a gain edit (layer-aware) to a rect / cell selection; returns the new mask + repainted tile. */
  async applyEdit(
    mask: Float32Array,
    rect: { f0: number; f1: number; b0: number; b1: number },
    selMask: Uint8Array | null,
    mode: 'mult' | 'set',
    value: number,
    layer: SpectralLayer,
    viewLayer: SpectralLayer,
  ): Promise<EditResult> {
    const res = await this.request<{ mask: ArrayBuffer; pixels: ArrayBuffer; f0: number; f1: number; b0: number; b1: number }>(
      'edited',
      {
        type: 'applyEdit', mask: mask.slice().buffer,
        selMask: selMask ? selMask.slice().buffer : null,
        ...rect, mode, value, layer, viewLayer,
      },
    )
    return {
      mask: new Float32Array(res.mask),
      image: new ImageData(new Uint8ClampedArray(res.pixels), res.f1 - res.f0 + 1, res.b1 - res.b0 + 1),
      f0: res.f0, b1: res.b1,
    }
  }

  /** Magic wand: flood-fill cells whose level is within tolDb of the seed. */
  async wand(f: number, b: number, tolDb: number, layer: SpectralLayer, maxCells = 2_000_000): Promise<WandResult> {
    const res = await this.request<{ selMask: ArrayBuffer; f0: number; f1: number; b0: number; b1: number; count: number }>(
      'wandDone',
      { type: 'wand', f, b, tolDb, layer, maxCells },
    )
    return { selMask: new Uint8Array(res.selMask), f0: res.f0, f1: res.f1, b0: res.b0, b1: res.b1, count: res.count }
  }

  /** Spectral subtraction using the selection as the noise profile. Returns new mask + full repaint. */
  async denoise(mask: Float32Array, selMask: Uint8Array, amount: number, layer: SpectralLayer, viewLayer: SpectralLayer): Promise<{ mask: Float32Array; image: ImageData }> {
    const res = await this.request<{ mask: ArrayBuffer; pixels: ArrayBuffer }>(
      'denoised',
      { type: 'denoise', mask: mask.slice().buffer, selMask: selMask.slice().buffer, amount, layer, viewLayer },
    )
    return {
      mask: new Float32Array(res.mask),
      image: new ImageData(new Uint8ClampedArray(res.pixels), this.info!.frames, this.info!.bins),
    }
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
