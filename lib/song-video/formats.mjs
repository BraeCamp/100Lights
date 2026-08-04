// ── Song-video formats — pluggable visualizers ──────────────────────────────
// Each format: create(song, opts) -> { draw(f), onHit?(note, f) }. `f` is the
// per-frame context from the harness (engine.mjs): { ctx, W, H, beat, pulse,
// SPB, LOOP, now, px, hexa, rr, fieldTop, fieldBot, accent, tracks }. The harness
// owns the clock, synth, note-onset detection, and the shared brand/meta/hook
// chrome; a format only draws the note visualization inside the field.
// Add a format here + register it at the bottom — that's the whole extension point.

const col = (f, tr) => f.tracks[tr]?.color || f.accent
const pRange = s => { const ps = s.notes.map(n => n.p); return [Math.min(...ps), Math.max(...ps)] }

// 1 · FALLING NOTES — piano-roll bars fall onto a glowing hit line.
function fallingNotes(song, opts) {
  const LOOP = opts.loopBeats
  return { draw(f) {
    const { ctx, W, H, beat: b, pulse } = f
    const hitY = H * 0.70, keyW = W * 0.052, PXB = H * 0.156
    for (let k = -1; k < LOOP + 1; k++) { const y = hitY - (k - b) * PXB; if (y < -20 || y > H + 20) continue
      ctx.strokeStyle = (k % 4 === 0) ? f.hexa(f.accent, 0.09) : 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    for (const n of song.notes) { const c = col(f, n.tr), w = keyW * (n.tr === 0 ? 1.5 : 1)
      for (let k = -1; k <= 1; k++) { const s = n.s + k * LOOP; const by = hitY - (s - b) * PXB, ty = by - n.d * PXB; if (by < -40 || ty > H + 40) continue
        const x = f.px(n.p) - w / 2, near = Math.max(0, 1 - Math.abs(by - hitY) / (H * 0.5)), active = (b >= s && b <= s + n.d)
        const bright = 0.28 + 0.5 * near + (active ? 0.22 : 0)
        if (near > 0.35 || active) { ctx.shadowColor = f.hexa(c, 0.9); ctx.shadowBlur = 14 + 18 * near } else ctx.shadowBlur = 0
        const h = Math.max(6, by - ty); f.rr(x, ty, w, h, Math.min(w / 2, 7)); ctx.fillStyle = f.hexa(c, Math.min(0.95, bright)); ctx.fill(); ctx.shadowBlur = 0
        ctx.fillStyle = f.hexa('#ffffff', 0.14 * near); f.rr(x, ty, w, Math.min(4, h), 2); ctx.fill()
      }
    }
    ctx.save(); ctx.shadowColor = f.hexa(f.accent, 0.5 + 0.4 * pulse); ctx.shadowBlur = 20 + 30 * pulse
    ctx.strokeStyle = `rgba(236,234,253,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, hitY); ctx.lineTo(W, hitY); ctx.stroke(); ctx.restore()
  } }
}

// 2 · 100 LIGHTS — a constellation: every pitch is a light that flares on its hit
// then dims. Bounded + additive, so it glows on the beat without washing out.
function lights(song) {
  const uniq = [...new Set(song.notes.map(n => n.p))]
  const level = Object.create(null), colr = Object.create(null), pos = Object.create(null)
  const rnd = (p, k) => { const h = Math.sin(p * (k === 0 ? 12.9898 : 78.233) + k) * 43758.5453; return h - Math.floor(h) }
  uniq.forEach(p => { pos[p] = { fx: 0.10 + rnd(p, 0) * 0.80, fy: 0.06 + rnd(p, 1) * 0.86 } }) // stable scatter
  return {
    onHit(n, f) { level[n.p] = Math.max(level[n.p] || 0, 0.55 + 0.45 * (n.v / 100)); colr[n.p] = col(f, n.tr) },
    draw(f) {
      const { ctx } = f, span = f.fieldBot - f.fieldTop
      ctx.globalCompositeOperation = 'lighter'
      for (const p of uniq) {
        const lv = level[p] || 0, x = pos[p].fx * f.W, y = f.fieldTop + pos[p].fy * span, c = colr[p] || f.accent
        const r = 4 + lv * 17, br = Math.min(0.6, 0.07 + lv * 0.55)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, f.hexa(c, br)); g.addColorStop(0.5, f.hexa(c, br * 0.28)); g.addColorStop(1, f.hexa(c, 0))
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
        ctx.fillStyle = f.hexa('#ffffff', Math.min(0.85, lv * 0.9)); ctx.beginPath(); ctx.arc(x, y, 1.2 + lv * 2.2, 0, 7); ctx.fill()
        level[p] = lv * 0.9
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

// 3 · BARS — a clean upward equalizer: each pitch band rises on its hit, decays.
function bars(song, opts) {
  const N = 18, [lo, hi] = pRange(song)
  const e = new Array(N).fill(0), c = new Array(N).fill(opts.accent)
  const bucket = p => Math.max(0, Math.min(N - 1, Math.round((p - lo) / Math.max(1, hi - lo) * (N - 1))))
  return {
    onHit(n, f) { const b = bucket(n.p); e[b] = Math.min(1, Math.max(e[b], 0.35 + 0.65 * (n.v / 100))); c[b] = col(f, n.tr) },
    draw(f) {
      const { ctx, W } = f, span = f.fieldBot - f.fieldTop, baseY = f.fieldBot - span * 0.06, maxH = span * 0.74
      const gap = W * 0.012, bw = (W * 0.88 - gap * (N - 1)) / N, x0 = W * 0.06
      for (let i = 0; i < N; i++) { e[i] *= 0.86; const h = Math.max(bw * 0.5, maxH * e[i]), x = x0 + i * (bw + gap)
        const grad = ctx.createLinearGradient(0, baseY - h, 0, baseY); grad.addColorStop(0, f.hexa(c[i], 0.95)); grad.addColorStop(1, f.hexa(c[i], 0.35))
        ctx.shadowColor = f.hexa(c[i], 0.7 * e[i]); ctx.shadowBlur = 18 * e[i]
        f.rr(x, baseY - h, bw, h, Math.min(bw / 2, 5)); ctx.fillStyle = grad; ctx.fill(); ctx.shadowBlur = 0
      }
      ctx.fillStyle = f.hexa(f.accent, 0.10); f.rr(x0, baseY + 2, W * 0.88, 2, 1); ctx.fill()
    },
  }
}

// 4 · TUNNEL — a perspective highway: notes rush out of a vanishing point toward a
// near line, hitting on the beat. Depth + motion = the most dynamic look.
function tunnel(song, opts) {
  const LOOP = opts.loopBeats, [lo, hi] = pRange(song)
  const lanes = 7, LOOK = 8
  let flashes = []
  return {
    onHit(n, f) { flashes.push({ p: n.p, colr: col(f, n.tr), born: f.now }) },
    draw(f) {
      const { ctx, W, beat: b, pulse } = f
      const span = f.fieldBot - f.fieldTop, cx = W / 2, vy = f.fieldTop + span * 0.30, hitY = f.fieldBot - span * 0.06
      const nx0 = 0.1 * W, nx1 = 0.9 * W
      const px = p => nx0 + (p - lo) / Math.max(1, hi - lo) * (nx1 - nx0)
      const laneX = i => nx0 + (i / (lanes - 1)) * (nx1 - nx0)
      const sc = dt => 1 / (1 + Math.max(0, dt) * 0.42)
      // converging lane lines + depth rings
      ctx.strokeStyle = f.hexa(f.accent, 0.10); ctx.lineWidth = 1
      for (let i = 0; i < lanes; i++) { ctx.beginPath(); ctx.moveTo(cx, vy); ctx.lineTo(laneX(i), hitY); ctx.stroke() }
      for (let dt = 0; dt <= LOOK; dt++) { const s = sc(dt), y = vy + (hitY - vy) * s, wl = (nx1 - nx0) * s / 2
        ctx.strokeStyle = f.hexa(f.accent, 0.04 + 0.05 * s); ctx.beginPath(); ctx.moveTo(cx - wl, y); ctx.lineTo(cx + wl, y); ctx.stroke() }
      // notes, painted far-to-near
      const drawn = []
      for (const n of song.notes) for (let k = 0; k <= 2; k++) { const dt = (n.s + k * LOOP) - b; if (dt < -0.4 || dt > LOOK) continue
        const s = sc(dt), x = cx + (px(n.p) - cx) * s, y = vy + (hitY - vy) * s
        drawn.push({ s, x, y, w: 42 * s, h: Math.max(4, n.d * 20 * s), c: col(f, n.tr) }) }
      drawn.sort((a, z) => a.s - z.s)
      for (const d of drawn) { const bright = 0.3 + 0.6 * d.s
        if (d.s > 0.55) { ctx.shadowColor = f.hexa(d.c, 0.8); ctx.shadowBlur = 16 * d.s } else ctx.shadowBlur = 0
        f.rr(d.x - d.w / 2, d.y - d.h, d.w, d.h, Math.min(d.w / 2, 6)); ctx.fillStyle = f.hexa(d.c, Math.min(0.95, bright)); ctx.fill(); ctx.shadowBlur = 0 }
      // near line + hit flashes
      ctx.strokeStyle = f.hexa('#eceafd', 0.4 + 0.4 * pulse); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(nx0 - 12, hitY); ctx.lineTo(nx1 + 12, hitY); ctx.stroke()
      for (let i = flashes.length - 1; i >= 0; i--) { const fl = flashes[i], age = (f.now - fl.born) / 450; if (age >= 1) { flashes.splice(i, 1); continue }
        const x = px(fl.p), a = 1 - age
        ctx.strokeStyle = f.hexa(fl.colr, a * 0.7); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, hitY, 6 + age * 42, 0, 7); ctx.stroke()
        ctx.fillStyle = f.hexa(fl.colr, a); ctx.beginPath(); ctx.arc(x, hitY, 4, 0, 7); ctx.fill() }
    },
  }
}

// 5 · FLOW — a from-scratch paradigm: not notes on a plane at all. Light particles
// stream along a slow, living vector field; each note recolors + ignites nearby
// particles and kicks the whole field's speed. Generative, reactive liquid light.
function flow(song) {
  const [lo, hi] = pRange(song)
  const P = 230, TRAIL = 9, parts = []
  let seeded = false, kick = 0
  const px = p => 0.1 + (p - lo) / Math.max(1, hi - lo) * 0.8
  return {
    onHit(n, f) {
      kick = Math.min(1.6, kick + 0.5 * (n.v / 100))
      const nx = px(n.p) * f.W, c = col(f, n.tr)
      let cnt = 0
      for (const p of parts) { if (cnt >= 12) break; if (Math.abs(p.x - nx) < f.W * 0.13) { p.c = c; p.br = 1.5; cnt++ } }
    },
    draw(f) {
      const { ctx, W, now, pulse } = f, top = f.fieldTop, bot = f.fieldBot, H = bot - top, t = now * 0.0011
      if (!seeded) { for (let i = 0; i < P; i++) { const x = Math.random() * W, y = top + Math.random() * H; parts.push({ x, y, tr: [{ x, y }], c: f.accent, br: 0.5 }) } seeded = true }
      kick *= 0.94
      const speed = 1.6 + kick * 3.4
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'
      const a = 0.0065, b = 0.0065, s = 0.004
      for (const p of parts) {
        // Curl of a scalar potential = divergence-free flow → swirls, no sinks, even fill.
        const dPdx = a * Math.cos(p.x * a + t) + 0.5 * s * Math.cos((p.x + p.y) * s + t * 0.6)
        const dPdy = -b * Math.sin(p.y * b - t * 0.8) + 0.5 * s * Math.cos((p.x + p.y) * s + t * 0.6)
        let vx = dPdy, vy = -dPdx; const mag = Math.hypot(vx, vy) || 1; vx = vx / mag * speed; vy = vy / mag * speed
        p.x += vx; p.y += vy
        let wrapped = false
        if (p.x < 0) { p.x += W; wrapped = true } else if (p.x > W) { p.x -= W; wrapped = true }
        if (p.y < top) { p.y += H; wrapped = true } else if (p.y > bot) { p.y -= H; wrapped = true }
        if (wrapped) p.tr = [{ x: p.x, y: p.y }]
        else { p.tr.push({ x: p.x, y: p.y }); if (p.tr.length > TRAIL) p.tr.shift() }
        const base = Math.min(0.75, (0.13 + 0.4 * Math.max(0, p.br)) * (0.75 + 0.4 * pulse))
        for (let i = 1; i < p.tr.length; i++) {
          const g = i / p.tr.length
          ctx.strokeStyle = f.hexa(p.c, base * g); ctx.lineWidth = 1 + 2.4 * g * Math.min(1.3, p.br)
          ctx.beginPath(); ctx.moveTo(p.tr[i - 1].x, p.tr[i - 1].y); ctx.lineTo(p.tr[i].x, p.tr[i].y); ctx.stroke()
        }
        p.br = Math.max(0.42, p.br * 0.96) // floor so the field is always visible
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

// 6 · STEM BUILDER — the "add one instrument at a time" format. A different
// paradigm from the note-plane looks above: the loop is split into phases and one
// track-lane enters per phase (audio + visual), stacking until the full arrangement
// plays. Each active lane is a mini step-pattern with a sweeping playhead; a
// "+ NAME" caption fires as each layer drops in. Uses fmt.audible() so the preview
// synth actually builds up in step with the visual.
function stems(song, opts) {
  const LOOP = opts.loopBeats
  // The layers = tracks that have notes, richest first, capped so lanes stay legible,
  // then back into track order for a stable top-to-bottom stack.
  const count = Object.create(null)
  for (const n of song.notes) count[n.tr] = (count[n.tr] || 0) + 1
  const used = Object.keys(count).map(Number)
    .sort((a, b) => count[b] - count[a]).slice(0, 6)
    .sort((a, b) => a - b)
  const N = used.length || 1
  const perPhase = LOOP / N                          // beats before the next layer enters
  const laneOf = tr => used.indexOf(tr)
  const notesByTr = Object.create(null)
  const pr = Object.create(null)
  for (const tr of used) {
    const ns = song.notes.filter(n => n.tr === tr)
    notesByTr[tr] = ns
    const ps = ns.map(n => n.p); pr[tr] = [Math.min(...ps), Math.max(...ps)]
  }
  const activeCount = f => Math.min(N, Math.floor((f.beat % LOOP) / perPhase) + 1)
  const hit = Object.create(null)                    // tr -> last hit beat (lane pulse)

  return {
    audible(n, f) { const i = laneOf(n.tr); return i >= 0 && i < activeCount(f) },
    onHit(n, f) { if (laneOf(n.tr) >= 0) hit[n.tr] = f.beat },
    draw(f) {
      const { ctx, W, H } = f
      const top = f.fieldTop + H * 0.045, bot = f.fieldBot
      const gap = H * 0.013, laneH = (bot - top - gap * (N - 1)) / N
      const act = activeCount(f), lx = W * 0.06, lw = W * 0.88
      const phasePos = (f.beat % perPhase) / perPhase  // 0..1 within the current phase

      for (let i = 0; i < N; i++) {
        const tr = used[i], c = col(f, tr), on = i < act
        const y = top + i * (laneH + gap)
        // Lane frame — lit in the track colour once entered, ghosted while waiting.
        f.rr(lx, y, lw, laneH, 12)
        ctx.fillStyle = on ? f.hexa(c, 0.075) : 'rgba(255,255,255,0.02)'; ctx.fill()
        ctx.lineWidth = 1.4; ctx.strokeStyle = on ? f.hexa(c, 0.5) : 'rgba(255,255,255,0.05)'; ctx.stroke()

        if (on) {
          // Mini step-pattern: the track's notes placed by time × pitch, brightening
          // as the sweeping playhead reaches them.
          const gx = lx + W * 0.015, gw = lw - W * 0.03, gy = y + laneH * 0.16, gh = laneH * 0.68
          const [pmin, pmax] = pr[tr], span = Math.max(1, pmax - pmin)
          const phx = gx + ((f.beat % LOOP) / LOOP) * gw
          for (const n of notesByTr[tr]) {
            const nx = gx + ((n.s % LOOP) / LOOP) * gw
            const nw = Math.max(3, (n.d / LOOP) * gw * 0.9)
            const ny = gy + gh * (1 - (n.p - pmin) / span)
            const near = Math.max(0, 1 - Math.abs(phx - nx) / (W * 0.05))
            ctx.save()
            if (near > 0.2) { ctx.globalCompositeOperation = 'lighter'; ctx.shadowColor = f.hexa(c, 0.9); ctx.shadowBlur = 10 * near }
            f.rr(nx, ny - 2.5, nw, 5, 2.5); ctx.fillStyle = f.hexa(c, 0.4 + 0.55 * near); ctx.fill()
            ctx.restore()
          }
          // Playhead.
          ctx.fillStyle = f.hexa('#ffffff', 0.22); ctx.fillRect(phx, y + laneH * 0.12, 1.5, laneH * 0.76)
          // Whole-lane pulse right after a hit.
          const dt = ((f.beat - (hit[tr] ?? -9)) % LOOP + LOOP) % LOOP, pl = Math.max(0, 1 - dt / 0.4)
          if (pl > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; f.rr(lx, y, lw, laneH, 12); ctx.fillStyle = f.hexa(c, 0.09 * pl); ctx.fill(); ctx.restore() }
        }

        // Label tag (own chip so it stays readable over the pattern).
        const name = (f.tracks[tr]?.name || `Track ${tr + 1}`).toUpperCase()
        ctx.font = `800 ${Math.round(H * 0.019)}px system-ui`
        const tw = ctx.measureText(name).width
        f.rr(lx + W * 0.02, y + laneH * 0.5 - H * 0.016, tw + W * 0.03, H * 0.032, 7)
        ctx.fillStyle = on ? f.hexa(c, 0.9) : 'rgba(20,18,32,0.7)'; ctx.fill()
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ctx.fillStyle = on ? '#0a0812' : 'rgba(160,158,180,0.5)'
        ctx.fillText(name, lx + W * 0.035, y + laneH * 0.5 + 1)
        if (!on) { ctx.textAlign = 'right'; ctx.font = `600 ${Math.round(H * 0.015)}px ui-monospace, monospace`; ctx.fillStyle = 'rgba(160,158,180,0.3)'; ctx.fillText('waiting', lx + lw - W * 0.02, y + laneH * 0.5 + 1) }
      }

      // Caption: "+ NAME" as each layer drops, otherwise the layer counter.
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      const capY = f.fieldTop + H * 0.006
      if (phasePos < 0.4 && act - 1 >= 0) {
        const tr = used[act - 1], a = 1 - phasePos / 0.4
        ctx.font = `800 ${Math.round(H * 0.032)}px system-ui`
        ctx.fillStyle = f.hexa(col(f, tr), 0.85 * a + 0.15)
        ctx.fillText('+ ' + (f.tracks[tr]?.name || `Track ${tr + 1}`).toUpperCase(), W / 2, capY)
      } else {
        ctx.font = `700 ${Math.round(H * 0.02)}px ui-monospace, monospace`
        ctx.fillStyle = 'rgba(200,198,220,0.55)'
        ctx.fillText(`${act} / ${N} layers`, W / 2, capY)
      }
    },
  }
}

export const FORMATS = {
  'falling-notes': { name: 'Falling notes', create: fallingNotes },
  'stems': { name: 'Stem builder', create: stems },
  'flow': { name: 'Flow', create: flow },
  'tunnel': { name: 'Tunnel', create: tunnel },
  'lights': { name: '100 Lights', create: lights },
  'bars': { name: 'Bars', create: bars },
  // 'radial' — WIP (washes out; needs rework). Add here once fixed.
}
export const FORMAT_IDS = Object.keys(FORMATS)
