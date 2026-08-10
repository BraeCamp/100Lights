// lib/pitch-detector.ts
function extractNoteEvents(pitchCurve, minDuration = 0.04) {
  if (pitchCurve.length < 2) return [];
  const events = [];
  let noteStart = -1, noteMidi = -1, ampSum = 0, ampCount = 0, silenceFrames = 0;
  const hopSec = pitchCurve.length > 1 ? pitchCurve[1].time - pitchCurve[0].time : 0.012;
  const maxSilence = Math.ceil(0.06 / hopSec);
  const flush = (endTime) => {
    if (noteStart >= 0 && endTime - noteStart >= minDuration)
      events.push({ start: noteStart, end: endTime, midi: noteMidi, amplitude: Math.min(0.9, ampSum / ampCount * 0.9) });
    noteStart = -1;
    silenceFrames = 0;
  };
  for (const frame of pitchCurve) {
    if (frame.midi !== null && frame.amplitude > 0.025) {
      const r = Math.round(frame.midi);
      if (noteStart < 0) {
        noteStart = frame.time;
        noteMidi = r;
        ampSum = frame.amplitude;
        ampCount = 1;
        silenceFrames = 0;
      } else if (Math.abs(r - noteMidi) <= 1) {
        ampSum += frame.amplitude;
        ampCount++;
        silenceFrames = 0;
      } else {
        flush(frame.time);
        noteStart = frame.time;
        noteMidi = r;
        ampSum = frame.amplitude;
        ampCount = 1;
      }
    } else {
      if (noteStart >= 0) {
        silenceFrames++;
        if (silenceFrames > maxSilence) flush(frame.time);
      }
    }
  }
  flush(pitchCurve[pitchCurve.length - 1].time + 0.02);
  return events;
}
var HANN_SIZE = 4096;
var HANN = (() => {
  const w = new Float32Array(HANN_SIZE);
  for (let i = 0; i < HANN_SIZE; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (HANN_SIZE - 1));
  return w;
})();
function yinDetect(windowed, sr) {
  const N = windowed.length;
  const half = N >> 1;
  const minTau = Math.ceil(sr / 1200);
  const maxTau = Math.floor(sr / 70);
  const clamp2 = Math.min(maxTau, half - 2);
  const d = new Float32Array(clamp2 + 1);
  for (let tau2 = minTau; tau2 <= clamp2; tau2++) {
    let s = 0;
    for (let j = 0; j < half; j++) {
      const delta = windowed[j] - windowed[j + tau2];
      s += delta * delta;
    }
    d[tau2] = s;
  }
  const cmnd = new Float32Array(clamp2 + 1);
  cmnd[0] = 1;
  let runSum = 0;
  for (let tau2 = 1; tau2 <= clamp2; tau2++) {
    runSum += d[tau2];
    cmnd[tau2] = runSum > 0 ? d[tau2] * tau2 / runSum : 1;
  }
  const THRESHOLD = 0.12;
  let tau = minTau;
  while (tau <= clamp2 - 1) {
    if (cmnd[tau] < THRESHOLD) {
      while (tau + 1 <= clamp2 && cmnd[tau + 1] < cmnd[tau]) tau++;
      break;
    }
    tau++;
  }
  if (tau >= clamp2) return null;
  const a = tau > 0 ? cmnd[tau - 1] : cmnd[tau];
  const b = cmnd[tau];
  const c = tau < clamp2 ? cmnd[tau + 1] : cmnd[tau];
  const den = 2 * (2 * b - a - c);
  const fine = den === 0 ? tau : tau + (a - c) / den;
  if (fine <= 0) return null;
  return { hz: sr / fine, confidence: 1 - b };
}
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function detectBufferPitch(samples, sampleRate, offset = 0, confFloor = 0.55) {
  const size = Math.min(HANN_SIZE, samples.length - offset);
  if (size < 1024) return null;
  const windowed = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    windowed[i] = samples[offset + i] * HANN[Math.floor(i * HANN_SIZE / size)];
  }
  const r = yinDetect(windowed, sampleRate);
  if (!r || r.confidence < confFloor) return null;
  const midi = Math.round(69 + 12 * Math.log2(r.hz / 440));
  return { hz: r.hz, midi, confidence: r.confidence };
}

// lib/voice-hmm.ts
function resolve(o) {
  const d = o ?? {};
  const keepBias = Math.max(0, Math.min(1, d.keepBias ?? 0));
  const silenceBias0 = d.silenceBias ?? 0.35;
  const unvoicedPenalty0 = d.unvoicedNotePenalty ?? 6;
  const lowEnergyPen0 = d.lowEnergyNotePenalty ?? 2.5;
  return {
    sigma: d.sigma ?? 0.6,
    distanceCapSemitones: d.distanceCapSemitones ?? 2.5,
    confWeight: d.confWeight ?? 1.5,
    energyWeight: d.energyWeight ?? 1,
    // keepBias lowers silence's baseline and the quiet/unvoiced note penalties, tilting
    // borderline frames toward notes. Unvoiced penalty is floored at 3.5 so an all-unvoiced
    // (silent) buffer still decodes to silence (3.5 ≫ silenceBias) — no phantom notes.
    unvoicedNotePenalty: Math.max(3.5, unvoicedPenalty0 - 2.5 * keepBias),
    lowEnergyNotePenalty: Math.max(0.5, lowEnergyPen0 - 1.5 * keepBias),
    energyGate: d.energyGate ?? 0.05,
    silenceBias: silenceBias0 - 0.4 * keepBias,
    silenceLoudPenalty: d.silenceLoudPenalty ?? 6,
    selfLoopBonus: d.selfLoopBonus ?? 2,
    enterNotePenalty: d.enterNotePenalty ?? -4,
    exitNotePenalty: d.exitNotePenalty ?? -4,
    noteChangePenalty: d.noteChangePenalty ?? -3,
    jumpPenaltyPerSemitone: d.jumpPenaltyPerSemitone ?? 1.2,
    onsetTransitionBonus: d.onsetTransitionBonus ?? 6,
    reartPenalty: d.reartPenalty ?? -40,
    reartOnsetBonus: d.reartOnsetBonus ?? 45,
    minDurationSec: d.minDurationSec ?? 0.05,
    tuning: d.tuning ?? "auto",
    tuningConfFloor: d.tuningConfFloor ?? 0.5,
    transitionWindow: d.transitionWindow ?? 12,
    noteRangeLo: d.noteRangeLo ?? 36,
    noteRangeHi: d.noteRangeHi ?? 84
  };
}
var NEG_INF = -Infinity;
function estimateTuning(frames, confFloor) {
  const offs = [];
  for (const f of frames) {
    if (f.midi == null || f.conf < confFloor) continue;
    offs.push(f.midi - Math.round(f.midi));
  }
  if (offs.length === 0) return 0;
  offs.sort((a, b) => a - b);
  const m = offs.length >> 1;
  return offs.length % 2 ? offs[m] : (offs[m - 1] + offs[m]) / 2;
}
function deriveRange(frames, r) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const f of frames) {
    if (f.midi == null) continue;
    if (f.midi < mn) mn = f.midi;
    if (f.midi > mx) mx = f.midi;
  }
  if (!isFinite(mn)) {
    return { lo: r.noteRangeLo, hi: r.noteRangeLo };
  }
  let lo = Math.floor(mn) - 1;
  let hi = Math.ceil(mx) + 1;
  lo = Math.max(r.noteRangeLo, lo);
  hi = Math.min(r.noteRangeHi, hi);
  if (hi < lo) hi = lo;
  return { lo, hi };
}
function emitSilence(f, r) {
  let e = r.silenceBias;
  if (f.midi != null) e -= r.silenceLoudPenalty * f.conf * f.energy;
  return e;
}
function emitNote(f, n, r, tuning, cap2, twoSigma2) {
  if (f.midi == null) return -r.unvoicedNotePenalty;
  const d = f.midi - (n + tuning);
  const d2 = Math.min(d * d, cap2);
  let e = -d2 / twoSigma2 + r.confWeight * f.conf + r.energyWeight * f.energy;
  if (f.energy < r.energyGate) e -= r.lowEnergyNotePenalty;
  return e;
}
function trackNotesHMM(frames, opts) {
  const r = resolve(opts);
  const T = frames.length;
  if (T === 0) return [];
  const hop = T > 1 ? frames[1].time - frames[0].time : 0.01;
  const tuning = r.tuning === "auto" ? estimateTuning(frames, r.tuningConfFloor) : r.tuning;
  const { lo, hi } = deriveRange(frames, r);
  const K = hi - lo + 1;
  const cap2 = r.distanceCapSemitones * r.distanceCapSemitones;
  const twoSigma2 = 2 * r.sigma * r.sigma;
  const win = r.transitionWindow;
  const S = 1 + 2 * K;
  const SIL = 0;
  const atk = (k) => 1 + 2 * k;
  const sus = (k) => 2 + 2 * k;
  const emNote = new Float64Array(K);
  const fillEmissions = (t) => {
    const f = frames[t];
    for (let k = 0; k < K; k++) emNote[k] = emitNote(f, lo + k, r, tuning, cap2, twoSigma2);
  };
  let prev = new Float64Array(S).fill(NEG_INF);
  let cur = new Float64Array(S);
  const back = new Array(T);
  {
    const f = frames[0];
    fillEmissions(0);
    const b0 = new Int32Array(S).fill(-1);
    prev[SIL] = emitSilence(f, r);
    const enter0 = r.enterNotePenalty + r.onsetTransitionBonus * f.onset;
    for (let k = 0; k < K; k++) {
      prev[atk(k)] = enter0 + emNote[k];
      prev[sus(k)] = NEG_INF;
    }
    back[0] = b0;
  }
  for (let t = 1; t < T; t++) {
    const f = frames[t];
    fillEmissions(t);
    cur.fill(NEG_INF);
    const b = new Int32Array(S).fill(-1);
    const emSil = emitSilence(f, r);
    const onsetBonus = r.onsetTransitionBonus * f.onset;
    const relax = (target, score, src) => {
      if (score > cur[target]) {
        cur[target] = score;
        b[target] = src;
      }
    };
    const pSil = prev[SIL];
    if (pSil > NEG_INF) {
      relax(SIL, pSil + r.selfLoopBonus + emSil, SIL);
      const enter = pSil + r.enterNotePenalty + onsetBonus;
      for (let k = 0; k < K; k++) relax(atk(k), enter + emNote[k], SIL);
    }
    for (let k = 0; k < K; k++) {
      const nA = atk(k);
      const nS = sus(k);
      const pA = prev[nA];
      const pS = prev[nS];
      const best = pA > pS ? pA : pS;
      if (best <= NEG_INF) continue;
      if (pA > NEG_INF) relax(nS, pA + r.selfLoopBonus + emNote[k], nA);
      if (pS > NEG_INF) relax(nS, pS + r.selfLoopBonus + emNote[k], nS);
      const reart = best + r.reartPenalty + r.reartOnsetBonus * f.onset + emNote[k];
      const reartSrc = pA >= pS ? nA : nS;
      relax(nA, reart, reartSrc);
      const mLo = Math.max(0, k - win);
      const mHi = Math.min(K - 1, k + win);
      for (let m = mLo; m <= mHi; m++) {
        if (m === k) continue;
        const dist = Math.abs(m - k);
        const chg = best + r.noteChangePenalty - r.jumpPenaltyPerSemitone * dist + onsetBonus + emNote[m];
        relax(atk(m), chg, reartSrc);
      }
      relax(SIL, best + r.exitNotePenalty + emSil, reartSrc);
    }
    back[t] = b;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  let bestState = 0;
  let bestScore = NEG_INF;
  for (let s2 = 0; s2 < S; s2++) {
    if (prev[s2] > bestScore) {
      bestScore = prev[s2];
      bestState = s2;
    }
  }
  const path = new Int32Array(T);
  let s = bestState;
  for (let t = T - 1; t >= 0; t--) {
    path[t] = s;
    s = back[t][s];
    if (s < 0 && t > 0) s = SIL;
  }
  const out = [];
  let openNote = -1;
  let startFrame = 0;
  let energySum = 0;
  let nFrames = 0;
  const closeNote = (endExclusive) => {
    if (openNote < 0) return;
    const durSec = nFrames * hop;
    const meanE = nFrames > 0 ? energySum / nFrames : 0;
    const velocity = Math.min(1, Math.max(0.3, meanE));
    if (durSec >= r.minDurationSec) {
      out.push({ startSec: frames[startFrame].time, midi: openNote, durSec, velocity });
    }
    openNote = -1;
    energySum = 0;
    nFrames = 0;
    void endExclusive;
  };
  for (let t = 0; t < T; t++) {
    const st = path[t];
    if (st === SIL) {
      closeNote(t);
      continue;
    }
    const isAttack = (st - 1) % 2 === 0;
    const k = st - 1 >> 1;
    const note = lo + k;
    if (isAttack) {
      closeNote(t);
      openNote = note;
      startFrame = t;
      energySum = frames[t].energy;
      nFrames = 1;
    } else {
      if (openNote === note) {
        energySum += frames[t].energy;
        nFrames++;
      } else {
        closeNote(t);
        openNote = note;
        startFrame = t;
        energySum = frames[t].energy;
        nFrames = 1;
      }
    }
  }
  closeNote(T);
  return out;
}

// scripts/listen-analyzer.mjs
function fft(re, im) {
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
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const vr = re[b] * cwr - im[b] * cwi, vi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const ncwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = ncwr;
      }
    }
  }
}

// lib/voice-backfill.ts
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var DEFAULT_TARGET_SR = 22050;
var DEFAULT_HOP_SEC = 0.01;
var DEFAULT_OCTAVE_RADIUS = 2;
var DEFAULT_ATTACK_SKIP_SEC = 0.04;
var DEFAULT_MAX_SKIP_FRAC = 0.35;
var DEFAULT_RELEASE_SKIP_SEC = 0.01;
var MIN_STABLE_FRAMES = 3;
var DEFAULT_ONSET_SENS = 0.5;
var DEFAULT_LOW_WIN_SEC = 0.12;
var DEFAULT_ADAPTIVE_LOW_HZ = 165;
var YIN_MAX_WIN = 4096;
var DEFAULT_VALLEY_DEPTH = 0.22;
var DEFAULT_SENSITIVITY = 0.5;
var FLUX_MAX_FFT = 2048;
var DEFAULT_SEGMENTER = "hmm";
var HMM_ONSET_SAT = 0.5;
var HMM_ONSET_FLOOR = 0.5;
var HMM_REPITCH = false;
var SCOOP_MERGE_MAX_DUR = 0.18;
var SCOOP_MERGE_SEMI_TOL = 1.5;
var SCOOP_MERGE_ONSET_HOPS = 1;
var SCOOP_MERGE_MAX_GAP_SEC = 0.05;
var SCOOP_MERGE_SILENCE_AMP = 0.04;
var SCOOP_MERGE_HARMONIC_SEMI = [12, 24];
var SCOOP_MERGE_HARMONIC_TOL = 1.5;
var SCOOP_MERGE_GLIDE_SEMI = 3.5;
var SCOOP_MERGE_GLIDE_DOMINANCE = 2.5;
var HELD_MERGE_VALLEY_RATIO = 0.7;
var HELD_MERGE_MAX_GAP_SEC = 0.12;
var HELD_MERGE_PITCH_TOL = 0.5;
var FLUX_BANDS = 32;
var sensOf = (opts) => clamp(opts.sensitivity ?? DEFAULT_SENSITIVITY, 0, 1);
function existFracFor(opts) {
  if (opts.volumeExistFrac !== void 0) return Math.max(0, opts.volumeExistFrac);
  return clamp(0.09 - 0.06 * sensOf(opts), 0.02, 0.12);
}
function voicingFloorFor(opts) {
  if (opts.clarityFloor !== void 0) return clamp(opts.clarityFloor, 0.1, 0.9);
  return clamp(0.5 - 0.25 * sensOf(opts), 0.2, 0.55);
}
var keepBiasFor = (opts) => sensOf(opts);
var segClarityGateFor = (opts) => clamp(SEG_CLARITY_GATE - 0.2 * sensOf(opts), 0.28, 0.5);
var defaultWin = (sr) => Math.max(1024, Math.round(sr * 0.06));
var VOCAL_BANDS = [
  { name: "sub", lo: 20, hi: 100 },
  { name: "bass", lo: 100, hi: 300 },
  { name: "mid", lo: 300, hi: 1e3 },
  { name: "treble", lo: 1e3, hi: 6e3 }
];
var FUND_OCTAVE_TOL_SEMI = 1.5;
var FUND_CLARITY_FRAC = 0.85;
var FUND_CLARITY_ABS = 0.5;
var FUND_SCORE_FRAC = 0.03;
function aWeightingGain(f) {
  if (!(f > 0)) return 0;
  const f2 = f * f;
  const num = 12194 * 12194 * f2 * f2;
  const den = (f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194);
  const ra = num / den;
  const db = 20 * Math.log10(ra) + 2;
  return Math.pow(10, db / 20);
}
var bandCenter = (b) => Math.sqrt(Math.max(1e-6, b.lo * b.hi));
function bandpassCoeffs(lo, hi, sr) {
  const fc = Math.sqrt(Math.max(1e-6, lo * hi));
  const w0 = 2 * Math.PI * Math.min(fc, sr * 0.49) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const Q = Math.max(0.5, fc / Math.max(1, hi - lo));
  const alpha = sw / (2 * Q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: -2 * cw / a0, a2: (1 - alpha) / a0 };
}
function applyBiquad(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}
function bandpassFilter(x, lo, hi, sr) {
  const c = bandpassCoeffs(lo, hi, sr);
  return applyBiquad(applyBiquad(x, c), c);
}
function resampleMono(samples, srcRate, dstRate) {
  if (!(dstRate > 0) || dstRate >= srcRate || samples.length === 0) {
    return { buf: samples, rate: srcRate };
  }
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s0 = Math.floor(i * ratio);
    const s1 = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0, cnt = 0;
    for (let j = s0; j < s1; j++) {
      sum += samples[j];
      cnt++;
    }
    out[i] = cnt > 0 ? sum / cnt : samples[s0] ?? 0;
  }
  return { buf: out, rate: dstRate };
}
function scanParamsFrom(opts, sampleRate) {
  const win = opts.winSize ?? defaultWin(sampleRate);
  const lowWin = Math.min(YIN_MAX_WIN, Math.max(win, Math.round((opts.lowWinSec ?? DEFAULT_LOW_WIN_SEC) * sampleRate)));
  return {
    win,
    rmsGate: opts.rmsGate ?? 6e-3,
    sampleRate,
    adaptive: opts.adaptiveWindow !== false,
    lowWin,
    lowHz: opts.adaptiveLowHz ?? DEFAULT_ADAPTIVE_LOW_HZ,
    confFloor: voicingFloorFor(opts)
  };
}
function pow2Down(n) {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}
function makeScanState(win) {
  const fftSize = Math.min(FLUX_MAX_FFT, Math.max(256, pow2Down(win)));
  const hann = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
  return {
    fftSize,
    hann,
    re: new Float64Array(fftSize),
    im: new Float64Array(fftSize),
    band: new Float64Array(FLUX_BANDS),
    prevBand: new Float64Array(FLUX_BANDS),
    prevRms: 0,
    prevMidi: null,
    first: true
  };
}
function detectFramePitch(buf, off, seg, rms, p) {
  if (rms < p.rmsGate) return { freq: null, midi: null, clarity: 0 };
  let det = detectBufferPitch(seg, p.sampleRate, 0, p.confFloor);
  if (p.adaptive && p.lowWin > p.win && (det === null || det.hz < p.lowHz)) {
    let pStart = off, pEnd = off + p.lowWin;
    if (pEnd > buf.length) {
      pEnd = buf.length;
      pStart = Math.max(0, pEnd - p.lowWin);
    }
    if (pEnd - pStart >= TAIL_MIN_SAMPLES) {
      const longDet = detectBufferPitch(buf.subarray(pStart, pEnd), p.sampleRate, 0, p.confFloor);
      if (longDet && (det === null || longDet.confidence >= det.confidence)) det = longDet;
    }
  }
  return det ? { freq: det.hz, midi: det.midi, clarity: det.confidence } : { freq: null, midi: null, clarity: 0 };
}
function scanFeatureFrame(buf, off, p, st) {
  const seg = buf.subarray(off, off + p.win);
  let sq = 0;
  for (let i = 0; i < seg.length; i++) sq += seg[i] * seg[i];
  const rms = Math.sqrt(sq / seg.length);
  const amplitude = Math.min(1, rms * 4);
  const { fftSize, hann, re, im, band, prevBand } = st;
  const half = fftSize >> 1;
  for (let i = 0; i < fftSize; i++) {
    re[i] = (off + i < buf.length ? buf[off + i] : 0) * hann[i];
    im[i] = 0;
  }
  fft(re, im);
  const nb = band.length;
  band.fill(0);
  const binsPerBand = (half - 1) / nb;
  for (let i = 1; i < half; i++) {
    const b = Math.min(nb - 1, Math.floor((i - 1) / binsPerBand));
    band[b] += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  let flux = 0;
  for (let b = 0; b < nb; b++) {
    const d = band[b] - prevBand[b];
    if (d > 0) flux += d;
    prevBand[b] = band[b];
  }
  if (st.first) {
    flux = 0;
    st.first = false;
  }
  const { freq, midi, clarity } = detectFramePitch(buf, off, seg, rms, p);
  const energyDelta = rms - st.prevRms;
  st.prevRms = rms;
  const pitchDelta = midi !== null && st.prevMidi !== null ? Math.abs(midi - st.prevMidi) : 0;
  st.prevMidi = midi;
  return { time: off / p.sampleRate, freq, amplitude, midi, flux, clarity, energyDelta, pitchDelta, rms };
}
var TAIL_MIN_SAMPLES = 1024;
function appendTailFrames(frames, buf, p, st, hop, enabled) {
  if (!enabled || buf.length < p.win) return;
  const lastOff = frames.length ? Math.round(frames[frames.length - 1].time * p.sampleRate) : -hop;
  for (let off = lastOff + hop; off + p.win > buf.length && off + TAIL_MIN_SAMPLES <= buf.length; off += hop) {
    frames.push(scanFeatureFrame(buf, off, p, st));
  }
}
function medianFilterMidi(frames, rMed) {
  if (rMed === 0) return frames;
  return frames.map((f, i) => {
    if (f.midi === null) return f;
    const vals = [];
    for (let k = -rMed; k <= rMed; k++) {
      const g = frames[i + k];
      if (g && g.midi !== null) vals.push(g.midi);
    }
    if (vals.length === 0) return f;
    vals.sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    return med === f.midi ? f : { ...f, midi: med, freq: midiToFreq(med) };
  });
}
function correctOctaves(frames, radius) {
  if (radius <= 0) return frames;
  const orig = frames.map((f) => f.midi);
  return frames.map((f, i) => {
    if (f.midi === null) return f;
    const vals = [];
    for (let k = -radius; k <= radius; k++) {
      if (k === 0) continue;
      const m = orig[i + k];
      if (m !== null && m !== void 0) vals.push(m);
    }
    if (vals.length < 2) return f;
    vals.sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const diff = f.midi - med;
    const octaves = Math.round(diff / 12);
    if (octaves !== 0 && Math.abs(diff - octaves * 12) <= 1) {
      const snapped = f.midi - octaves * 12;
      return { ...f, midi: snapped, freq: midiToFreq(snapped) };
    }
    return f;
  });
}
function refinePitchTrack(frames, rMed, octaveRadius) {
  let out = medianFilterMidi(frames, rMed);
  out = correctOctaves(out, octaveRadius);
  out = medianFilterMidi(out, rMed);
  return out;
}
var applyGain = (samples, gain) => gain === 1 ? samples : Float32Array.from(samples, (v) => clamp(v * gain, -1, 1));
function eventsToNotes(events, minDuration) {
  return events.map((e) => ({
    startSec: e.start,
    midi: e.midi,
    durSec: Math.max(minDuration, e.end - e.start),
    // e.amplitude is capped at 0.9 by extractNoteEvents; map to a 0.3–1 velocity.
    velocity: clamp(0.3 + e.amplitude, 0.3, 1)
  }));
}
function fractionalMidi(f) {
  if (f.freq !== null && f.freq > 0) return 69 + 12 * Math.log2(f.freq / 440);
  return f.midi ?? 0;
}
function weightedMedian(pairs) {
  if (pairs.length === 0) return 0;
  const sorted = pairs.slice().sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  if (!(total > 0)) return sorted[Math.floor(sorted.length / 2)].v;
  const half = total / 2;
  let cum = 0;
  for (const x of sorted) {
    cum += x.w;
    if (cum >= half) return x.v;
  }
  return sorted[sorted.length - 1].v;
}
function repitchNotes(notes, curve, opts = {}) {
  const attackSkipSec = Math.max(0, opts.attackSkipSec ?? DEFAULT_ATTACK_SKIP_SEC);
  const maxSkipFrac = clamp(opts.maxSkipFrac ?? DEFAULT_MAX_SKIP_FRAC, 0, 0.49);
  const releaseSkipSec = Math.max(0, opts.releaseSkipSec ?? DEFAULT_RELEASE_SKIP_SEC);
  if (curve.length === 0) return notes.map((n) => ({ ...n }));
  const EPS = 1e-9;
  return notes.map((n) => {
    const start = n.startSec;
    const end = n.startSec + n.durSec;
    const dur = Math.max(0, n.durSec);
    const cap = maxSkipFrac * dur;
    const skip = Math.min(attackSkipSec, cap);
    const rel = Math.min(releaseSkipSec, cap);
    const stableStart = start + skip;
    const stableEnd = end - rel;
    const inSpan = curve.filter((f) => f.midi !== null && f.time >= start - EPS && f.time <= end + EPS);
    if (inSpan.length === 0) return { ...n };
    let stable = inSpan.filter((f) => f.time >= stableStart - EPS && f.time <= stableEnd + EPS);
    if (stable.length < MIN_STABLE_FRAMES) stable = inSpan;
    const center = weightedMedian(stable.map((f) => ({ v: fractionalMidi(f), w: Math.max(1e-6, f.amplitude) })));
    return { ...n, midi: Math.round(center) };
  });
}
function detectOnsetFrames(frames, hopSec, sensitivity) {
  const n = frames.length;
  if (n < 3) return [];
  let fluxMax = 1e-9, peakRms = 1e-9;
  for (const f of frames) {
    if (f.flux > fluxMax) fluxMax = f.flux;
    if (f.rms > peakRms) peakRms = f.rms;
  }
  const os = new Float64Array(n);
  for (let i = 0; i < n; i++) os[i] = frames[i].flux / fluxMax;
  const W = Math.max(3, Math.round(0.1 / hopSec));
  const k = 2.2 - 2 * clamp(sensitivity, 0, 1);
  const refractory = Math.max(1, Math.round(0.07 / hopSec));
  const FLOOR = 0.06;
  const MIN_RATIO = 1.8;
  const RISE_THR = 0.05 * peakRms;
  const ER = Math.max(1, Math.round(0.04 / hopSec));
  const meanRms = (lo, hi) => {
    let s = 0, c = 0;
    for (let j = lo; j <= hi; j++) {
      s += frames[j].rms;
      c++;
    }
    return c > 0 ? s / c : 0;
  };
  const onsets = [];
  let last = -1e9;
  for (let i = 1; i < n - 1; i++) {
    const v = os[i];
    if (v < FLOOR || v < os[i - 1] || v <= os[i + 1]) continue;
    if (i - last < refractory) continue;
    const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W);
    let sum = 0, sum2 = 0, cnt = 0;
    for (let j = lo; j <= hi; j++) {
      sum += os[j];
      sum2 += os[j] * os[j];
      cnt++;
    }
    const mean = sum / cnt;
    const std = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean));
    if (!(v > mean + k * std && v > mean * MIN_RATIO)) continue;
    const rmsBefore = meanRms(Math.max(0, i - ER), i - 1);
    const rmsAfter = meanRms(i + 1, Math.min(n - 1, i + ER));
    let mn = Infinity;
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) if (frames[j].rms < mn) mn = frames[j].rms;
    const rise = rmsAfter - rmsBefore > RISE_THR;
    const dip = mn < 0.82 * Math.min(rmsBefore, rmsAfter);
    if (rise || dip) {
      onsets.push(i);
      last = i;
    }
  }
  return onsets;
}
function detectVolumeValleys(frames, hopSec, minDurSec, depthFrac) {
  const n = frames.length;
  if (n < 5) return [];
  const rms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -1; k <= 1; k++) {
      const g = frames[i + k];
      if (g) {
        s += g.rms;
        c++;
      }
    }
    rms[i] = c > 0 ? s / c : frames[i].rms;
  }
  const V = Math.max(1, Math.round(0.03 / hopSec));
  const span = Math.max(V, Math.round(0.12 / hopSec));
  const refr = Math.max(1, Math.round(Math.max(minDurSec, 0.05) / hopSec));
  const out = [];
  let last = -1e9;
  for (let i = V; i < n - V; i++) {
    if (frames[i].midi === null) continue;
    let isMin = true;
    for (let k = -V; k <= V; k++) if (rms[i + k] < rms[i] - 1e-9) {
      isMin = false;
      break;
    }
    if (!isMin) continue;
    let pl = 0;
    for (let k = Math.max(0, i - span); k < i; k++) if (rms[k] > pl) pl = rms[k];
    let pr = 0;
    for (let k = i + 1; k <= Math.min(n - 1, i + span); k++) if (rms[k] > pr) pr = rms[k];
    const peak = Math.min(pl, pr);
    if (peak <= 0 || (peak - rms[i]) / peak < depthFrac) continue;
    if (i - last < refr) continue;
    out.push(i);
    last = i;
  }
  return out;
}
var PITCH_SPLIT_SEMI = 0.7;
var MIN_ONSET_SPLIT_SEC = 0.05;
var SEG_CLARITY_GATE = 0.5;
function segmentWithOnsets(curve, splitIdx, minDuration, useVolume, existFrac, clarityGate) {
  if (curve.length < 2) return [];
  const onsetSet = new Set(splitIdx);
  const AMP_GATE = 0.025;
  const hopSec = curve[1].time - curve[0].time || 0.012;
  const maxSilence = Math.ceil(0.06 / hopSec);
  let globalPeakAmp = 0;
  for (const f of curve) if (f.amplitude > globalPeakAmp) globalPeakAmp = f.amplitude;
  const existGate = useVolume ? existFrac * globalPeakAmp : 0;
  const events = [];
  let startIdx = -1, startTime = 0;
  let vSum = 0, wSum = 0;
  let ampSum = 0, ampCount = 0, silence = 0, ampPeak = 0;
  let pendingOnset = false;
  const frameW = (f) => Math.max(1e-3, f.clarity) * (useVolume ? Math.max(0.05, f.amplitude) : 1);
  const open = (i, f) => {
    const fm = fractionalMidi(f), w = frameW(f);
    startIdx = i;
    startTime = f.time;
    vSum = fm * w;
    wSum = w;
    ampSum = f.amplitude;
    ampCount = 1;
    silence = 0;
    ampPeak = f.amplitude;
  };
  const flush = (endTime) => {
    if (startIdx >= 0 && endTime - startTime >= minDuration && ampPeak >= existGate) {
      events.push({
        start: startTime,
        end: endTime,
        midi: Math.round(vSum / wSum),
        amplitude: Math.min(0.9, ampSum / ampCount * 0.9)
      });
    }
    startIdx = -1;
  };
  for (let i = 0; i < curve.length; i++) {
    const f = curve[i];
    const voiced = f.midi !== null && f.amplitude > AMP_GATE;
    if (onsetSet.has(i) && startIdx >= 0 && f.time - startTime >= MIN_ONSET_SPLIT_SEC) pendingOnset = true;
    if (voiced) {
      const fm = fractionalMidi(f);
      if (startIdx < 0) {
        open(i, f);
        pendingOnset = false;
        continue;
      }
      const curPitch = vSum / wSum;
      const pitchJump = f.clarity >= clarityGate && Math.abs(fm - curPitch) > PITCH_SPLIT_SEMI;
      if (pitchJump || pendingOnset) {
        flush(f.time);
        open(i, f);
        pendingOnset = false;
      } else {
        const w = frameW(f);
        vSum += fm * w;
        wSum += w;
        ampSum += f.amplitude;
        ampCount++;
        silence = 0;
        if (f.amplitude > ampPeak) ampPeak = f.amplitude;
      }
    } else if (startIdx >= 0) {
      silence++;
      if (silence > maxSilence) {
        flush(f.time);
        pendingOnset = false;
      }
    }
  }
  flush(curve[curve.length - 1].time + 0.02);
  return events;
}
function curveToHmmFrames(curve, onsetSet) {
  let fluxMax = 1e-9, rmsPeak = 1e-9;
  for (const f of curve) {
    if (f.flux > fluxMax) fluxMax = f.flux;
    if (f.rms > rmsPeak) rmsPeak = f.rms;
  }
  const fluxSat = Math.max(1e-9, HMM_ONSET_SAT * fluxMax);
  return curve.map((f, i) => ({
    time: f.time,
    midi: f.freq !== null && f.freq > 0 ? 69 + 12 * Math.log2(f.freq / 440) : null,
    conf: f.clarity,
    // Corroborated onset frame ⇒ full 1.0 (fires re-articulation); otherwise a small
    // flux-derived value capped below the re-artic gate (raw flux alone can't split).
    onset: onsetSet.has(i) ? 1 : Math.min(HMM_ONSET_FLOOR, f.flux / fluxSat),
    energy: Math.min(1, f.rms / rmsPeak)
  }));
}
function segmentWithHmm(curve, minDuration, onsetSet, keepBias) {
  if (curve.length < 2) return [];
  const notes = trackNotesHMM(curveToHmmFrames(curve, onsetSet), { minDurationSec: minDuration, keepBias });
  return notes.map((n) => ({
    startSec: n.startSec,
    midi: n.midi,
    durSec: Math.max(minDuration, n.durSec),
    velocity: clamp(n.velocity, 0.3, 1)
  }));
}
function recoverMissedNotes(notes, curve, opts, minDuration, existFrac) {
  const n = curve.length;
  if (n < 2) return notes;
  const s = sensOf(opts);
  const hopSec = Math.max(1e-4, curve[1].time - curve[0].time);
  const recovClarity = clamp(0.55 - 0.28 * s, 0.28, 0.6);
  const recovMinDur = clamp(0.1 - 0.035 * s, 0.055, 0.11);
  const STABLE_SEMI = 0.7;
  let peakAmp = 0;
  for (const f of curve) if (f.amplitude > peakAmp) peakAmp = f.amplitude;
  const ampFloor = Math.max(existFrac * peakAmp, 1e-4);
  const covered = new Uint8Array(n);
  const pad = hopSec * 0.5;
  for (const note of notes) {
    const a = note.startSec - pad, b = note.startSec + note.durSec + pad;
    for (let i = 0; i < n; i++) if (curve[i].time >= a && curve[i].time <= b) covered[i] = 1;
  }
  const candidate = (i) => {
    if (covered[i]) return false;
    const f = curve[i];
    return f.midi !== null && f.clarity >= recovClarity && f.amplitude >= ampFloor;
  };
  const recovered = [];
  let runStart = -1;
  let runMed = 0;
  const runVals = [];
  let runLoV = Infinity, runHiV = -Infinity, runPeak = 0;
  const closeRun = (endIdx) => {
    if (runStart < 0) {
      return;
    }
    const startT = curve[runStart].time;
    const endT = curve[endIdx - 1].time + hopSec;
    const dur = endT - startT;
    if (dur >= recovMinDur && runHiV - runLoV <= STABLE_SEMI + 0.5 && runPeak >= ampFloor) {
      const center = Math.round(weightedMedian(runVals));
      recovered.push({
        startSec: startT,
        midi: center,
        durSec: Math.max(minDuration, dur),
        velocity: clamp(0.3 + runPeak, 0.3, 1),
        recovered: true
      });
    }
    runStart = -1;
    runVals.length = 0;
    runLoV = Infinity;
    runHiV = -Infinity;
    runPeak = 0;
  };
  for (let i = 0; i < n; i++) {
    if (!candidate(i)) {
      closeRun(i);
      continue;
    }
    const f = curve[i];
    const fm = fractionalMidi(f);
    if (runStart < 0) {
      runStart = i;
      runMed = fm;
      runVals.length = 0;
      runLoV = Infinity;
      runHiV = -Infinity;
      runPeak = 0;
    } else if (Math.abs(fm - runMed) > STABLE_SEMI) {
      closeRun(i);
      runStart = i;
      runMed = fm;
    }
    runVals.push({ v: fm, w: Math.max(1e-3, f.amplitude) });
    if (fm < runLoV) runLoV = fm;
    if (fm > runHiV) runHiV = fm;
    if (f.amplitude > runPeak) runPeak = f.amplitude;
    runMed = weightedMedian(runVals);
  }
  closeRun(n);
  if (recovered.length === 0) return notes;
  return [...notes, ...recovered].sort((a, b) => a.startSec - b.startSec);
}
function mergeScoopFragments(notes, curve, onsetTimes, hopSec, minDuration) {
  if (notes.length < 2) return notes;
  const hop = Math.max(1e-4, hopSec);
  const onsetTol = SCOOP_MERGE_ONSET_HOPS * hop;
  const hasOnsetAt = (t) => onsetTimes.some((o) => Math.abs(o - t) <= onsetTol);
  const voicedContiguous = (aEnd, bStart) => {
    if (bStart - aEnd > SCOOP_MERGE_MAX_GAP_SEC) return false;
    for (const f of curve) {
      if (f.time <= aEnd + hop * 0.5) continue;
      if (f.time >= bStart - hop * 0.5) break;
      if (f.amplitude <= SCOOP_MERGE_SILENCE_AMP) return false;
    }
    return true;
  };
  const dominantPitch = (a, b) => (a.durSec >= b.durSec ? a : b).midi;
  const tryMerge = (a, b) => {
    const dMidi = Math.abs(a.midi - b.midi);
    const longer = a.durSec >= b.durSec ? a : b;
    const shorter = a.durSec >= b.durSec ? b : a;
    const dominates = longer.durSec >= SCOOP_MERGE_GLIDE_DOMINANCE * shorter.durSec;
    const isScoop = dMidi <= SCOOP_MERGE_SEMI_TOL;
    const isHarmonic = SCOOP_MERGE_HARMONIC_SEMI.some((h) => Math.abs(dMidi - h) <= SCOOP_MERGE_HARMONIC_TOL);
    const isGlide = dMidi <= SCOOP_MERGE_GLIDE_SEMI && dominates;
    if (!isScoop && !isHarmonic && !isGlide) return null;
    if (!voicedContiguous(a.startSec + a.durSec, b.startSec)) return null;
    if (hasOnsetAt(b.startSec)) return null;
    const midi = isHarmonic && !isScoop ? Math.min(a.midi, b.midi) : dominantPitch(a, b);
    const startSec = a.startSec;
    const endSec = Math.max(a.startSec + a.durSec, b.startSec + b.durSec);
    const durSec = Math.max(minDuration, endSec - startSec);
    return {
      startSec,
      midi,
      durSec,
      velocity: Math.max(a.velocity, b.velocity),
      ...a.recovered || b.recovered ? { recovered: true } : {}
    };
  };
  let work = notes.slice().sort((x, y) => x.startSec - y.startSec);
  let safety = work.length * 2 + 4;
  while (safety-- > 0) {
    let best = null;
    for (let i = 0; i < work.length; i++) {
      if (work[i].durSec >= SCOOP_MERGE_MAX_DUR) continue;
      const n = work[i], prev = work[i - 1], next = work[i + 1];
      const consider = (lo, hi, a, b2) => {
        const merged = tryMerge(a, b2);
        if (!merged) return;
        const score = Math.max(a.durSec, b2.durSec);
        if (!best || score > best.score) best = { lo, hi, merged, score };
      };
      if (prev) consider(i - 1, i, prev, n);
      if (next) consider(i, i + 1, n, next);
    }
    if (!best) break;
    const b = best;
    work = [...work.slice(0, b.lo), b.merged, ...work.slice(b.hi + 1)];
  }
  return work;
}
function mergeHeldSplits(notes, curve, minDuration) {
  if (notes.length < 2) return notes;
  const medAmp = (s, e) => {
    const vals = [];
    for (const f of curve) {
      if (f.time >= s && f.time <= e) vals.push(f.amplitude);
    }
    if (!vals.length) return 0;
    vals.sort((x, y) => x - y);
    return vals[Math.floor(vals.length / 2)];
  };
  const boundaryValley = (aEnd, bStart) => {
    let v = Infinity;
    for (const f of curve) {
      if (f.time >= aEnd - 0.03 && f.time <= bStart + 0.03) v = Math.min(v, f.amplitude);
    }
    return isFinite(v) ? v : 0;
  };
  const tryMerge = (a, b) => {
    if (Math.abs(a.midi - b.midi) > HELD_MERGE_PITCH_TOL) return null;
    const aEnd = a.startSec + a.durSec, bStart = b.startSec;
    if (bStart - aEnd > HELD_MERGE_MAX_GAP_SEC) return null;
    const body = Math.min(medAmp(a.startSec + 0.03, aEnd), medAmp(b.startSec + 0.03, bStart + b.durSec));
    if (body <= 1e-6) return null;
    if (boundaryValley(aEnd, bStart) / body <= HELD_MERGE_VALLEY_RATIO) return null;
    const endSec = Math.max(aEnd, bStart + b.durSec);
    return {
      startSec: a.startSec,
      midi: (a.durSec >= b.durSec ? a : b).midi,
      durSec: Math.max(minDuration, endSec - a.startSec),
      velocity: Math.max(a.velocity, b.velocity),
      ...a.recovered || b.recovered ? { recovered: true } : {}
    };
  };
  let work = notes.slice().sort((x, y) => x.startSec - y.startSec);
  let safety = work.length * 2 + 4;
  while (safety-- > 0) {
    let did = false;
    for (let i = 0; i < work.length - 1; i++) {
      const merged = tryMerge(work[i], work[i + 1]);
      if (merged) {
        work = [...work.slice(0, i), merged, ...work.slice(i + 2)];
        did = true;
        break;
      }
    }
    if (!did) break;
  }
  return work;
}
var GRID_FRAG_MAX_STEPS = 1;
function applyBeatGridPrior(notes, curve, grid, minDuration) {
  const step = 60 / grid.bpm / Math.max(1, grid.subdiv);
  if (!Number.isFinite(step) || step <= 0 || notes.length === 0) return notes.map((n) => ({ ...n }));
  const phase = Number.isFinite(grid.phaseSec) ? grid.phaseSec : 0;
  const snapTol = 0.5 * step;
  const gridTol = Math.min(0.35 * step, 0.05);
  const resid = (t) => Math.abs(t - (phase + Math.round((t - phase) / step) * step));
  const onGridTight = (t) => resid(t) <= gridTol;
  const voicedContiguous = (aEnd, bStart) => {
    if (bStart - aEnd > SCOOP_MERGE_MAX_GAP_SEC) return false;
    for (const f of curve) {
      if (f.time <= aEnd + step * 0.25) continue;
      if (f.time >= bStart - step * 0.25) break;
      if (f.amplitude <= SCOOP_MERGE_SILENCE_AMP) return false;
    }
    return true;
  };
  let work = notes.slice().sort((a, b) => a.startSec - b.startSec);
  let safety = work.length * 2 + 4;
  while (safety-- > 0) {
    let best = null;
    for (let i = 0; i < work.length; i++) {
      const frag = work[i];
      if (frag.durSec >= GRID_FRAG_MAX_STEPS * step || onGridTight(frag.startSec)) continue;
      const prev = work[i - 1], next = work[i + 1];
      const consider = (lo, hi, a, b2) => {
        const neigh = a === frag ? b2 : a;
        if (!onGridTight(neigh.startSec)) return;
        if (!voicedContiguous(a.startSec + a.durSec, b2.startSec)) return;
        const start = Math.min(a.startSec, neigh.startSec);
        const end = Math.max(a.startSec + a.durSec, b2.startSec + b2.durSec);
        const merged = {
          startSec: neigh.startSec <= frag.startSec ? neigh.startSec : start,
          midi: neigh.midi,
          // the sustained neighbour's pitch wins
          durSec: Math.max(minDuration, end - (neigh.startSec <= frag.startSec ? neigh.startSec : start)),
          velocity: Math.max(a.velocity, b2.velocity),
          ...a.recovered || b2.recovered ? { recovered: true } : {}
        };
        const score = neigh.durSec;
        if (!best || score > best.score) best = { lo, hi, merged, score };
      };
      if (prev) consider(i - 1, i, prev, frag);
      if (next) consider(i, i + 1, frag, next);
    }
    if (!best) break;
    const b = best;
    work = [...work.slice(0, b.lo), b.merged, ...work.slice(b.hi + 1)];
  }
  const snapped = work.map((n) => {
    const k = Math.round((n.startSec - phase) / step);
    const gridLine = phase + k * step;
    const near = Math.abs(n.startSec - gridLine) <= snapTol;
    return {
      ...n,
      startSec: near ? gridLine : n.startSec,
      durSec: Math.max(step, Math.round(n.durSec / step) * step),
      offGrid: !near
    };
  });
  snapped.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);
  const eps = step * 1e-6;
  const out = [];
  for (const n of snapped) {
    const prev = out[out.length - 1];
    if (prev && prev.midi === n.midi && Math.abs(prev.startSec - n.startSec) <= eps) {
      prev.velocity = Math.max(prev.velocity, n.velocity);
      prev.durSec = Math.max(prev.durSec, n.durSec);
      prev.offGrid = prev.offGrid && n.offGrid;
      continue;
    }
    out.push({ ...n });
  }
  return out;
}
function finalizeAnalysis(rawCurve, opts, minDuration, rMed, octR) {
  const curve = refinePitchTrack(rawCurve, rMed, octR);
  const segmenter = opts.segmenter ?? DEFAULT_SEGMENTER;
  const useOnsets = opts.useOnsets !== false;
  const useVolume = opts.useVolumeCues !== false;
  const wantOnsets = useOnsets || segmenter === "hmm";
  const hopSec = curve.length > 1 ? Math.max(1e-4, curve[1].time - curve[0].time) : opts.hopSec ?? DEFAULT_HOP_SEC;
  const sens = clamp(opts.onsetSensitivity ?? DEFAULT_ONSET_SENS, 0, 1);
  const onsetIdx = wantOnsets ? detectOnsetFrames(curve, hopSec, sens) : [];
  const valleyIdx = wantOnsets && useVolume ? detectVolumeValleys(curve, hopSec, minDuration, opts.volumeValleyDepth ?? DEFAULT_VALLEY_DEPTH) : [];
  const splitIdx = wantOnsets ? Array.from(/* @__PURE__ */ new Set([...onsetIdx, ...valleyIdx])).sort((a, b) => a - b) : [];
  const existFrac = existFracFor(opts);
  const keepBias = keepBiasFor(opts);
  let notes;
  if (segmenter === "hmm") {
    notes = segmentWithHmm(curve, minDuration, new Set(splitIdx), keepBias);
    if (opts.repitch === true || opts.repitch !== false && HMM_REPITCH) {
      notes = repitchNotes(notes, curve, opts);
    }
  } else {
    const events = useOnsets ? segmentWithOnsets(curve, splitIdx, minDuration, useVolume, existFrac, segClarityGateFor(opts)) : extractNoteEvents(curve, minDuration);
    notes = eventsToNotes(events, minDuration);
    if (opts.repitch !== false) notes = repitchNotes(notes, curve, opts);
  }
  if (opts.mergeScoops !== false) {
    const onsetTimes = splitIdx.map((i) => curve[i].time);
    notes = mergeScoopFragments(notes, curve, onsetTimes, hopSec, minDuration);
  }
  if (opts.mergeHeldSplits !== false) {
    notes = mergeHeldSplits(notes, curve, minDuration);
  }
  if (opts.recoverNotes !== false) {
    notes = recoverMissedNotes(notes, curve, opts, minDuration, existFrac);
  }
  if (opts.beatGrid && opts.useBeatGrid !== false) {
    notes = applyBeatGridPrior(notes, curve, opts.beatGrid, minDuration);
  }
  let fluxMax = 1e-9, rmsPeak = 1e-9;
  for (const f of curve) {
    if (f.flux > fluxMax) fluxMax = f.flux;
    if (f.rms > rmsPeak) rmsPeak = f.rms;
  }
  return {
    notes,
    curve,
    rawCurve,
    onsets: onsetIdx.map((i) => curve[i].time),
    flux: curve.map((f) => Math.min(1, f.flux / fluxMax)),
    clarity: curve.map((f) => f.clarity),
    // Volume (RMS) + pitch-change envelopes for the debug overlay — normalized 0–1, aligned
    // to `curve`. pitchDelta saturates at ~2 semitones so a big leap reads as a full spike.
    rms: curve.map((f) => Math.min(1, f.rms / rmsPeak)),
    pitchDelta: curve.map((f) => Math.min(1, f.pitchDelta / 2)),
    recovered: notes.filter((n) => n.recovered).map((n) => n.startSec)
  };
}
var BAND_SCORE_CAP = 100;
function planBandVoicing(gained, rate, frames, p) {
  const nF = frames.length;
  const voiced = new Uint8Array(nF);
  let anyVoiced = false;
  for (let i = 0; i < nF; i++) {
    if (frames[i].midi !== null) {
      voiced[i] = 1;
      anyVoiced = true;
    }
  }
  if (!anyVoiced) {
    for (let i = 0; i < nF; i++) if (frames[i].rms >= p.rmsGate) voiced[i] = 1;
  }
  const offs = new Int32Array(nF), wins = new Int32Array(nF), qualifies = new Uint8Array(nF);
  const qIdx = [];
  for (let i = 0; i < nF; i++) {
    const off = Math.round(frames[i].time * rate);
    const win = Math.min(p.win, Math.max(0, gained.length - off));
    offs[i] = off;
    wins[i] = win;
    if (voiced[i] && win >= TAIL_MIN_SAMPLES) {
      qualifies[i] = 1;
      qIdx.push(i);
    }
  }
  const stride = Math.max(1, Math.floor(qIdx.length / BAND_SCORE_CAP));
  const subIdx = [];
  for (let k = 0; k < qIdx.length; k += stride) subIdx.push(qIdx[k]);
  return { qIdx, qualifies, offs, wins, subIdx };
}
var bandScanParams = (p) => ({ ...p, rmsGate: 0 });
function detectBandFrame(band, plan, i, pBand, time) {
  const off = plan.offs[i], win = plan.wins[i];
  const seg = band.subarray(off, off + win);
  let sq = 0;
  for (let j = 0; j < seg.length; j++) sq += seg[j] * seg[j];
  const bandRms = seg.length ? Math.sqrt(sq / seg.length) : 0;
  const det = detectFramePitch(band, off, seg, bandRms, pBand);
  return { time, freq: det.freq, midi: det.midi, clarity: det.clarity };
}
function bandLoudness(band, plan, aW) {
  let sumSq = 0;
  for (const i of plan.qIdx) {
    const off = plan.offs[i], win = plan.wins[i];
    const end = off + win;
    let sq = 0;
    for (let j = off; j < end; j++) sq += band[j] * band[j];
    if (win > 0) sumSq += sq / win;
  }
  const bandRmsAgg = plan.qIdx.length > 0 ? Math.sqrt(sumSq / plan.qIdx.length) : 0;
  return aW * bandRmsAgg;
}
function buildBandReading(band, spec, plan, pBand, frames) {
  const perceptualLoudness = bandLoudness(band, plan, aWeightingGain(bandCenter(spec)));
  let sumClar = 0, nClar = 0;
  const subTrack = new Array(plan.subIdx.length);
  for (let k = 0; k < plan.subIdx.length; k++) {
    const pt = detectBandFrame(band, plan, plan.subIdx[k], pBand, frames[plan.subIdx[k]].time);
    if (pt.clarity > 0) {
      sumClar += pt.clarity;
      nClar++;
    }
    subTrack[k] = pt;
  }
  const meanClarity = nClar > 0 ? sumClar / nClar : 0;
  return {
    name: spec.name,
    loFreq: spec.lo,
    hiFreq: spec.hi,
    perceptualLoudness,
    meanClarity,
    score: perceptualLoudness * meanClarity,
    pitchTrack: subTrack
  };
}
function medMidiOf(track) {
  const ms = track.map((p) => p.midi).filter((m) => m !== null).sort((a, b) => a - b);
  return ms.length ? ms[Math.floor(ms.length / 2)] : null;
}
function selectWinnerIdx(readings) {
  let scoreIdx = 0;
  for (let i = 1; i < readings.length; i++) if (readings[i].score > readings[scoreIdx].score) scoreIdx = i;
  const winMidi = medMidiOf(readings[scoreIdx].pitchTrack);
  let winnerIdx = scoreIdx;
  if (winMidi !== null) {
    for (let i = 0; i < scoreIdx; i++) {
      const bm = medMidiOf(readings[i].pitchTrack);
      if (bm === null) continue;
      const semisBelow = winMidi - bm;
      const octs = Math.round(semisBelow / 12);
      const octaveBelow = octs >= 1 && Math.abs(semisBelow - octs * 12) <= FUND_OCTAVE_TOL_SEMI;
      const clearEnough = readings[i].meanClarity >= FUND_CLARITY_FRAC * readings[scoreIdx].meanClarity && readings[i].meanClarity >= FUND_CLARITY_ABS;
      const loudEnough = readings[i].score >= FUND_SCORE_FRAC * readings[scoreIdx].score;
      if (octaveBelow && clearEnough && loudEnough) {
        winnerIdx = i;
        break;
      }
    }
  }
  return winnerIdx;
}
function fillWinnerTrack(band, plan, pBand, frames, out, from, to) {
  let detected = 0;
  for (let i = from; i < to; i++) {
    if (plan.qualifies[i]) {
      out[i] = detectBandFrame(band, plan, i, pBand, frames[i].time);
      detected++;
    } else out[i] = { time: frames[i].time, freq: null, midi: null, clarity: 0 };
  }
  return detected;
}
async function computeBandReadingsAsync(gained, rate, frames, p, report) {
  const plan = planBandVoicing(gained, rate, frames, p);
  const pBand = bandScanParams(p);
  const nF = frames.length;
  const totalWork = Math.max(1, VOCAL_BANDS.length * plan.subIdx.length + plan.qIdx.length);
  let done = 0, lastYield = nowMs();
  const tick = async (units) => {
    done += units;
    if (nowMs() - lastYield >= 12) {
      report?.(Math.min(0.99, done / totalWork));
      await new Promise((r) => setTimeout(r, 0));
      lastYield = nowMs();
    }
  };
  const bandBufs = new Array(VOCAL_BANDS.length);
  const readings = new Array(VOCAL_BANDS.length);
  for (let b = 0; b < VOCAL_BANDS.length; b++) {
    bandBufs[b] = bandpassFilter(gained, VOCAL_BANDS[b].lo, VOCAL_BANDS[b].hi, rate);
    readings[b] = buildBandReading(bandBufs[b], VOCAL_BANDS[b], plan, pBand, frames);
    await tick(plan.subIdx.length);
  }
  const winnerIdx = selectWinnerIdx(readings);
  const full = new Array(nF);
  const CHUNK = 64;
  for (let from = 0; from < nF; from += CHUNK) {
    const detected = fillWinnerTrack(bandBufs[winnerIdx], plan, pBand, frames, full, from, Math.min(nF, from + CHUNK));
    await tick(detected);
  }
  readings[winnerIdx] = { ...readings[winnerIdx], pitchTrack: full };
  report?.(1);
  return { readings, winnerIdx };
}
function overlayWinnerPitch(frames, track) {
  if (!track) return;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.midi === null) continue;
    const w = track[i];
    if (w && w.midi !== null) {
      f.freq = w.freq;
      f.midi = w.midi;
      f.clarity = w.clarity;
    }
  }
  let prevMidi = null;
  for (const f of frames) {
    f.pitchDelta = f.midi !== null && prevMidi !== null ? Math.abs(f.midi - prevMidi) : 0;
    prevMidi = f.midi;
  }
}
async function applyEqPitchSourceAsync(frames, gained, rate, p, report) {
  if (frames.length === 0 || gained.length < p.win) {
    report?.(1);
    return;
  }
  const { readings, winnerIdx } = await computeBandReadingsAsync(gained, rate, frames, p, report);
  overlayWinnerPitch(frames, readings[winnerIdx]?.pitchTrack);
}
var nowMs = () => typeof performance !== "undefined" ? performance.now() : Date.now();
async function analyzeBufferAsync(samples, sampleRate, opts = {}, onProgress) {
  const minDuration = opts.minDuration ?? 0.08;
  const rMed = Math.max(0, opts.medianRadius ?? 1);
  const octR = Math.max(0, opts.octaveRadius ?? DEFAULT_OCTAVE_RADIUS);
  const { buf: ds, rate } = resampleMono(samples, sampleRate, opts.targetSampleRate ?? DEFAULT_TARGET_SR);
  const gain = opts.gain ?? 1;
  const hop = Math.max(1, Math.round((opts.hopSec ?? DEFAULT_HOP_SEC) * rate));
  const p = scanParamsFrom(opts, rate);
  const buf = applyGain(ds, gain);
  if (buf.length < p.win) {
    onProgress?.(1);
    return { notes: [], curve: [], rawCurve: [], onsets: [], flux: [], clarity: [] };
  }
  const st = makeScanState(p.win);
  const rawCurve = [];
  const end = buf.length - p.win;
  const scanCap = opts.pitchSource === "eq" ? 0.4 : 0.97;
  let lastYield = nowMs();
  for (let off = 0; off + p.win <= buf.length; off += hop) {
    rawCurve.push(scanFeatureFrame(buf, off, p, st));
    if (nowMs() - lastYield >= 12) {
      onProgress?.(Math.min(scanCap, end > 0 ? off / end : 1));
      await new Promise((r) => setTimeout(r, 0));
      lastYield = nowMs();
    }
  }
  appendTailFrames(rawCurve, buf, p, st, hop, opts.scanTailWindow !== false);
  if (opts.pitchSource === "eq") {
    await applyEqPitchSourceAsync(rawCurve, buf, rate, p, (frac) => onProgress?.(0.4 + 0.59 * frac));
  }
  const analysis = finalizeAnalysis(rawCurve, opts, minDuration, rMed, octR);
  onProgress?.(1);
  return analysis;
}

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
var FFT_N = 4096;
function isPolyphonic(samples, sr, startSec, durSec) {
  const bodyStart = startSec + Math.min(0.06, durSec * 0.25);
  const s0 = Math.floor(bodyStart * sr);
  const avail = Math.min(FFT_N, Math.max(0, Math.floor((startSec + durSec) * sr) - s0));
  if (avail < 1024) return false;
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
  for (let i = 0; i < avail; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (avail - 1));
    re[i] = (samples[s0 + i] || 0) * w;
  }
  fftInPlace(re, im);
  const half = FFT_N / 2;
  const mag = new Float32Array(half);
  let maxMag = 1e-9;
  for (let i = 0; i < half; i++) {
    const m = Math.hypot(re[i], im[i]);
    mag[i] = m;
    if (m > maxMag) maxMag = m;
  }
  const binHz = sr / FFT_N;
  const loBin = Math.max(2, Math.floor(60 / binHz)), hiBin = Math.min(half - 1, Math.floor(2200 / binHz));
  const peaks = [];
  for (let i = loBin; i <= hiBin; i++) {
    if (mag[i] > 0.12 * maxMag && mag[i] >= mag[i - 1] && mag[i] >= mag[i + 1]) peaks.push({ hz: i * binHz, m: mag[i] });
  }
  if (peaks.length < 2) return false;
  peaks.sort((a, b) => b.m - a.m);
  const strong = peaks.slice(0, 8);
  const topM = strong[0].m;
  const hasPeakNear = (hz) => strong.some((p) => Math.abs(p.hz - hz) <= 0.03 * hz + binHz);
  const completeRun = (c) => hasPeakNear(2 * c) && hasPeakNear(3 * c) && hasPeakNear(4 * c) && hasPeakNear(5 * c);
  const cands = /* @__PURE__ */ new Set();
  for (const p of strong) {
    cands.add(p.hz);
    for (const k of [2, 3]) {
      const c = p.hz / k;
      if (c >= 55 && completeRun(c)) cands.add(c);
    }
  }
  let f0 = strong[0].hz, bestSupport = -1;
  for (const c of cands) {
    let support = 0;
    for (const p of strong) {
      const r = p.hz / c;
      if (r < 0.75) continue;
      if (Math.abs(r - Math.round(r)) <= 0.06 * r) support += p.m;
    }
    if (support > bestSupport + 1e-9 || Math.abs(support - bestSupport) <= 1e-9 && c > f0) {
      bestSupport = support;
      f0 = c;
    }
  }
  for (const p of strong) {
    if (p.m < 0.3 * topM) continue;
    const ratio = p.hz / f0;
    if (ratio < 1.08) continue;
    const nearest = Math.round(ratio);
    if (Math.abs(ratio - nearest) > 0.08 * ratio) return true;
  }
  return false;
}
function scoreNote(note, curve, samples, sr) {
  const end = note.startSec + note.durSec;
  const frames = curve.filter((f) => f.time >= note.startSec && f.time <= end && f.midi !== null);
  const clarity = frames.length ? frames.reduce((s, f) => s + (Number.isFinite(f.clarity) ? f.clarity : 0), 0) / frames.length : 0;
  let dSum = 0, dN = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i].midi, b = frames[i - 1].midi;
    if (a !== null && b !== null) {
      dSum += Math.abs(a - b);
      dN++;
    }
  }
  const instability = dN ? dSum / dN : 0;
  const poly = isPolyphonic(samples, sr, note.startSec, note.durSec);
  const reasons = [];
  let confidence = Math.max(0, Math.min(1, Number.isFinite(clarity) ? clarity : 0));
  if (poly) {
    confidence *= 0.3;
    reasons.push("polyphonic");
  }
  if (clarity < 0.55) reasons.push("unclear");
  if (instability > 0.6) {
    confidence *= 0.8;
    reasons.push("unstable");
  }
  return { confidence: +confidence.toFixed(3), polyphonic: poly, clarity: +clarity.toFixed(3), reasons };
}
function scoreNotes(notes, curve, samples, sr) {
  return notes.map((n) => scoreNote(n, curve, samples, sr));
}

// lib/poly-detect.ts
var A4 = 440;
var midiToHz = (m) => A4 * Math.pow(2, (m - 69) / 12);
function detectPolyphony(samples, sr, startSec, durSec, opts = {}) {
  const maxNotes = opts.maxNotes ?? 4;
  const minMidi = opts.minMidi ?? 36;
  const maxMidi = opts.maxMidi ?? 88;
  const floor = opts.salienceFloor ?? 0.22;
  const bodyStart = startSec + Math.min(0.06, durSec * 0.25);
  const s0 = Math.floor(bodyStart * sr);
  const avail = Math.min(FFT_N, Math.max(0, Math.floor((startSec + durSec) * sr) - s0));
  if (avail < 1024) return [];
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
  for (let i = 0; i < avail; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (avail - 1));
    re[i] = (samples[s0 + i] || 0) * w;
  }
  fftInPlace(re, im);
  const half = FFT_N / 2;
  const mag = new Float32Array(half);
  let globalMax = 1e-9;
  for (let i = 0; i < half; i++) {
    const m = Math.hypot(re[i], im[i]);
    mag[i] = m;
    if (m > globalMax) globalMax = m;
  }
  const binOf = (hz) => Math.round(hz * FFT_N / sr);
  const nHarm = 8;
  const peakNear = (spec, bin) => {
    let v = 0;
    for (let b = bin - 1; b <= bin + 1; b++) if (b > 0 && b < half) v = Math.max(v, spec[b]);
    return v;
  };
  const salience = (spec, m) => {
    const f = midiToHz(m);
    const fund = peakNear(spec, binOf(f));
    if (fund < 0.06 * globalMax) return 0;
    let s = fund * 1.5;
    for (let h = 2; h <= nHarm; h++) {
      const bin = binOf(h * f);
      if (bin >= half) break;
      s += peakNear(spec, bin) / Math.sqrt(h);
    }
    return s;
  };
  const work = mag.slice();
  const found = [];
  let firstSal = 0;
  for (let iter = 0; iter < maxNotes; iter++) {
    let bestM = -1, bestS = 0;
    for (let m = minMidi; m <= maxMidi; m++) {
      const s = salience(work, m);
      if (s > bestS) {
        bestS = s;
        bestM = m;
      }
    }
    if (bestM < 0 || bestS <= 0) break;
    if (iter === 0) firstSal = bestS;
    else if (bestS < floor * firstSal) break;
    if (!found.includes(bestM)) found.push(bestM);
    const f = midiToHz(bestM);
    for (let h = 1; h <= nHarm; h++) {
      const bin = binOf(h * f);
      for (let b = bin - 1; b <= bin + 1; b++) if (b > 0 && b < half) work[b] *= 0.12;
    }
  }
  return found.sort((a, b) => a - b);
}
function findUncoveredChords(samples, sr, monoNotes, curve, opts = {}) {
  const minDur = opts.minDuration ?? 0.12;
  const frames = curve.filter((f) => Number.isFinite(f.time));
  if (frames.length < 3) return [];
  let rmsMax = 1e-9;
  for (const f of frames) if ((f.rms || 0) > rmsMax) rmsMax = f.rms;
  const soundFloor = 0.15 * rmsMax;
  const pad = 0.04;
  const covered = (t) => monoNotes.some((n) => t >= n.startSec - pad && t <= n.startSec + n.durSec + pad);
  const spans = [];
  let start = -1, prev = frames[0].time;
  for (const f of frames) {
    const uncovered = (f.rms || 0) > soundFloor && !covered(f.time);
    if (uncovered && start < 0) start = f.time;
    else if (!uncovered && start >= 0) {
      spans.push([start, prev]);
      start = -1;
    }
    prev = f.time;
  }
  if (start >= 0) spans.push([start, prev]);
  const out = [];
  for (const [s, e] of spans) {
    if (e - s < minDur) continue;
    const midis = detectPolyphony(samples, sr, s, e - s);
    if (midis.length >= 2) out.push({ startSec: s, durSec: e - s, midis });
  }
  return out;
}

// lib/audio-to-midi.ts
async function audioToNotes(samples, sr, opts = {}) {
  const a = await analyzeBufferAsync(samples, sr, { sensitivity: opts.sensitivity ?? 0.5, minDuration: 0.08, segmenter: "hmm" });
  const curve = a.curve || [];
  const scores = scoreNotes(a.notes, curve, samples, sr);
  const notes = [];
  let chordsResolved = 0, lowConfidence = 0;
  a.notes.forEach((n, i) => {
    const sc = scores[i];
    if (sc.polyphonic && sc.confidence < 0.55) {
      const chord = detectPolyphony(samples, sr, n.startSec, n.durSec);
      if (chord.length >= 2) {
        chordsResolved++;
        for (const midi of chord) notes.push({ startSec: n.startSec, midi, durSec: n.durSec, velocity: n.velocity, confidence: 0.85 });
        return;
      }
    }
    if (sc.confidence < 0.55) lowConfidence++;
    notes.push({ startSec: n.startSec, midi: n.midi, durSec: n.durSec, velocity: n.velocity, confidence: sc.confidence });
  });
  for (const gc of findUncoveredChords(samples, sr, a.notes, curve, { minDuration: 0.12 })) {
    chordsResolved++;
    for (const midi of gc.midis) notes.push({ startSec: gc.startSec, midi, durSec: gc.durSec, velocity: 0.7, confidence: 0.8 });
  }
  notes.sort((x, y) => x.startSec - y.startSec || x.midi - y.midi);
  return { notes, chordsResolved, lowConfidence };
}
export {
  audioToNotes
};
