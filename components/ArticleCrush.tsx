'use client'

// Grit and lo-fi. The groove runs through a soft-clip drive (a WaveShaper) and a
// bitcrusher (bit-depth quantize + sample-rate hold). Drive adds harmonics and
// warmth → fuzz; crushing throws away resolution for that dusty, downsampled
// sound. Hold bypass to hear the clean loop.

import { useEffect, useRef, useState } from 'react'
import { mixCtx, useLoopPlayer, rangeStyle, Frame, Transport, BypassButton, Control, SourcePicker } from './article/mix-kit'

function driveCurve(amount: number) {
  const n = 1024, curve = new Float32Array(n), k = amount * amount * 120
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)) }
  return curve
}

export default function ArticleCrush({ caption }: { caption?: string }) {
  const [drive, setDrive] = useState(0)
  const [bits, setBits] = useState(16)
  const [reduction, setReduction] = useState(1)   // sample-rate hold factor
  const [bypassed, setBypassed] = useState(false)

  const inputRef = useRef<AudioNode | null>(null)
  const shaperRef = useRef<WaveShaperNode | null>(null)
  const outRef = useRef<GainNode | null>(null)
  const params = useRef({ bits, reduction })
  params.current = { bits, reduction }
  const { ready, playing, play, stop, loadFile, useDemo, sourceName } = useLoopPlayer(inputRef, 'lofi')

  useEffect(() => {
    const c = mixCtx()
    const input = c.createGain()
    const shaper = c.createWaveShaper(); shaper.curve = driveCurve(0); shaper.oversample = '2x'
    // Bitcrusher: quantize amplitude to `bits` and hold each sample `reduction`
    // frames — a deliberately crude ScriptProcessor, which is all lo-fi needs.
    const crusher = c.createScriptProcessor(2048, 2, 2)
    const phase = [0, 0], hold = [0, 0]
    crusher.onaudioprocess = (e) => {
      const { bits: b, reduction: r } = params.current
      const step = Math.pow(0.5, b - 1)
      const norm = 1 / Math.max(1, r)
      for (let ch = 0; ch < 2; ch++) {
        const inp = e.inputBuffer.getChannelData(Math.min(ch, e.inputBuffer.numberOfChannels - 1))
        const out = e.outputBuffer.getChannelData(ch)
        for (let i = 0; i < inp.length; i++) {
          phase[ch] += norm
          if (phase[ch] >= 1) { phase[ch] -= 1; hold[ch] = step * Math.floor(inp[i] / step + 0.5) }
          out[i] = hold[ch]
        }
      }
    }
    const out = c.createGain(); out.gain.value = 0.9
    shaper.connect(crusher); crusher.connect(out); out.connect(c.destination)
    inputRef.current = input; shaperRef.current = shaper; outRef.current = out
    input.connect(shaper)
    return () => { [input, shaper, crusher, out].forEach(n => n.disconnect()); crusher.onaudioprocess = null }
  }, [])

  useEffect(() => { const s = shaperRef.current; if (s) s.curve = driveCurve(drive) }, [drive])

  useEffect(() => {
    const input = inputRef.current, shaper = shaperRef.current, out = outRef.current
    if (!input || !shaper || !out) return
    try { input.disconnect() } catch { /* none */ }
    input.connect(bypassed ? out : shaper)
  }, [bypassed])

  return (
    <Frame caption={caption}>
      <Transport ready={ready} playing={playing} onPlay={play} onStop={stop}
        onReset={() => { setDrive(0); setBits(16); setReduction(1); setBypassed(false) }}
        extra={<BypassButton bypassed={bypassed} setBypassed={setBypassed} disabled={!playing} label="Hold: clean" />} />
      <SourcePicker sourceName={sourceName} onFile={loadFile} onDemo={useDemo} />

      <Control label="Drive" value={drive < 0.01 ? 'off' : `${Math.round(drive * 100)}%`}>
        <input type="range" min={0} max={1} step={0.01} value={drive} onChange={e => setDrive(+e.target.value)} style={rangeStyle} aria-label="Drive" />
      </Control>
      <Control label="Bit depth" value={`${bits.toFixed(0)}-bit`}>
        <input type="range" min={2} max={16} step={1} value={bits} onChange={e => setBits(+e.target.value)} style={rangeStyle} aria-label="Bit depth" />
      </Control>
      <Control label="Sample-rate crush" value={reduction <= 1 ? 'full' : `÷${reduction}`}>
        <input type="range" min={1} max={30} step={1} value={reduction} onChange={e => setReduction(+e.target.value)} style={rangeStyle} aria-label="Sample-rate reduction" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Drive</strong> pushes the signal into a soft clip — it adds harmonics, so quiet is warmth and a lot is fuzz. <strong style={{ color: 'var(--text-secondary)' }}>Bit depth</strong> and <strong style={{ color: 'var(--text-secondary)' }}>sample-rate crush</strong> are the two halves of lo-fi: fewer bits is grainy and noisy, a lower sample rate is dark and aliased. Together they&rsquo;re the sound of old samplers and dusty tape.
      </p>
    </Frame>
  )
}
