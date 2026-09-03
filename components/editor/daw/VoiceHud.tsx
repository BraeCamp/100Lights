'use client'
// The voice control, with the controls taken out.
//
// Brae: "The hud thing is going to be a full voice control UI that shows the
// program without any buttons, just information and visuals. It will look
// cleaner and be less cluttered. The only buttons will be to return to normal
// hud, type commands, and exit voice control."
//
// ⚠️ SO EVERY PIXEL HERE ANSWERS A QUESTION, and none of it offers a choice.
// The settings, the queue, the calibration, the tabs all live in the panel and
// stay there. What is left is the four things somebody actually wants to know
// while talking to a studio:
//
//   is it listening      the state, said in one word and shown as motion
//   did it hear me       the words, as they arrive
//   what did it do       the last thing that happened, in its own words
//   what can it see      the song facts it is reasoning about
//
// That last one is the reason this is worth building rather than just hiding
// buttons. Most voice failures are the model working from something other than
// what you assumed — the wrong track selected, a tempo you forgot you changed.
// Showing what it can see turns "why did it do that" into something you can
// answer at a glance.

import { useEffect, useRef } from 'react'
import { subscribeLevel, readLevel } from '@/lib/voice/level-bus'

export interface VoiceHudProps {
  listening: boolean
  /** Held open, rather than one push-to-talk take. */
  continuous: boolean
  /** 0–1 input level. Optional now: the HUD reads the level bus itself. */
  level?: number
  talking: boolean
  /** Live transcript of the take in progress. */
  hearing: string
  /** The last thing said back. */
  said: string
  /** A question waiting for an answer. */
  question: string
  /** Something went wrong, in words. */
  problem: string
  /** Recent commands, newest last — one line each. */
  recent: string[]
  /** What the assistant can see: the song, in short facts. */
  facts: { label: string; value: string }[]
  onNormalHud: () => void
  onType: () => void
  onExit: () => void
  colors: { bg: string; surface: string; border: string; text: string; muted: string; accent: string }
}

/** One word for what it is doing, because a state nobody can name is a state
 *  nobody trusts. */
function stateOf(p: VoiceHudProps): { label: string; tone: string } {
  if (p.problem) return { label: 'Problem', tone: '#ef4444' }
  if (p.talking) return { label: 'Speaking', tone: '#8b5cf6' }
  if (p.question) return { label: 'Waiting for you', tone: '#fbbf24' }
  if (p.listening) return { label: p.continuous ? 'Listening' : 'Hold to talk', tone: '#22c55e' }
  return { label: 'Idle', tone: '#6b7280' }
}

export default function VoiceHud(props: VoiceHudProps) {
  const { colors: C } = props
  const state = stateOf(props)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const phase = useRef(0)
  // Fed straight from the level bus, not from a prop: the HUD's own animation
  // loop reads this ref every frame, so the level never has to pass through
  // React at all.
  const levelRef = useRef(props.level ?? readLevel().level)
  useEffect(() => subscribeLevel(r => { levelRef.current = r.level }), [])
  const talkingRef = useRef(props.talking)
  talkingRef.current = props.talking

  // ⚠️ ONE LOOP, and it idles. Drawing every frame regardless of state is how a
  // "cleaner" screen ends up costing more than the one it replaced — and this
  // studio has an audio thread with no headroom to spare.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let raf = 0
    let idle = 0
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight
      const g = el.getContext('2d')
      if (!g || !w || !h) { raf = requestAnimationFrame(draw); return }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (el.width !== w * dpr || el.height !== h * dpr) { el.width = w * dpr; el.height = h * dpr }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)

      const lvl = talkingRef.current ? 0.55 : levelRef.current
      // Quiet and not speaking: hold a flat line and stop advancing, so a still
      // screen really is still.
      if (lvl < 0.01) { idle++ } else { idle = 0; phase.current += talkingRef.current ? 0.13 : 0.07 }

      const mid = h / 2
      g.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const t = x / w
        // Two sines at different rates so it reads as a voice rather than a
        // test tone, tapered at both ends so it sits in the space.
        const taper = Math.sin(Math.PI * t)
        const y = mid + Math.sin(t * 14 + phase.current) * 16 * lvl * taper
                      + Math.sin(t * 27 - phase.current * 1.4) * 7 * lvl * taper
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.strokeStyle = state.tone
      g.lineWidth = 2
      g.shadowBlur = lvl > 0.02 ? 12 : 0
      g.shadowColor = state.tone
      g.stroke()
      g.shadowBlur = 0

      // Fully idle for a while: stop asking for frames at all.
      if (idle > 90) { raf = 0; return }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { if (raf) cancelAnimationFrame(raf) }
    // state.tone is read through the closure each frame, but the loop must be
    // restarted when it stops itself and the state changes.
  }, [state.tone, props.listening, props.talking, props.question])

  const btn: React.CSSProperties = {
    fontSize: 12, fontWeight: 650, padding: '8px 16px', borderRadius: 9,
    border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer',
  }

  return (
    <div
      data-voice-hud
      style={{
        position: 'fixed', inset: 0, zIndex: 90, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 28, padding: 32,
        background: C.bg, color: C.text,
        fontSize: 13,
      }}
    >
      {/* State — the one word, and the motion that means the same thing */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: 'min(680px, 90vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: state.tone,
            boxShadow: props.listening || props.talking ? `0 0 10px ${state.tone}` : undefined }} />
          <span style={{ fontSize: 15, fontWeight: 750, letterSpacing: '-0.01em' }}>{state.label}</span>
        </div>
        <canvas ref={canvas} style={{ width: '100%', height: 84 }} />
      </div>

      {/* What it heard, and what it said — the conversation, nothing else */}
      <div style={{ width: 'min(680px, 90vw)', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 92 }}>
        {props.hearing && (
          <p style={{ margin: 0, fontSize: 20, lineHeight: 1.35, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {props.hearing}
          </p>
        )}
        {props.question && (
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#fbbf24' }}>{props.question}</p>
        )}
        {props.problem && (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#ef4444' }}>{props.problem}</p>
        )}
        {!props.problem && !props.question && props.said && (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: C.muted }}>{props.said}</p>
        )}
      </div>

      {/* ⚠️ What it can SEE. Most voice mistakes are it working from something
          other than what you assumed — the wrong track selected, a tempo you
          forgot changing. This is the glance that explains them. */}
      {props.facts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', width: 'min(680px, 90vw)' }}>
          {props.facts.map(f => (
            <span key={f.label} style={{
              fontSize: 11, padding: '5px 11px', borderRadius: 999,
              background: C.surface, border: `1px solid ${C.border}`, color: C.muted,
            }}>
              {f.label} <strong style={{ color: C.text, fontWeight: 650 }}>{f.value}</strong>
            </span>
          ))}
        </div>
      )}

      {/* Recent commands — enough to see a pattern, not a log */}
      {props.recent.length > 0 && (
        <div style={{ width: 'min(680px, 90vw)', display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.75 }}>
          {props.recent.slice(-4).map((r, i) => (
            <p key={i} style={{ margin: 0, fontSize: 11.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r}
            </p>
          ))}
        </div>
      )}

      {/* The only three. Anything else belongs in the panel. */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button style={btn} onClick={props.onNormalHud}>Normal HUD</button>
        <button style={btn} onClick={props.onType}>Type a command</button>
        <button style={{ ...btn, borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }} onClick={props.onExit}>
          Exit voice control
        </button>
      </div>
    </div>
  )
}
