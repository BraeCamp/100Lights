// ── Song verification harness (dev only) ─────────────────────────────────────
// Loaded into the editor page via: fetch('/dev/song-harness.js').then(r=>r.text())
// then (new Function(text))(). Exposes window.__song so an agent's render/analyze
// evals are one-liners instead of a 40-line blob (which the /new page's HMR
// remounts kept killing). Pairs with the listen-analyzer (window.Listen).
(function () {
  const decode = (b64) => {
    const bin = atob(b64.replace(/^data:[^,]*,/, ''))
    const by = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i)
    const dv = new DataView(by.buffer)
    let off = 12, dO = 0, dL = 0
    while (off < by.length - 8) {
      const id = String.fromCharCode(by[off], by[off + 1], by[off + 2], by[off + 3])
      const sz = dv.getUint32(off + 4, true)
      if (id === 'data') { dO = off + 8; dL = sz; break }
      off += 8 + sz + (sz & 1)
    }
    const n = Math.floor(dL / 4), s = new Float32Array(n)
    for (let i = 0; i < n; i++) s[i] = dv.getFloat32(dO + i * 4, true)
    return s
  }
  // Build a full dawProject from a compose build-spec (the one object every eval
  // used to re-inline). Stems come back keyed by track NAME.
  const specToDaw = (spec) => ({
    id: 'v', name: spec.name, tempo: spec.tempo, timeSignatureNum: 4, timeSignatureDen: 4,
    tracks: spec.tracks.map(t => ({ id: t.id, name: t.name, type: 'audio', color: '#888', volume: t.volume, pan: t.pan, mute: false, solo: false, armed: false, height: 64, effects: t.effects || [], instrument: t.instrument })),
    arrangementClips: spec.clips.map(c => ({ kind: 'midi', id: c.id, trackId: c.trackId, name: 'c', startBeat: c.startBeat, durationBeats: c.durationBeats, notes: c.notes.map((n, j) => ({ id: c.id + '-' + j, ...n })), isDrumClip: !!c.isDrumClip, ...(c.presetId ? { presetId: c.presetId } : {}), ...(c.rollFx ? { rollFx: c.rollFx } : {}) })),
    scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 400, loopEnabled: false, masterVolume: spec.masterVolume,
    automationLanes: spec.automationLanes || [], clipEffects: spec.clipEffects || [], returnTracks: [], takeLanes: [],
    crossfaderValue: 0.5, waveformZoom: 1, swing: spec.swing, cueMarkers: [], sections: [], key: spec.key, scale: spec.scale,
  })

  window.__song = {
    spec: null,
    // fetch a build-spec, load it into the engine
    async load(url) {
      this.spec = await fetch(url).then(r => r.json())
      window.__dawDispatch({ type: 'LOAD_PROJECT', project: specToDaw(this.spec) })
      await new Promise(r => setTimeout(r, 650))
      return { name: this.spec.name, tracks: this.spec.tracks.length }
    },
    // render a beat range → decoded Float32 master + stems (keyed by name)
    async render(opts = {}) {
      const r = await window.__dawRenderWav({ mono: true, tailSec: 0.3, ...opts })
      const out = { sampleRate: r.sampleRate || 44100, master: decode(r.master) }
      if (r.stems) { out.stems = {}; for (const k in r.stems) out.stems[k] = decode(r.stems[k]) }
      let pk = 0; for (let i = 0; i < out.master.length; i++) { const a = Math.abs(out.master[i]); if (a > pk) pk = a }  // loop, not spread (stack)
      out.peak = +pk.toFixed(3); out.clip = out.peak >= 1
      return out
    },
    async ensureAnalyzer() {
      if (!window.Listen) { const s = await fetch('/dev/listen-analyzer.js').then(r => r.text()); window.Listen = (new Function(s + '; return Listen;'))() }
      return window.Listen
    },
    // render + full mix analysis in one call
    async mix(opts = {}) {
      const An = await this.ensureAnalyzer()
      const r = await this.render({ stems: true, ...opts })
      return { ...An.analyzeMix({ sampleRate: r.sampleRate, master: r.master, stems: r.stems }, { genre: opts.genre || 'dark-pop' }), peak: r.peak, clip: r.clip }
    },
    // render + per-stem rhythm/sustain/harmonics for one stem
    async stem(name, opts = {}) {
      const An = await this.ensureAnalyzer()
      const r = await this.render({ stems: true, ...opts })
      return An.analyzeStem(r.stems[name], r.sampleRate, opts.expect || {})
    },
    // full-song peak/clip only (cheap-ish; keep ranges as short as the check needs)
    async peakOf(endBeat) { const r = await this.render({ startBeat: 0, endBeat }); return { peak: r.peak, clip: r.clip } },
  }
  return { ok: true }
})()
