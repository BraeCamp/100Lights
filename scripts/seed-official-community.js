// Official 100Lights community seed content.
//
// Runs IN THE BROWSER (needs a signed-in admin session and OfflineAudioContext):
// paste into the console on /dashboard, or let the automation driver evaluate it.
// Synthesizes eight layered samples, uploads them, and shares them plus eight
// chord recipes — all under the "100Lights" byline via the admin-only
// asOfficial flag on POST /api/community.
//
// Idempotence: pass { skipNames: [...] } to skip items that already exist.

window.__seedOfficialCommunity = async function seedOfficialCommunity(opts = {}) {
  const skip = new Set(opts.skipNames ?? [])
  const results = []
  const SR = 44100

  // ── helpers ────────────────────────────────────────────────────────────────
  function toWav(buffer) {
    const ch = buffer.numberOfChannels, len = buffer.length
    const bytes = 44 + len * ch * 2
    const ab = new ArrayBuffer(bytes), v = new DataView(ab)
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
    ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVEfmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true)
    v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * ch * 2, true)
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len * ch * 2, true)
    let o = 44
    const chans = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i))
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      v.setInt16(o, s * 32767, true); o += 2
    }
    return new Blob([ab], { type: 'audio/wav' })
  }

  function normalize(buffer, target = 0.85) {
    let peak = 0
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c)
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
    }
    if (peak < 1e-6) return buffer
    const g = target / peak
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c)
      for (let i = 0; i < d.length; i++) d[i] *= g
    }
    return buffer
  }

  function peaksOf(buffer, bars = 120) {
    const d = buffer.getChannelData(0), step = Math.floor(d.length / bars)
    const out = []
    for (let b = 0; b < bars; b++) {
      let m = 0
      for (let i = b * step; i < (b + 1) * step; i += 16) m = Math.max(m, Math.abs(d[i]))
      out.push(Math.round(m * 100) / 100)
    }
    return out
  }

  async function upload(blob) {
    const presign = await fetch('/api/media/presign-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `official-${crypto.randomUUID()}.wav`, contentType: 'audio/wav', mediaId: `community-official-${crypto.randomUUID()}`, size: blob.size }),
    })
    if (!presign.ok) throw new Error(`presign ${presign.status}`)
    const { uploadUrl, key } = await presign.json()
    const put = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'audio/wav' } })
    if (!put.ok) throw new Error(`PUT ${put.status}`)
    return key
  }

  async function post(body) {
    const res = await fetch('/api/community', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, asOfficial: true }),
    })
    if (!res.ok) throw new Error(`share ${res.status}: ${await res.text()}`)
    return (await res.json()).id
  }

  // ── sample synthesis ───────────────────────────────────────────────────────
  // Each renderer returns a stereo AudioBuffer via OfflineAudioContext.

  async function renderAuroraPad() {
    // Three detuned saw layers per side under a breathing 24 dB lowpass sweep.
    const dur = 8, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const out = ctx.createGain(); out.connect(ctx.destination)
    const env = ctx.createGain(); env.gain.setValueAtTime(0, 0)
    env.gain.linearRampToValueAtTime(1, 2.2); env.gain.setValueAtTime(1, dur - 2.5); env.gain.linearRampToValueAtTime(0, dur)
    const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter()
    for (const f of [lp1, lp2]) { f.type = 'lowpass'; f.Q.value = 1.1 }
    lp1.frequency.setValueAtTime(380, 0); lp1.frequency.exponentialRampToValueAtTime(2400, dur * 0.55); lp1.frequency.exponentialRampToValueAtTime(500, dur)
    lp2.frequency.value = 3200
    env.connect(lp1); lp1.connect(lp2); lp2.connect(out)
    const pan = { L: ctx.createStereoPanner(), R: ctx.createStereoPanner() }
    pan.L.pan.value = -0.55; pan.R.pan.value = 0.55
    pan.L.connect(env); pan.R.connect(env)
    const freqs = [110, 164.81, 220] // A2 E3 A3
    for (const [side, cents] of [['L', -8], ['R', 8]]) {
      for (const f of freqs) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'
        o.frequency.value = f; o.detune.value = cents + (Math.random() * 4 - 2)
        const g = ctx.createGain(); g.gain.value = 0.16
        o.connect(g); g.connect(pan[side]); o.start(0)
      }
    }
    return normalize(await ctx.startRendering())
  }

  async function renderGlassBells() {
    // FM bells (mod ratio ~3) cascading down the pentatonic, alternating pans.
    const dur = 6, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const out = ctx.createGain(); out.connect(ctx.destination)
    const dly = ctx.createDelay(1); dly.delayTime.value = 0.28
    const fb = ctx.createGain(); fb.gain.value = 0.35
    dly.connect(fb); fb.connect(dly); dly.connect(out)
    const notes = [659.25, 523.25, 440, 392, 329.63] // E5 C5 A4 G4 E4
    notes.forEach((f, i) => {
      const t = i * 0.5
      const mod = ctx.createOscillator(); mod.frequency.value = f * 3.01
      const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 2.5)
      const car = ctx.createOscillator(); car.frequency.value = f
      mod.connect(mg); mg.connect(car.frequency)
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.5, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 3.5)
      const p = ctx.createStereoPanner(); p.pan.value = i % 2 ? 0.5 : -0.5
      car.connect(g); g.connect(p); p.connect(out); g.connect(dly)
      mod.start(t); car.start(t)
    })
    return normalize(await ctx.startRendering())
  }

  async function renderDeepBloomSub() {
    // F1 sine sub whose 2nd and 3rd partials bloom in late, softly saturated.
    const dur = 5, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(1.6 * x) }
    shaper.curve = curve
    const master = ctx.createGain(); master.gain.setValueAtTime(0, 0)
    master.gain.linearRampToValueAtTime(1, 0.35); master.gain.setValueAtTime(1, dur - 1.2); master.gain.linearRampToValueAtTime(0, dur)
    shaper.connect(master); master.connect(ctx.destination)
    const f0 = 43.65
    const partials = [[1, 0.9, 0], [2, 0.3, 1.5], [3, 0.18, 2.5]]
    for (const [mult, amp, when] of partials) {
      const o = ctx.createOscillator(); o.frequency.value = f0 * mult
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, 0)
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(amp, when + 1.2)
      o.connect(g); g.connect(shaper); o.start(0)
    }
    return normalize(await ctx.startRendering())
  }

  async function renderVelvetKeys() {
    // Cmaj9 electric-piano chord: sine + 4th partial, tremolo, tape warble.
    const dur = 6, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const out = ctx.createGain(); out.connect(ctx.destination)
    const trem = ctx.createGain(); trem.gain.value = 0.85
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.4
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.15
    lfo.connect(lfoG); lfoG.connect(trem.gain); lfo.start(0)
    trem.connect(out)
    const warble = ctx.createOscillator(); warble.frequency.value = 0.7
    const warbleG = ctx.createGain(); warbleG.gain.value = 4 // ±4 cents
    warble.connect(warbleG); warble.start(0)
    const midis = [48, 52, 55, 59, 62] // C3 E3 G3 B3 D4
    midis.forEach((m, i) => {
      const f = 440 * Math.pow(2, (m - 69) / 12)
      const g = ctx.createGain(); g.gain.setValueAtTime(0, 0)
      g.gain.linearRampToValueAtTime(0.22, 0.012); g.gain.exponentialRampToValueAtTime(0.004, dur - 0.2)
      const p = ctx.createStereoPanner(); p.pan.value = (i - 2) * 0.2
      g.connect(p); p.connect(trem)
      for (const [mult, amp] of [[1, 1], [4, 0.12]]) {
        const o = ctx.createOscillator(); o.frequency.value = f * mult
        warbleG.connect(o.detune)
        const og = ctx.createGain(); og.gain.value = amp
        o.connect(og); og.connect(g); o.start(0)
      }
    })
    return normalize(await ctx.startRendering())
  }

  async function renderRainStatic() {
    // Gated band-passed noise over a quiet noise bed, with a dotted delay.
    const dur = 8, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const noiseBuf = ctx.createBuffer(2, SR * dur, SR)
    for (let c = 0; c < 2; c++) { const d = noiseBuf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1 }
    const out = ctx.createGain(); out.connect(ctx.destination)
    // bed
    const bed = ctx.createBufferSource(); bed.buffer = noiseBuf
    const bedF = ctx.createBiquadFilter(); bedF.type = 'lowpass'; bedF.frequency.value = 900
    const bedG = ctx.createGain(); bedG.gain.value = 0.05
    bed.connect(bedF); bedF.connect(bedG); bedG.connect(out); bed.start(0)
    // gated bursts
    const src = ctx.createBufferSource(); src.buffer = noiseBuf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 1.6
    const gate = ctx.createGain(); gate.gain.setValueAtTime(0, 0)
    const step = 0.125 // 16ths at 120 bpm
    const pattern = [1, 0, 0.6, 0, 0.8, 0.3, 0, 0.7, 1, 0, 0.5, 0.9, 0, 0.6, 0.2, 0]
    for (let t = 0; t < dur - 0.3; t += step) {
      const v = pattern[Math.round(t / step) % pattern.length]
      if (v > 0) { gate.gain.setValueAtTime(0.5 * v, t); gate.gain.exponentialRampToValueAtTime(0.001, t + step * 0.9) }
    }
    const dly = ctx.createDelay(1); dly.delayTime.value = step * 3
    const fb = ctx.createGain(); fb.gain.value = 0.4
    dly.connect(fb); fb.connect(dly)
    src.connect(bp); bp.connect(gate); gate.connect(out); gate.connect(dly); dly.connect(out)
    src.start(0)
    return normalize(await ctx.startRendering())
  }

  async function renderSolarRiser() {
    // Saw + noise, two-octave exponential rise, accelerating pulse — cuts dead.
    const dur = 6, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const out = ctx.createGain()
    out.gain.setValueAtTime(0.25, 0); out.gain.linearRampToValueAtTime(1, dur - 0.05); out.gain.setValueAtTime(0, dur - 0.02)
    out.connect(ctx.destination)
    const o = ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(440, dur)
    const noiseBuf = ctx.createBuffer(1, SR * dur, SR)
    { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1 }
    const n = ctx.createBufferSource(); n.buffer = noiseBuf
    const nG = ctx.createGain(); nG.gain.setValueAtTime(0.05, 0); nG.gain.linearRampToValueAtTime(0.35, dur)
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2
    bp.frequency.setValueAtTime(500, 0); bp.frequency.exponentialRampToValueAtTime(6000, dur)
    const pulse = ctx.createGain(); pulse.gain.value = 0.8
    // accelerating tremolo: schedule dips by hand
    let t = 0, rate = 4
    while (t < dur - 0.1) {
      const period = 1 / rate
      pulse.gain.setValueAtTime(1, t); pulse.gain.setValueAtTime(0.35, t + period * 0.5)
      t += period; rate = Math.min(16, rate * 1.09)
    }
    o.connect(bp); n.connect(nG); nG.connect(bp); bp.connect(pulse); pulse.connect(out)
    o.start(0); n.start(0)
    return normalize(await ctx.startRendering())
  }

  async function renderKotoPluck() {
    // Karplus-Strong: noise burst into a damped feedback delay. A3, then E4.
    const dur = 4, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const out = ctx.createGain(); out.connect(ctx.destination)
    function pluck(freq, when, pan) {
      const burst = ctx.createBuffer(1, Math.floor(SR * 0.006), SR)
      { const d = burst.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1 }
      const src = ctx.createBufferSource(); src.buffer = burst
      const dly = ctx.createDelay(0.1); dly.delayTime.value = 1 / freq
      // Biquad lowpass Q is in dB — anything ≥ 0 peaks at the cutoff and
      // pushes loop gain past 1, so the string grows instead of decaying.
      const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 3800; damp.Q.value = -6
      const fb = ctx.createGain(); fb.gain.value = 0.98
      const p = ctx.createStereoPanner(); p.pan.value = pan
      src.connect(dly); dly.connect(damp); damp.connect(fb); fb.connect(dly)
      damp.connect(p); p.connect(out)
      src.start(when)
    }
    pluck(220, 0, -0.3)      // A3
    pluck(329.63, 1.6, 0.35) // E4
    return normalize(await ctx.startRendering())
  }

  async function renderCathedralDrone() {
    // Detuned fifth-stack (D2 A2 D3 A3) breathing through cross-fed delays.
    const dur = 10, ctx = new OfflineAudioContext(2, SR * dur, SR)
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55
    hp.connect(ctx.destination)
    const breath = ctx.createGain(); breath.gain.value = 0.7
    const blfo = ctx.createOscillator(); blfo.frequency.value = 0.15
    const blfoG = ctx.createGain(); blfoG.gain.value = 0.25
    blfo.connect(blfoG); blfoG.connect(breath.gain); blfo.start(0)
    const fade = ctx.createGain(); fade.gain.setValueAtTime(0, 0)
    fade.gain.linearRampToValueAtTime(1, 3); fade.gain.setValueAtTime(1, dur - 3); fade.gain.linearRampToValueAtTime(0, dur)
    breath.connect(fade); fade.connect(hp)
    const dA = ctx.createDelay(1), dB = ctx.createDelay(1)
    dA.delayTime.value = 0.31; dB.delayTime.value = 0.47
    const fA = ctx.createGain(), fB = ctx.createGain()
    fA.gain.value = 0.45; fB.gain.value = 0.45
    dA.connect(fA); fA.connect(dB); dB.connect(fB); fB.connect(dA)
    dA.connect(fade); dB.connect(fade)
    const freqs = [73.42, 110, 146.83, 220] // D2 A2 D3 A3
    freqs.forEach((f, i) => {
      for (const det of [-3, 3.5]) {
        const o = ctx.createOscillator(); o.type = i < 2 ? 'triangle' : 'sine'
        o.frequency.value = f; o.detune.value = det
        const g = ctx.createGain(); g.gain.value = 0.14
        o.connect(g); g.connect(breath); g.connect(dA)
        o.start(0)
      }
    })
    return normalize(await ctx.startRendering())
  }

  const SAMPLES = [
    { name: 'Aurora Pad', category: 'synth', tags: ['ambient', 'electronic'], render: renderAuroraPad,
      description: 'Six detuned saws breathing through a slow filter sweep. Stretch it under a whole section — it sustains to any note length.' },
    { name: 'Glass Bell Cascade', category: 'piano', tags: ['melody', 'ambient'], render: renderGlassBells,
      description: 'FM bells falling down the pentatonic with a soft echo. Lovely at half speed.' },
    { name: 'Deep Bloom Sub', category: 'synth', tags: ['bass', 'electronic'], render: renderDeepBloomSub,
      description: 'An F1 sub that blooms its own harmonics after a second and a half. Foundation for anything dark.' },
    { name: 'Velvet Keys', category: 'piano', tags: ['lofi', 'melody'], render: renderVelvetKeys,
      description: 'A Cmaj9 electric-piano chord with tremolo and tape warble baked in. Instant late-night.' },
    { name: 'Rain Static', category: 'other', tags: ['experimental', 'lofi'], render: renderRainStatic,
      description: 'Rhythmically gated noise over a soft bed — percussion and atmosphere in one clip.' },
    { name: 'Solar Riser', category: 'darkwave', tags: ['electronic', 'experimental'], render: renderSolarRiser,
      description: 'A two-octave riser with an accelerating pulse that cuts dead at the top. Put it before the drop.' },
    { name: 'Koto Pluck', category: 'guitar', tags: ['melody', 'experimental'], render: renderKotoPluck,
      description: 'Physically-modeled plucked string — a real Karplus-Strong pluck, not a sample of one.' },
    { name: 'Cathedral Drone', category: 'darkwave', tags: ['ambient', 'experimental'], render: renderCathedralDrone,
      description: 'Detuned fifths breathing through cross-fed delays. Ten seconds of space that loops clean.' },
  ]

  // ── recipes ────────────────────────────────────────────────────────────────
  const C = (start, dur, ...pitches) => pitches.map(p => ({ pitch: p, startBeat: start, durationBeats: dur, velocity: 96 }))
  const recipe = (name, description, durationBeats, notes) => ({
    kind: 'recipe', name, description,
    payload: {
      rootNote: 0,
      spec: { trackName: name, instrument: { type: 'none', params: {} }, isDrumClip: false, durationBeats, usePreset: true, notes },
    },
  })

  const RECIPES = [
    recipe('Andalusian cadence (i–♭VII–♭VI–V)',
      'Am → G → F → E: the flamenco fall. Four steps down to a major V that never resolves — that’s the point. Loop it forever.',
      16, [...C(0, 4, 57, 60, 64), ...C(4, 4, 55, 59, 62), ...C(8, 4, 53, 57, 60), ...C(12, 4, 52, 56, 59)]),
    recipe('Doo-wop with sevenths (I–vi7–ii7–V7)',
      'C → Am7 → Dm7 → G7: the 50s corner-shop loop, upgraded with sevenths so every chord leans into the next.',
      16, [...C(0, 4, 60, 64, 67), ...C(4, 4, 57, 60, 64, 67), ...C(8, 4, 50, 53, 57, 60), ...C(12, 4, 55, 59, 62, 65)]),
    recipe('The Creep progression (I–III–IV–iv)',
      'C → E → F → Fm: a major-third jolt, then the minor iv melts it back home. Try melody notes that stay put while the chords move.',
      16, [...C(0, 4, 60, 64, 67), ...C(4, 4, 52, 56, 59), ...C(8, 4, 53, 57, 60), ...C(12, 4, 53, 56, 60)]),
    recipe('Minor line cliché (one chord, falling line)',
      'A minor holds still while one inner voice walks down A–G♯–G–F♯. The spy-movie move — tension from a single moving note.',
      16, [
        ...C(0, 16, 57, 60, 64),
        { pitch: 69, startBeat: 0, durationBeats: 4, velocity: 100 },
        { pitch: 68, startBeat: 4, durationBeats: 4, velocity: 100 },
        { pitch: 67, startBeat: 8, durationBeats: 4, velocity: 100 },
        { pitch: 66, startBeat: 12, durationBeats: 4, velocity: 100 },
      ]),
    recipe('Mixolydian vamp (I–♭VII–IV–I)',
      'C → B♭ → F → C: rock-and-roll swagger with no leading tone and no apology. Everything AC/DC and half of the Beatles.',
      16, [...C(0, 4, 60, 64, 67), ...C(4, 4, 58, 62, 65), ...C(8, 4, 53, 57, 60), ...C(12, 4, 60, 64, 67)]),
    recipe('Neo-soul turnaround (ii9–V13–Imaj9)',
      'Dm9 → G13 → Cmaj9: the extensions do the singing. Play it slow, add swing, and leave space between the chords.',
      24, [...C(0, 8, 50, 53, 60, 64), ...C(8, 8, 55, 59, 64, 65), ...C(16, 8, 60, 64, 67, 71, 74)]),
    recipe('Sus-and-release (Isus4–I, IVsus2–IV)',
      'Csus4 resolving to C, Fsus2 resolving to F: the suspension is the hook. Every resolution feels like an exhale.',
      16, [...C(0, 2, 60, 65, 67), ...C(2, 2, 60, 64, 67), ...C(4, 2, 60, 65, 67), ...C(6, 2, 60, 64, 67),
           ...C(8, 2, 53, 55, 60), ...C(10, 2, 53, 57, 60), ...C(12, 2, 53, 55, 60), ...C(14, 2, 53, 57, 60)]),
    recipe('The backdoor (ii7–♭VII7–I)',
      'Dm7 → B♭7 → C: sneak home through the back door instead of the V. Jazz standards do this constantly; so does Stevie.',
      16, [...C(0, 4, 50, 53, 57, 60), ...C(4, 4, 58, 62, 65, 68), ...C(8, 8, 60, 64, 67)]),
  ]

  // ── run ────────────────────────────────────────────────────────────────────
  for (const s of SAMPLES) {
    if (skip.has(s.name)) { results.push({ name: s.name, skipped: true }); continue }
    try {
      const buf = await s.render()
      const blob = toWav(buf)
      const key = await upload(blob)
      const id = await post({
        kind: 'sample', name: s.name, description: s.description, r2Key: key,
        payload: { category: s.category, duration: buf.duration, contentType: 'audio/wav', tags: s.tags, peaks: peaksOf(buf) },
      })
      results.push({ name: s.name, id, bytes: blob.size, seconds: buf.duration })
    } catch (e) { results.push({ name: s.name, error: String(e) }) }
  }
  for (const r of RECIPES) {
    if (skip.has(r.name)) { results.push({ name: r.name, skipped: true }); continue }
    try {
      const id = await post(r)
      results.push({ name: r.name, id })
    } catch (e) { results.push({ name: r.name, error: String(e) }) }
  }
  return results
}
