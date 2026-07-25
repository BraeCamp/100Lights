'use client'

// Interactive channel strip for the "Volume, Pan, and EQ" article.
//
// The @ab widgets elsewhere in the piece let the reader HEAR a before/after
// somebody else prepared. This lets them DO it: a real Web Audio chain —
// volume → pan → high-pass → a sweepable cut band → out — running over the
// article's own muddy demo mix (`mix-mud`: drums, bass, pad, lead, centred,
// full-range). Every move the article names is a control here, in the order it
// names them, and the "hold to hear it flat" button is the A/B the whole piece
// is built on.
//
// The EQ curve is drawn from the filters' own getFrequencyResponse(), so what
// the reader sees is exactly what the filters do — no approximation.

import { useEffect, useRef, useState, useCallback } from 'react'
import { Play, Square, RotateCcw } from 'lucide-react'

let _ctx: AudioContext | null = null
const ctx = () => (_ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)())

const ACCENT = '#a78bfa'
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const dbFromGain = (g: number) => (g <= 0.0001 ? -Infinity : 20 * Math.log10(g))
const fmtHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`)
const panLabel = (p: number) => (Math.abs(p) < 0.03 ? 'Centre' : `${Math.round(Math.abs(p) * 100)}% ${p < 0 ? 'L' : 'R'}`)

export default function ArticleMixer({ src, caption }: { src: string; caption?: string }) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  // Control state (also drives the readouts + the curve).
  const [vol, setVol] = useState(0.9)      // linear gain
  const [pan, setPan] = useState(0)        // -1..1
  const [hpOn, setHpOn] = useState(false)
  const [hpHz, setHpHz] = useState(120)
  const [eqHz, setEqHz] = useState(320)
  const [eqDb, setEqDb] = useState(0)      // + to find, − to cut
  const [eqQ, setEqQ] = useState(2)
  const [flat, setFlat] = useState(false)  // momentary "hear it flat" compare

  const bufRef = useRef<AudioBuffer | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const hpRef = useRef<BiquadFilterNode | null>(null)
  const eqRef = useRef<BiquadFilterNode | null>(null)
  const panRef = useRef<StereoPannerNode | null>(null)
  const volRef = useRef<GainNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Build the persistent node chain once. Nodes exist immediately (the context
  // starts suspended — legal, and getFrequencyResponse still works), so the EQ
  // curve is live before the first Play.
  useEffect(() => {
    const c = ctx()
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 20
    const eq = c.createBiquadFilter(); eq.type = 'peaking'; eq.frequency.value = 320; eq.Q.value = 2; eq.gain.value = 0
    const pn = c.createStereoPanner()
    const gn = c.createGain(); gn.gain.value = 0.9
    hp.connect(eq); eq.connect(pn); pn.connect(gn); gn.connect(c.destination)
    hpRef.current = hp; eqRef.current = eq; panRef.current = pn; volRef.current = gn

    let cancelled = false
    fetch(src)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
      .then(ab => c.decodeAudioData(ab))
      .then(buf => { if (!cancelled) { bufRef.current = buf; setReady(true) } })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      try { srcRef.current?.stop() } catch { /* already stopped */ }
      hp.disconnect(); eq.disconnect(); pn.disconnect(); gn.disconnect()
    }
  }, [src])

  // Push control values onto the live nodes (smoothed so dragging doesn't zip).
  useEffect(() => { const n = volRef.current; if (n) n.gain.setTargetAtTime(vol, ctx().currentTime, 0.01) }, [vol])
  useEffect(() => { const n = panRef.current; if (n) n.pan.setTargetAtTime(pan, ctx().currentTime, 0.01) }, [pan])
  useEffect(() => { const n = hpRef.current; if (n) n.frequency.setTargetAtTime(hpOn ? hpHz : 20, ctx().currentTime, 0.01) }, [hpOn, hpHz])
  useEffect(() => {
    const n = eqRef.current; if (!n) return
    n.frequency.setTargetAtTime(eqHz, ctx().currentTime, 0.01)
    n.gain.setTargetAtTime(eqDb, ctx().currentTime, 0.01)
    n.Q.setTargetAtTime(eqQ, ctx().currentTime, 0.01)
  }, [eqHz, eqDb, eqQ])

  // Reroute the running source past the EQ while "flat" is held down.
  const reroute = useCallback((bypass: boolean) => {
    const s = srcRef.current, hp = hpRef.current, pn = panRef.current
    if (!s || !hp || !pn) return
    try { s.disconnect() } catch { /* not connected */ }
    s.connect(bypass ? pn : hp)
  }, [])
  useEffect(() => { if (playing) reroute(flat) }, [flat, playing, reroute])

  const stop = useCallback(() => {
    try { srcRef.current?.stop() } catch { /* already stopped */ }
    srcRef.current = null
    setPlaying(false)
  }, [])

  function play() {
    const c = ctx(); void c.resume()
    if (!bufRef.current) return
    stop()
    const s = c.createBufferSource()
    s.buffer = bufRef.current
    s.loop = true
    s.connect(flat ? panRef.current! : hpRef.current!)
    s.start()
    s.onended = () => { /* loop=true never fires unless stopped */ }
    srcRef.current = s
    setPlaying(true)
  }

  useEffect(() => () => { try { srcRef.current?.stop() } catch { /* noop */ } }, [])

  function reset() {
    setVol(0.9); setPan(0); setHpOn(false); setHpHz(120); setEqHz(320); setEqDb(0); setEqQ(2)
  }

  // Draw the combined HP + peaking magnitude response from the filters directly.
  useEffect(() => {
    const cv = canvasRef.current, hp = hpRef.current, eq = eqRef.current
    if (!cv || !hp || !eq) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = cv.clientWidth, h = cv.clientHeight
    if (!w || !h) return
    cv.width = w * dpr; cv.height = h * dpr
    const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const N = 200
    const freqs = new Float32Array(N)
    for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1)) // 20 Hz → 20 kHz, log
    const mHp = new Float32Array(N), mEq = new Float32Array(N), ph = new Float32Array(N)
    hp.getFrequencyResponse(freqs, mHp, ph)
    eq.getFrequencyResponse(freqs, mEq, ph)

    const DB_TOP = 12, DB_BOT = -24
    const yFor = (db: number) => (DB_TOP - clamp(db, DB_BOT, DB_TOP)) / (DB_TOP - DB_BOT) * h
    // 0 dB grid line
    g.strokeStyle = 'rgba(148,148,168,0.28)'; g.lineWidth = 1
    g.beginPath(); g.moveTo(0, yFor(0)); g.lineTo(w, yFor(0)); g.stroke()
    // response
    g.strokeStyle = ACCENT; g.lineWidth = 2
    g.beginPath()
    for (let i = 0; i < N; i++) {
      const db = 20 * Math.log10(Math.max(1e-4, mHp[i] * mEq[i]))
      const x = (i / (N - 1)) * w
      const y = yFor(db)
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
    }
    g.stroke()
    // fill under the curve
    g.lineTo(w, h); g.lineTo(0, h); g.closePath()
    g.fillStyle = 'rgba(167,139,250,0.10)'; g.fill()
  }, [hpOn, hpHz, eqHz, eqDb, eqQ, ready])

  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ border: `1px solid ${ACCENT}55`, borderRadius: 14, padding: '16px 18px', background: 'rgba(167,139,250,0.05)' }}>
        {/* Transport */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <button
            onClick={() => (playing ? stop() : play())}
            disabled={!ready}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700,
              padding: '9px 18px', borderRadius: 10, border: 'none',
              cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5,
              background: playing ? ACCENT : 'rgba(167,139,250,0.2)', color: playing ? '#fff' : ACCENT,
            }}
          >
            {playing ? <Square size={13} fill="currentColor" /> : <Play size={14} />}
            {playing ? 'Stop' : failed ? 'Audio unavailable' : ready ? 'Play the mix' : 'Loading…'}
          </button>
          <button
            onPointerDown={() => setFlat(true)}
            onPointerUp={() => setFlat(false)}
            onPointerLeave={() => setFlat(false)}
            onPointerCancel={() => setFlat(false)}
            disabled={!playing}
            style={{
              fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 10, cursor: playing ? 'pointer' : 'default',
              border: `1px solid ${flat ? ACCENT : 'var(--border)'}`, userSelect: 'none', touchAction: 'none',
              background: flat ? 'rgba(167,139,250,0.22)' : 'var(--bg-card)', color: flat ? ACCENT : 'var(--text-secondary)',
              opacity: playing ? 1 : 0.5,
            }}
          >
            Hold: hear it flat
          </button>
          <button
            onClick={reset}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', marginLeft: 'auto' }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>

        {/* Volume + Pan */}
        <Control label="Volume" value={vol <= 0.0001 ? '−∞ dB' : `${dbFromGain(vol) >= 0 ? '+' : ''}${dbFromGain(vol).toFixed(1)} dB`}>
          <input type="range" min={0} max={1.2} step={0.001} value={vol} onChange={e => setVol(+e.target.value)} style={rangeStyle} aria-label="Volume" />
        </Control>
        <Control label="Pan" value={panLabel(pan)}>
          <input type="range" min={-1} max={1} step={0.01} value={pan} onChange={e => setPan(+e.target.value)} style={rangeStyle} aria-label="Pan" />
        </Control>

        {/* EQ */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>EQ — CUT WHAT&rsquo;S IN THE WAY</span>
          </div>

          {/* Response curve */}
          <canvas ref={canvasRef} style={{ width: '100%', height: 76, display: 'block', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)' }} aria-hidden="true" />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', margin: '3px 2px 12px', fontWeight: 600 }}>
            <span>20 Hz</span><span>200</span><span>2 kHz</span><span>20 kHz</span>
          </div>

          {/* High-pass */}
          <Control
            label={<label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: hpOn ? ACCENT : 'var(--text-secondary)' }}>
              <input type="checkbox" checked={hpOn} onChange={e => setHpOn(e.target.checked)} style={{ accentColor: ACCENT, width: 14, height: 14 }} /> High-pass
            </label>}
            value={hpOn ? fmtHz(hpHz) : 'off'}
          >
            <input type="range" min={20} max={1000} step={1} value={hpHz} onChange={e => setHpHz(+e.target.value)} disabled={!hpOn} style={{ ...rangeStyle, opacity: hpOn ? 1 : 0.4 }} aria-label="High-pass frequency" />
          </Control>

          {/* Sweepable cut band */}
          <Control label="Find it — frequency" value={fmtHz(eqHz)}>
            <input type="range" min={80} max={8000} step={1} value={eqHz} onChange={e => setEqHz(+e.target.value)} style={rangeStyle} aria-label="EQ band frequency" />
          </Control>
          <Control label="Boost to find, then cut" value={`${eqDb >= 0 ? '+' : ''}${eqDb.toFixed(1)} dB`}>
            <input type="range" min={-15} max={6} step={0.1} value={eqDb} onChange={e => setEqDb(+e.target.value)} style={rangeStyle} aria-label="EQ band gain" />
          </Control>
          <Control label="Width (Q)" value={eqQ.toFixed(1)}>
            <input type="range" min={0.4} max={8} step={0.1} value={eqQ} onChange={e => setEqQ(+e.target.value)} style={rangeStyle} aria-label="EQ band Q" />
          </Control>
        </div>

        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
          This is the article&rsquo;s own muddy mix. Try it in order: pull <strong style={{ color: 'var(--text-secondary)' }}>Volume</strong> down until it&rsquo;s comfortable, spread the <strong style={{ color: 'var(--text-secondary)' }}>Pan</strong>, switch on the <strong style={{ color: 'var(--text-secondary)' }}>high-pass</strong>, then <strong style={{ color: 'var(--text-secondary)' }}>boost the cut band to +6</strong> and sweep until it sounds worst — that&rsquo;s the mud — and pull it down to a cut. <strong style={{ color: 'var(--text-secondary)' }}>Hold &ldquo;hear it flat&rdquo;</strong> to compare against no EQ at all.
        </p>
      </div>
      {caption && <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>}
    </figure>
  )
}

const rangeStyle: React.CSSProperties = { width: '100%', accentColor: ACCENT, cursor: 'pointer', height: 22 }

function Control({ label, value, children }: { label: React.ReactNode; value: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
        {typeof label === 'string' ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span> : label}
        <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      {children}
    </div>
  )
}
