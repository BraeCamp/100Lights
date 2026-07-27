'use client'

// A room you can size. Dry groove in, a synthetic impulse response (decaying
// stereo noise) rebuilt live as you drag Size, with pre-delay and a damping
// tone control. Mix blends the wet in; hold bypass to hear it bone dry.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, mixCtx, useLoopPlayer, rangeStyle, Frame, Transport, BypassButton, Control, SourcePicker } from './article/mix-kit'

function buildIR(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(seconds * rate))
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      // Exponential decay; a short build-in avoids an unnaturally hard onset.
      const env = Math.pow(1 - i / len, 2.4) * Math.min(1, (i / rate) / 0.006)
      d[i] = (Math.random() * 2 - 1) * env
    }
  }
  return buf
}

export default function ArticleReverb({ caption }: { caption?: string }) {
  const [mix, setMix] = useState(0.35)
  const [size, setSize] = useState(1.8)
  const [preDelay, setPreDelay] = useState(0.02)
  const [tone, setTone] = useState(6000)
  const [bypassed, setBypassed] = useState(false)

  const inputRef = useRef<AudioNode | null>(null)
  const convRef = useRef<ConvolverNode | null>(null)
  const preRef = useRef<DelayNode | null>(null)
  const dampRef = useRef<BiquadFilterNode | null>(null)
  const wetRef = useRef<GainNode | null>(null)
  const { ready, playing, play, stop, loadFile, useDemo, sourceName } = useLoopPlayer(inputRef, 'rnb')

  useEffect(() => {
    const c = mixCtx()
    const input = c.createGain()
    const dry = c.createGain(); dry.gain.value = 1
    const pre = c.createDelay(0.5); pre.delayTime.value = 0.02
    const conv = c.createConvolver(); conv.buffer = buildIR(c, 1.8)
    const damp = c.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 6000
    const wet = c.createGain(); wet.gain.value = 0.35
    input.connect(dry); dry.connect(c.destination)
    input.connect(pre); pre.connect(conv); conv.connect(damp); damp.connect(wet); wet.connect(c.destination)
    inputRef.current = input; convRef.current = conv; preRef.current = pre; dampRef.current = damp; wetRef.current = wet
    return () => { [input, dry, pre, conv, damp, wet].forEach(n => n.disconnect()) }
  }, [])

  // Rebuild the IR when size changes (cheap — a few ms of noise).
  useEffect(() => { const conv = convRef.current; if (conv) conv.buffer = buildIR(mixCtx(), size) }, [size])

  useEffect(() => {
    const t = mixCtx().currentTime
    preRef.current?.delayTime.setTargetAtTime(preDelay, t, 0.01)
    dampRef.current?.frequency.setTargetAtTime(tone, t, 0.01)
    wetRef.current?.gain.setTargetAtTime(bypassed ? 0 : mix, t, 0.01)
  }, [mix, preDelay, tone, bypassed])

  return (
    <Frame caption={caption}>
      <Transport
        ready={ready} playing={playing} onPlay={play} onStop={stop}
        onReset={() => { setMix(0.35); setSize(1.8); setPreDelay(0.02); setTone(6000); setBypassed(false) }}
        extra={<BypassButton bypassed={bypassed} setBypassed={setBypassed} disabled={!playing} label="Hold: dry" />}
      />
      <SourcePicker sourceName={sourceName} onFile={loadFile} onDemo={useDemo} />

      <Control label="Mix (dry → wet)" value={`${Math.round(mix * 100)}%`}>
        <input type="range" min={0} max={1} step={0.01} value={mix} onChange={e => setMix(+e.target.value)} style={rangeStyle} aria-label="Mix" />
      </Control>
      <Control label="Size" value={`${size.toFixed(1)} s`}>
        <input type="range" min={0.2} max={4} step={0.1} value={size} onChange={e => setSize(+e.target.value)} style={rangeStyle} aria-label="Size" />
      </Control>
      <Control label="Pre-delay" value={`${Math.round(preDelay * 1000)} ms`}>
        <input type="range" min={0} max={0.15} step={0.001} value={preDelay} onChange={e => setPreDelay(+e.target.value)} style={rangeStyle} aria-label="Pre-delay" />
      </Control>
      <Control label="Tone (damping)" value={tone >= 1000 ? `${(tone / 1000).toFixed(1)} kHz` : `${Math.round(tone)} Hz`}>
        <input type="range" min={1000} max={16000} step={100} value={tone} onChange={e => setTone(+e.target.value)} style={rangeStyle} aria-label="Tone" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Size</strong> is how big the room is, <strong style={{ color: 'var(--text-secondary)' }}>pre-delay</strong> is the gap before the reflections (a little keeps the dry sound clear and up front), and <strong style={{ color: 'var(--text-secondary)' }}>tone</strong> darkens the tail so it sits behind the mix. Keep <strong style={{ color: 'var(--text-secondary)' }}>mix</strong> lower than feels right — reverb adds up fast.
      </p>
    </Frame>
  )
}
