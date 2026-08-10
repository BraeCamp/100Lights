// lib/transcribe-confidence.ts
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// lib/audio-shape.ts
var N = 2048;
var HOP = 512;
function analyzeFrames(samples, sr) {
  const half = N / 2, binHz = sr / N;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N);
  const rms = [], centroid = [], pitch = [];
  const minLag = Math.max(2, Math.floor(sr / 1e3)), maxLag = Math.min(N - 1, Math.floor(sr / 55));
  for (let s = 0; s + N <= samples.length; s += HOP) {
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[s + i];
      e += v * v;
    }
    rms.push(Math.sqrt(e / N));
    let f0 = 0;
    if (e > 1e-6) {
      let bestLag = 0, best = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let ac = 0;
        for (let i = 0; i < N - lag; i++) ac += samples[s + i] * samples[s + i + lag];
        const norm = ac / e;
        if (norm > best) {
          best = norm;
          bestLag = lag;
        }
      }
      if (best > 0.3 && bestLag > 0) f0 = sr / bestLag;
    }
    pitch.push(f0);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < N; i++) re[i] = samples[s + i] * win[i];
    fftInPlace(re, im);
    let num = 0, den = 0;
    for (let i = 1; i < half; i++) {
      const m = Math.hypot(re[i], im[i]);
      num += i * binHz * m;
      den += m;
    }
    centroid.push(den > 1e-9 ? num / den : 0);
  }
  return { rms, centroid, pitch, frameRate: sr / HOP, sr, samples };
}
var median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
var pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
function oscillation(contour, frameRate, loHz, hiHz) {
  if (contour.length < 8) return null;
  const w = Math.max(3, Math.round(frameRate / loHz * 1.5));
  const de = contour.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(contour.length - 1, i + w); j++) {
      sum += contour[j];
      n++;
    }
    return contour[i] - sum / n;
  });
  const minLag = Math.max(1, Math.floor(frameRate / hiHz)), maxLag = Math.floor(frameRate / loHz);
  let e0 = 0;
  for (const v of de) e0 += v * v;
  if (e0 < 1e-12) return null;
  let bestLag = 0, best = 0;
  for (let lag = minLag; lag <= maxLag && lag < de.length; lag++) {
    let ac = 0;
    for (let i = 0; i < de.length - lag; i++) ac += de[i] * de[i + lag];
    const norm = ac / e0;
    if (norm > best) {
      best = norm;
      bestLag = lag;
    }
  }
  if (best < 0.3 || !bestLag) return null;
  const rms = Math.sqrt(e0 / de.length);
  return { rateHz: frameRate / bestLag, depth: rms * Math.SQRT2 };
}
function analyzeShaping(samples, sr) {
  const f = analyzeFrames(samples, sr);
  const peak = Math.max(1e-9, ...f.rms);
  const loudIdx = f.rms.map((r, i) => r > 0.25 * peak ? i : -1).filter((i) => i >= 0);
  const brights = loudIdx.map((i) => f.centroid[i]).filter((c) => c > 0);
  const brightnessHz = median(brights);
  const filterMotion = brightnessHz > 0 ? Math.min(1, (pct(brights, 0.9) - pct(brights, 0.1)) / brightnessHz) : 0;
  let vibrato = null;
  {
    const runs = [];
    let cur = [];
    for (let k = 0; k < f.pitch.length; k++) {
      const p = f.pitch[k];
      if (p > 0 && f.rms[k] > 0.2 * peak) {
        if (cur.length) {
          const step = Math.abs(1200 * Math.log2(p / f.pitch[cur[cur.length - 1]]));
          if (step > 60) {
            runs.push(cur);
            cur = [];
          }
        }
        cur.push(k);
      } else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    const minLen = Math.round(f.frameRate * 0.2);
    let best = null;
    for (const run of runs) {
      if (run.length < minLen) continue;
      const ref = median(run.map((k) => f.pitch[k]));
      const cents = run.map((k) => 1200 * Math.log2(f.pitch[k] / ref));
      const osc = oscillation(cents, f.frameRate, 3.5, 9);
      if (osc && osc.depth > 12 && (!best || osc.depth > best.depth)) best = osc;
    }
    if (best) vibrato = { rateHz: +best.rateHz.toFixed(1), depthCents: Math.round(best.depth) };
  }
  let tremolo = null;
  const env = loudIdx.map((i) => f.rms[i]);
  if (env.length >= 8) {
    const meanEnv = env.reduce((s, v) => s + v, 0) / env.length;
    const osc = oscillation(env, f.frameRate, 3, 9);
    if (osc && meanEnv > 1e-6 && osc.depth / meanEnv > 0.12) tremolo = { rateHz: +osc.rateHz.toFixed(1), depth: +Math.min(1, osc.depth / meanEnv).toFixed(2) };
  }
  const drive = estimateDrive(f, loudIdx, peak);
  const reverb = estimateReverb(f.rms, peak);
  const slide = estimateSlide(f.pitch, f.rms, peak, f.frameRate);
  return { brightnessHz: Math.round(brightnessHz), filterMotion: +filterMotion.toFixed(2), vibrato, tremolo, drive: +drive.toFixed(2), reverb: +reverb.toFixed(2), slide: +slide.toFixed(2) };
}
function estimateDrive(f, loudIdx, peak) {
  if (!loudIdx.length) return 0;
  let bi = -1, bv = 0;
  for (const i of loudIdx) if (f.pitch[i] > 0 && f.rms[i] > bv) {
    bv = f.rms[i];
    bi = i;
  }
  if (bi < 0) return 0;
  const s = Math.min(bi * HOP, f.samples.length - N);
  if (s < 0) return 0;
  const re = new Float32Array(N), im = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  for (let i = 0; i < N; i++) re[i] = f.samples[s + i] * win[i];
  fftInPlace(re, im);
  const half = N / 2, binHz = f.sr / N, f0 = f.pitch[bi];
  const magAt = (hz) => {
    const b = Math.round(hz / binHz);
    let m = 0;
    for (let k = b - 1; k <= b + 1; k++) if (k > 0 && k < half) m = Math.max(m, Math.hypot(re[k], im[k]));
    return m;
  };
  let low = 0, high = 0;
  for (let h = 1; h <= 4; h++) low += magAt(h * f0);
  for (let h = 5; h <= 12; h++) high += magAt(h * f0);
  return low + high < 1e-9 ? 0 : Math.min(1, high / (low + high) * 1.6);
}
function estimateReverb(rms, peak) {
  if (rms.length < 6) return 0;
  let tail = 0, n = 0;
  for (const r of rms) {
    const rel = r / peak;
    if (rel > 0.03 && rel < 0.3) {
      tail += rel;
      n++;
    }
  }
  return n ? Math.min(1, tail / rms.length * 4) : 0;
}
function estimateSlide(pitch, rms, peak, frameRate) {
  const minRun = Math.max(2, Math.round(frameRate * 0.04));
  let glides = 0, jumps = 0, i = 1;
  while (i < pitch.length) {
    if (pitch[i] <= 0 || pitch[i - 1] <= 0 || rms[i] < 0.2 * peak) {
      i++;
      continue;
    }
    const step = 1200 * Math.log2(pitch[i] / pitch[i - 1]);
    if (Math.abs(step) > 250) {
      jumps++;
      i++;
      continue;
    }
    if (Math.abs(step) > 15) {
      const up = step > 0;
      let total = step, run = 1, j = i;
      while (j + 1 < pitch.length && pitch[j + 1] > 0) {
        const s2 = 1200 * Math.log2(pitch[j + 1] / pitch[j]);
        if (s2 > 0 === up && Math.abs(s2) > 2 && Math.abs(s2) < 250) {
          total += s2;
          run++;
          j++;
        } else break;
      }
      if (run >= minRun && Math.abs(total) > 120) {
        glides++;
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return glides + jumps ? glides / (glides + jumps) : 0;
}
function shapeToRollFx(d) {
  const rollFx = {};
  if (d.filterMotion > 0.25 || d.brightnessHz < 3e3) rollFx.filterHz = Math.round(d.brightnessHz);
  if (d.vibrato) {
    rollFx.vibratoDepth = Math.min(1, d.vibrato.depthCents / 100);
    rollFx.vibratoRate = d.vibrato.rateHz;
  }
  if (d.tremolo) rollFx.tremolo = d.tremolo.depth;
  if (d.drive > 0.15) rollFx.drive = d.drive;
  if (d.reverb > 0.2) rollFx.reverbWet = d.reverb;
  return { rollFx, articulation: d.slide > 0.3 ? "slide" : void 0 };
}
export {
  analyzeShaping,
  shapeToRollFx
};
