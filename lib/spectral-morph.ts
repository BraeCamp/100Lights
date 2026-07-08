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

function wrapPhase(p) {
  p = p % (2 * Math.PI);
  if (p >  Math.PI) p -= 2 * Math.PI;
  else if (p < -Math.PI) p += 2 * Math.PI;
  return p;
}

// FFT-based autocorrelation pitch detector. Returns Hz or 0 if no clear pitch.
// startOffset lets us read from the tail of A (pass samplesA.length - 4096)
// or the head of B (pass 0).
function detectPitch(samples, startOffset, sampleRate) {
  const N = 4096;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const idx = startOffset + i;
    const s = idx < samples.length ? samples[idx] : 0;
    // Hann window to reduce spectral leakage
    re[i] = s * (0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))));
  }
  fft(re, im);

  // Power spectrum → IFFT = autocorrelation function
  const acRe = new Float64Array(N), acIm = new Float64Array(N);
  for (let k = 0; k < N; k++) acRe[k] = re[k]*re[k] + im[k]*im[k];
  ifft(acRe, acIm);

  // Search for the peak in the lag range 60 Hz–1200 Hz
  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(Math.ceil(sampleRate / 60), N >> 1);
  let best = -Infinity, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acRe[lag] > best) { best = acRe[lag]; bestLag = lag; }
  }

  // Require the ACF peak to be at least 10% of the zero-lag energy
  if (bestLag === 0 || best < acRe[0] * 0.1) return 0;
  return sampleRate / bestLag;
}

self.onmessage = function(e) {
  const { samplesA, samplesB, sampleRate, outputDuration } = e.data;

  const FFT  = 2048;
  const HOP  = 512;
  const HALF = FFT >> 1;
  const win  = buildHann(FFT);

  const outputLen = Math.ceil(outputDuration * sampleRate);
  const numFrames = Math.ceil(outputLen / HOP) + 1;
  const outputBuf = new Float64Array(outputLen + FFT * 2);

  const reA = new Float64Array(FFT), imA = new Float64Array(FFT);
  const reB = new Float64Array(FFT), imB = new Float64Array(FFT);
  const reO = new Float64Array(FFT), imO = new Float64Array(FFT);

  // Pre-computed mag/phase arrays reused each frame (avoids repeated allocation)
  const magA = new Float64Array(FFT), phsA = new Float64Array(FFT);
  const magB = new Float64Array(FFT), phsB = new Float64Array(FFT);

  // Detect pitch from the tail of A and the head of B
  const aDetectStart = Math.max(0, samplesA.length - 4096);
  const pitchA = detectPitch(samplesA, aDetectStart, sampleRate);
  const pitchB = detectPitch(samplesB, 0, sampleRate);
  const canWarp = pitchA > 0 && pitchB > 0;

  // Sliding windows: advance through the tail of A and head of B
  const aWindowLen = Math.max(0, Math.min(outputLen, samplesA.length - FFT));
  const bWindowLen = Math.max(0, Math.min(outputLen, samplesB.length - FFT));
  const aStart     = Math.max(0, samplesA.length - FFT - aWindowLen);

  for (let frame = 0; frame < numFrames; frame++) {
    const t = numFrames > 1 ? frame / (numFrames - 1) : 0;

    const posA = aStart + Math.floor(t * aWindowLen);
    const posB = Math.floor(t * bWindowLen);

    for (let i = 0; i < FFT; i++) {
      reA[i] = (posA + i < samplesA.length ? samplesA[posA + i] : 0) * win[i];
      imA[i] = 0;
      reB[i] = (posB + i < samplesB.length ? samplesB[posB + i] : 0) * win[i];
      imB[i] = 0;
    }
    fft(reA, imA);
    fft(reB, imB);

    // Pre-compute per-bin magnitude and phase for both spectra
    for (let k = 0; k < FFT; k++) {
      magA[k] = Math.sqrt(reA[k]*reA[k] + imA[k]*imA[k]);
      phsA[k] = Math.atan2(imA[k], reA[k]);
      magB[k] = Math.sqrt(reB[k]*reB[k] + imB[k]*imB[k]);
      phsB[k] = Math.atan2(imB[k], reB[k]);
    }

    if (canWarp) {
      // Interpolate pitch in semitone space so the glide sounds musical
      const semitones   = t * 12 * Math.log2(pitchB / pitchA);
      const pitchInterp = pitchA * Math.pow(2, semitones / 12);

      // Warp ratios: output bin k reads from bin k/warpX in each source spectrum.
      // This moves each source's spectral peaks to the interpolated pitch.
      const warpA = pitchInterp / pitchA;
      const warpB = pitchInterp / pitchB;

      for (let k = 0; k <= HALF; k++) {
        const kA = k / warpA;
        const kB = k / warpB;

        // Linear interpolation at fractional bin kA inside A's spectrum
        let mA = 0, pA = 0;
        if (kA >= 0 && kA < HALF - 1) {
          const i0 = kA | 0, f = kA - i0;
          mA = magA[i0] + f * (magA[i0 + 1] - magA[i0]);
          pA = phsA[i0] + f * wrapPhase(phsA[i0 + 1] - phsA[i0]);
        }

        // Linear interpolation at fractional bin kB inside B's spectrum
        let mB = 0, pB = 0;
        if (kB >= 0 && kB < HALF - 1) {
          const i0 = kB | 0, f = kB - i0;
          mB = magB[i0] + f * (magB[i0 + 1] - magB[i0]);
          pB = phsB[i0] + f * wrapPhase(phsB[i0 + 1] - phsB[i0]);
        }

        const mag = (1 - t) * mA + t * mB;
        const ph  = pA + t * wrapPhase(pB - pA);
        reO[k] = mag * Math.cos(ph);
        imO[k] = mag * Math.sin(ph);

        // Enforce conjugate symmetry so IFFT output is real
        if (k > 0 && k < HALF) {
          reO[FFT - k] =  reO[k];
          imO[FFT - k] = -imO[k];
        }
      }
    } else {
      // No clear pitch in one or both clips — plain spectral blend (original behaviour)
      for (let k = 0; k < FFT; k++) {
        const mag = (1 - t) * magA[k] + t * magB[k];
        const ph  = phsA[k] + t * wrapPhase(phsB[k] - phsA[k]);
        reO[k] = mag * Math.cos(ph);
        imO[k] = mag * Math.sin(ph);
      }
    }

    ifft(reO, imO);

    const outPos = frame * HOP;
    for (let i = 0; i < FFT; i++) {
      if (outPos + i < outputBuf.length) outputBuf[outPos + i] += reO[i] * win[i];
    }
  }

  // OLA normalisation for Hann at 75% overlap
  const OLA = 1.5;
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
    const blob    = new Blob([WORKER_SRC], { type: 'application/javascript' })
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
