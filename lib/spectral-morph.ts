// Spectral morphing via phase vocoder — runs entirely in a Web Worker (blob URL)
// so the main thread and playback are never blocked.

const WORKER_SRC = `
'use strict';

function buildHann(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  return w;
}

// In-place radix-2 DIT FFT. re/im must be Float64Array of length 2^k.
function fft(re, im) {
  const N = re.length;
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cRe = 1, cIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i+k],      uIm = im[i+k];
        const vRe = re[i+k+half]*cRe - im[i+k+half]*cIm;
        const vIm = re[i+k+half]*cIm + im[i+k+half]*cRe;
        re[i+k]      = uRe + vRe;  im[i+k]      = uIm + vIm;
        re[i+k+half] = uRe - vRe;  im[i+k+half] = uIm - vIm;
        const nRe = cRe*wRe - cIm*wIm;
        cIm = cRe*wIm + cIm*wRe;
        cRe = nRe;
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

// Wrap angle to [-π, π]
function wrapPhase(p) {
  while (p >  Math.PI) p -= 2 * Math.PI;
  while (p < -Math.PI) p += 2 * Math.PI;
  return p;
}

self.onmessage = function(e) {
  const { samplesA, samplesB, sampleRate, outputDuration } = e.data;

  const FFT = 2048;
  const HOP = 512;
  const win = buildHann(FFT);

  const outputLen  = Math.ceil(outputDuration * sampleRate);
  const numFrames  = Math.ceil(outputLen / HOP) + 1;
  const outputBuf  = new Float64Array(outputLen + FFT * 2);

  const reA = new Float64Array(FFT), imA = new Float64Array(FFT);
  const reB = new Float64Array(FFT), imB = new Float64Array(FFT);
  const reO = new Float64Array(FFT), imO = new Float64Array(FFT);

  for (let frame = 0; frame < numFrames; frame++) {
    const t = numFrames > 1 ? frame / (numFrames - 1) : 0;

    // Read representative frame from each clip at the proportional position
    const posA = Math.floor(t * Math.max(0, samplesA.length - FFT));
    const posB = Math.floor(t * Math.max(0, samplesB.length - FFT));

    for (let i = 0; i < FFT; i++) {
      reA[i] = ((posA + i) < samplesA.length ? samplesA[posA + i] : 0) * win[i];
      imA[i] = 0;
      reB[i] = ((posB + i) < samplesB.length ? samplesB[posB + i] : 0) * win[i];
      imB[i] = 0;
    }

    fft(reA, imA);
    fft(reB, imB);

    // Interpolate magnitude; blend phase with wrap-aware lerp
    for (let k = 0; k < FFT; k++) {
      const magA = Math.sqrt(reA[k]*reA[k] + imA[k]*imA[k]);
      const magB = Math.sqrt(reB[k]*reB[k] + imB[k]*imB[k]);
      const phA  = Math.atan2(imA[k], reA[k]);
      const phB  = Math.atan2(imB[k], reB[k]);

      const mag = (1 - t) * magA + t * magB;
      const ph  = phA + t * wrapPhase(phB - phA);

      reO[k] = mag * Math.cos(ph);
      imO[k] = mag * Math.sin(ph);
    }

    ifft(reO, imO);

    // Overlap-add with synthesis window
    const outPos = frame * HOP;
    for (let i = 0; i < FFT; i++) {
      if (outPos + i < outputBuf.length) outputBuf[outPos + i] += reO[i] * win[i];
    }
  }

  // OLA normalization for Hann at 75% overlap = 1.5
  const OLA = 1.5;

  // Peak-normalize to 0.88 to prevent any clipping headroom issues
  let peak = 0;
  for (let i = 0; i < outputLen; i++) {
    const v = Math.abs(outputBuf[i] / OLA);
    if (v > peak) peak = v;
  }
  const scale = peak > 1e-6 ? 0.88 / peak : 1;

  const result = new Float32Array(outputLen);
  for (let i = 0; i < outputLen; i++) result[i] = (outputBuf[i] / OLA) * scale;

  self.postMessage({ samples: result, sampleRate }, [result.buffer]);
};
`

export interface MorphResult {
  samples: Float32Array
  sampleRate: number
}

export function runSpectralMorph(
  samplesA: Float32Array,
  samplesB: Float32Array,
  sampleRate: number,
  outputDuration: number
): Promise<MorphResult> {
  return new Promise((resolve, reject) => {
    const blob   = new Blob([WORKER_SRC], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    const worker  = new Worker(blobUrl)

    worker.onmessage = (e: MessageEvent<MorphResult>) => {
      URL.revokeObjectURL(blobUrl)
      worker.terminate()
      resolve(e.data)
    }
    worker.onerror = (e) => {
      URL.revokeObjectURL(blobUrl)
      worker.terminate()
      reject(new Error(e.message ?? 'Morph worker failed'))
    }

    // Send copies so the engine's AudioBuffer cache stays intact
    const copyA = new Float32Array(samplesA)
    const copyB = new Float32Array(samplesB)
    worker.postMessage({ samplesA: copyA, samplesB: copyB, sampleRate, outputDuration }, [
      copyA.buffer,
      copyB.buffer,
    ])
  })
}
