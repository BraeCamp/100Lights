"use strict";
var Listen = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // scripts/listen-analyzer.mjs
  var listen_analyzer_exports = {};
  __export(listen_analyzer_exports, {
    GENRE_TARGETS: () => GENRE_TARGETS,
    PRESENCE_BANDS: () => PRESENCE_BANDS,
    analyzeMix: () => analyzeMix,
    analyzeStem: () => analyzeStem,
    detectF0: () => detectF0,
    detectOnsets: () => detectOnsets,
    envelope: () => envelope,
    fft: () => fft,
    harmonics: () => harmonics,
    noteProfiles: () => noteProfiles,
    roleOf: () => roleOf,
    spectrum: () => spectrum
  });
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
  var BAND_EDGES = {
    sub: [20, 60],
    low: [60, 120],
    lowMid: [120, 350],
    mid: [350, 900],
    highMid: [900, 2e3],
    presence: [2e3, 6e3],
    brilliance: [6e3, 1e4],
    air: [1e4, 18e3]
  };
  var PRESENCE_BANDS = ["highMid", "presence"];
  function spectrum(signal, sr, fftSize = 4096) {
    const half = fftSize / 2;
    const hann = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
    const power = new Float64Array(half);
    const hop = fftSize >> 1;
    let frames = 0;
    const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    for (let start = 0; start + fftSize <= signal.length; start += hop) {
      for (let i = 0; i < fftSize; i++) {
        re[i] = signal[start + i] * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let i = 0; i < half; i++) power[i] += re[i] * re[i] + im[i] * im[i];
      frames++;
    }
    if (!frames) {
      for (let i = 0; i < fftSize; i++) {
        re[i] = (i < signal.length ? signal[i] : 0) * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let i = 0; i < half; i++) power[i] = re[i] * re[i] + im[i] * im[i];
      frames = 1;
    }
    const binHz = sr / fftSize;
    let num = 0, den = 0, total = 0;
    const bandP = {};
    for (const b in BAND_EDGES) bandP[b] = 0;
    const mags = new Float64Array(half);
    for (let i = 1; i < half; i++) {
      const f = i * binHz, mag = Math.sqrt(power[i] / frames), p = power[i] / frames;
      mags[i] = mag;
      num += f * mag;
      den += mag;
      total += p;
      for (const b in BAND_EDGES) {
        const [lo, hi] = BAND_EDGES[b];
        if (f >= lo && f < hi) bandP[b] += p;
      }
    }
    let cum = 0, rolloff = 0;
    const target = total * 0.85;
    for (let i = 1; i < half; i++) {
      cum += mags[i] * mags[i];
      if (cum >= target) {
        rolloff = i * binHz;
        break;
      }
    }
    const centroid = den > 0 ? num / den : 0;
    const bandPct = {};
    for (const b in bandP) bandPct[b] = total > 0 ? +(bandP[b] / total).toFixed(4) : 0;
    return { centroid: Math.round(centroid), rolloff: Math.round(rolloff), bandPct, energy: total };
  }
  function envelope(signal, sr, win = 1024, hop = 256) {
    const t = [], e = [];
    for (let s = 0; s + win <= signal.length; s += hop) {
      let sq = 0;
      for (let j = 0; j < win; j++) sq += signal[s + j] * signal[s + j];
      e.push(Math.sqrt(sq / win));
      t.push((s + win / 2) / sr);
    }
    return { t, e };
  }
  function detectOnsets(signal, sr, { minGapSec = 0.06, openRel = 0.18, closeRel = 0.1 } = {}) {
    const { t, e } = envelope(signal, sr, 512, 128);
    const mx = Math.max(1e-9, ...e);
    const openT = openRel * mx, closeT = closeRel * mx;
    const times = [];
    let active = false, last = -1e9;
    for (let i = 0; i < e.length; i++) {
      if (!active) {
        if (e[i] > openT && t[i] - last > minGapSec) {
          times.push(+t[i].toFixed(3));
          last = t[i];
          active = true;
        }
      } else if (e[i] < closeT) active = false;
    }
    const iois = times.slice(1).map((x, i) => +(x - times[i]).toFixed(3));
    return { times, count: times.length, iois };
  }
  function noteProfiles(signal, sr, onsetTimes) {
    const { t, e } = envelope(signal, sr, 1024, 256);
    const at = (sec) => {
      let i = 0;
      while (i < t.length - 1 && t[i] < sec) i++;
      return i;
    };
    const out = [];
    const bounds = [...onsetTimes, t[t.length - 1] + 1];
    for (let k = 0; k < onsetTimes.length; k++) {
      const a = at(bounds[k]), z = at(bounds[k + 1]);
      let peak2 = 0, pi = a;
      for (let i = a; i < z; i++) if (e[i] > peak2) {
        peak2 = e[i];
        pi = i;
      }
      if (peak2 < 1e-5) continue;
      const floor = 0.3 * peak2;
      let end = pi;
      for (let i = pi; i < z; i++) {
        if (e[i] >= floor) end = i;
        else if (e[i] < 0.12 * peak2) break;
      }
      const heldSec = +(t[end] - t[a]).toFixed(3);
      const s0 = Math.min(pi + 1, end);
      const seg = e.slice(s0, end + 1);
      const mean = seg.reduce((x, y) => x + y, 0) / (seg.length || 1);
      const sd = Math.sqrt(seg.reduce((x, y) => x + (y - mean) ** 2, 0) / (seg.length || 1));
      const cv = mean > 0 ? +(sd / mean).toFixed(3) : 0;
      const attackMs = Math.round((t[pi] - t[a]) * 1e3);
      const gapMs = k + 1 < onsetTimes.length ? Math.round(Math.max(0, bounds[k + 1] - t[end]) * 1e3) : 0;
      out.push({ onset: +t[a].toFixed(3), heldSec, sustainCV: cv, attackMs, gapMs, peak: +peak2.toFixed(4) });
    }
    return out;
  }
  function detectF0(signal, sr, fmax = 400, fftSize = 8192) {
    const { bandPct } = spectrum(signal, sr, fftSize);
    const half = fftSize / 2, hann = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
    const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    const start = Math.max(0, Math.floor(signal.length / 2) - fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = (signal[start + i] || 0) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const binHz = sr / fftSize;
    let best = 0, bf = 0;
    for (let i = 1; i < half; i++) {
      const f = i * binHz;
      if (f < 20 || f > fmax) continue;
      const m = re[i] * re[i] + im[i] * im[i];
      if (m > best) {
        best = m;
        bf = f;
      }
    }
    return Math.round(bf);
  }
  function harmonics(signal, sr, f0, fftSize = 8192) {
    const half = fftSize / 2, hann = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
    const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    const start = Math.max(0, Math.floor(signal.length / 2) - fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = (signal[start + i] || 0) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const binHz = sr / fftSize;
    const magAt = (f) => {
      const b = Math.round(f / binHz);
      let m = 0;
      for (let i = Math.max(1, b - 2); i <= b + 2 && i < half; i++) m = Math.max(m, Math.sqrt(re[i] * re[i] + im[i] * im[i]));
      return m;
    };
    const partials = [];
    for (let k = 1; k <= 8; k++) partials.push(+magAt(k * f0).toFixed(4));
    const p2 = partials.map((m) => m * m);
    const tot = p2.reduce((a, b) => a + b, 0) || 1;
    return { f0, partials, purity: +(p2[0] / tot).toFixed(3), richness: +((tot - p2[0]) / (p2[0] || 1)).toFixed(3) };
  }
  function analyzeStem(signal, sr, opts = {}) {
    const on = detectOnsets(signal, sr);
    const notes = noteProfiles(signal, sr, on.times);
    const f0 = opts.f0 || detectF0(signal, sr);
    const harm = f0 > 0 ? harmonics(signal, sr, f0) : null;
    const verdicts = [];
    const held = notes.map((n) => n.heldSec);
    const medHeld = held.length ? held.slice().sort((a, b) => a - b)[Math.floor(held.length / 2)] : 0;
    if (opts.expectHeldSec && medHeld < opts.expectHeldSec) verdicts.push(`notes too short \u2014 median hold ${medHeld}s < expected ${opts.expectHeldSec}s (re-triggering / not sustaining)`);
    const wob = notes.filter((n) => n.sustainCV > 0.28).length;
    if (wob > notes.length / 2) verdicts.push(`notes don't hold FLAT \u2014 ${wob}/${notes.length} have sustainCV>0.28 (decay/wobble instead of a steady drone)`);
    const chops = notes.filter((n) => n.gapMs > 60).length;
    if (chops) verdicts.push(`${chops} release GAP(s) >60ms between notes \u2014 the drone is being chopped, not held`);
    if (opts.expectPureSub && harm && harm.purity < 0.6) verdicts.push(`not a pure sub \u2014 fundamental is only ${(harm.purity * 100).toFixed(0)}% of the harmonic energy (${f0}Hz, richness ${harm.richness}); heavier lowpass / less saturation`);
    return { onsets: on, notes, f0, harmonics: harm, medHeldSec: medHeld, verdicts };
  }
  var rms = (s) => {
    let sq = 0;
    for (let i = 0; i < s.length; i++) sq += s[i] * s[i];
    return Math.sqrt(sq / (s.length || 1));
  };
  var peak = (s) => {
    let p = 0;
    for (let i = 0; i < s.length; i++) {
      const a = Math.abs(s[i]);
      if (a > p) p = a;
    }
    return p;
  };
  var dbfs = (r) => r > 0 ? +(20 * Math.log10(r)).toFixed(1) : -99;
  var presencePct = (bp) => (bp.highMid || 0) + (bp.presence || 0);
  var weightPct = (bp) => (bp.sub || 0) + (bp.low || 0);
  function roleOf(name) {
    const n = (name || "").toLowerCase();
    if (/drum|kick|snare|hat|perc|beat/.test(n)) return "drums";
    if (/sub|808|bass/.test(n)) return "bass";
    if (/pad/.test(n)) return "pad";
    if (/stab|pluck|chord|key/.test(n)) return "stab";
    if (/lead|melod|arp|counter|riff|synth/.test(n)) return "lead";
    return "other";
  }
  var CUTTING_ROLES = /* @__PURE__ */ new Set(["stab", "lead"]);
  var GENRE_TARGETS = {
    "dark-pop": { melodicCentroidHz: [800, 2200], presencePct: [0.05, 0.2], weightPct: [0.28, 0.62], rolloffHz: [1500, 6e3], leadRole: "stab", leadMaxUnderDb: 6, crestDb: [6, 16] },
    "synthwave": { melodicCentroidHz: [1e3, 3e3], presencePct: [0.07, 0.24], weightPct: [0.22, 0.55], rolloffHz: [2500, 9e3], leadRole: "lead", leadMaxUnderDb: 6, crestDb: [6, 16] },
    default: { melodicCentroidHz: [900, 3200], presencePct: [0.06, 0.26], weightPct: [0.2, 0.58], rolloffHz: [2e3, 9e3], leadRole: null, leadMaxUnderDb: 8, crestDb: [5, 18] }
  };
  function sumSignals(list) {
    if (!list.length) return new Float32Array(0);
    const n = list[0].length, out = new Float32Array(n);
    for (const s of list) for (let i = 0; i < n && i < s.length; i++) out[i] += s[i];
    return out;
  }
  function analyzeMix(render, opts = {}) {
    const sr = render.sampleRate || 48e3;
    const genre = opts.genre || "default";
    const T = GENRE_TARGETS[genre] || GENRE_TARGETS.default;
    const M = render.master;
    const mSpec = spectrum(M, sr);
    const mPk = +peak(M).toFixed(3), mRms = rms(M);
    const mix = { ...mSpec, dBFS: dbfs(mRms), peak: mPk, clip: mPk >= 1, crestDb: mRms > 0 ? +(20 * Math.log10(mPk / mRms)).toFixed(1) : 0, presencePct: +presencePct(mSpec.bandPct).toFixed(4), weightPct: +weightPct(mSpec.bandPct).toFixed(4) };
    const stems = {};
    const melodic = [];
    for (const name in render.stems || {}) {
      const s = render.stems[name];
      const sp = spectrum(s, sr), pk = +peak(s).toFixed(3), rm = rms(s);
      const role = roleOf(name);
      stems[name] = { role, ...sp, dBFS: dbfs(rm), peak: pk, presencePct: +presencePct(sp.bandPct).toFixed(4) };
      if (role !== "drums") melodic.push(s);
    }
    const melodicSpec = melodic.length ? spectrum(sumSignals(melodic), sr) : null;
    const ranked = Object.entries(stems).map(([n, v]) => ({ n, role: v.role, dBFS: v.dBFS })).sort((a, b) => b.dBFS - a.dBFS);
    const loudest = ranked[0];
    const balance = ranked.map((r) => ({ stem: r.n, role: r.role, dBFS: r.dBFS, underLoudestDb: loudest ? +(loudest.dBFS - r.dBFS).toFixed(1) : 0 }));
    const domBand = (bp) => Object.entries(bp).sort((a, b) => b[1] - a[1])[0][0];
    const masks = [];
    const names = Object.keys(stems);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = stems[names[i]], b = stems[names[j]];
      if (domBand(a.bandPct) === domBand(b.bandPct) && Math.abs(a.dBFS - b.dBFS) < 6) masks.push({ a: names[i], b: names[j], band: domBand(a.bandPct) });
    }
    const verdicts = [];
    const V = (sev, tag, msg) => verdicts.push({ sev, tag, msg });
    if (melodicSpec) {
      const mc = melodicSpec.centroid, [lo, hi] = T.melodicCentroidHz;
      if (mc < lo) V(1, "dull", `DULL, not dark \u2014 the musical voices average ${mc}Hz (drums excluded), below the ${genre} range ${lo}-${hi}Hz. Dark \u2260 muffled: brighten/grit the tonal parts, don't just lowpass.`);
      else if (mc > hi) V(2, "bright", `Melodic content bright \u2014 ${mc}Hz above ${hi}Hz; may sound thin/harsh for ${genre}.`);
    }
    const p = mix.presencePct, air = (mix.bandPct.brilliance || 0) + (mix.bandPct.air || 0), w = mix.weightPct;
    if (p < T.presencePct[0]) {
      const scoop = w > 0.4 && air > p;
      V(1, scoop ? "scooped" : "no-presence", `${scoop ? "SCOOPED mix" : "No presence"} \u2014 2-6kHz(+highMid) is only ${(p * 100).toFixed(1)}% (want \u2265${(T.presencePct[0] * 100).toFixed(0)}%)${scoop ? `, while lows are ${(w * 100).toFixed(0)}% and the only highs are drum fizz` : ""}. Nothing in the band where leads/stabs cut \u2014 the mix reads dull.`);
    } else if (p > T.presencePct[1]) V(3, "harsh", `Possibly harsh \u2014 presence ${(p * 100).toFixed(1)}% above ${(T.presencePct[1] * 100).toFixed(0)}%.`);
    if (w < T.weightPct[0]) V(2, "thin", `Thin \u2014 sub+low ${(w * 100).toFixed(0)}% (want \u2265${(T.weightPct[0] * 100).toFixed(0)}%); no low-end body.`);
    if ((mix.bandPct.lowMid || 0) > 0.42) V(2, "muddy", `Muddy \u2014 120-350Hz is ${(mix.bandPct.lowMid * 100).toFixed(0)}% of the mix; carve low-mids.`);
    if (mix.crestDb < T.crestDb[0]) V(3, "squashed", `Low crest ${mix.crestDb}dB \u2014 over-compressed/flat, little punch.`);
    for (const [name, v] of Object.entries(stems)) {
      if (!CUTTING_ROLES.has(v.role)) continue;
      if (v.presencePct < T.presencePct[0]) V(1, "part-dull", `${name} (${v.role}) is dull \u2014 ${(v.presencePct * 100).toFixed(1)}% presence, centroid ${v.centroid}Hz. It can't cut. Design a brighter/grittier voice, not just louder.`);
      const bal = balance.find((b) => b.stem === name);
      if (bal && bal.underLoudestDb > T.leadMaxUnderDb) V(2, "part-buried", `${name} (${v.role}) buried \u2014 ${bal.underLoudestDb}dB under ${loudest.n}; bring it up ~${Math.round(bal.underLoudestDb - T.leadMaxUnderDb + 2)}dB or thin what masks it.`);
    }
    for (const m of masks) if (CUTTING_ROLES.has(stems[m.a].role) || CUTTING_ROLES.has(stems[m.b].role)) V(3, "masking", `${m.a} & ${m.b} both pile into the ${m.band} band at similar level \u2014 they'll smear; separate by EQ or level.`);
    if (mix.clip) V(1, "clip", `Clipping \u2014 peak ${mix.peak}. Pull gain.`);
    verdicts.sort((a, b) => a.sev - b.sev);
    let score = 100;
    for (const vd of verdicts) score -= vd.sev === 1 ? 22 : vd.sev === 2 ? 11 : 5;
    score = Math.max(0, score);
    return {
      genre,
      targets: T,
      score,
      pass: verdicts.length === 0,
      mix,
      melodicCentroid: melodicSpec ? melodicSpec.centroid : null,
      stems,
      balance,
      masks,
      verdicts: verdicts.map((v) => ({ sev: v.sev, tag: v.tag, msg: v.msg }))
    };
  }
  return __toCommonJS(listen_analyzer_exports);
})();
