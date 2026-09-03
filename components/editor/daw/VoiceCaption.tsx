'use client'
// What you said, big enough to read on a phone.
//
// Brae: "I'm thinking of making some videos of me using the voice control to
// make some music."
//
// ── The problem this solves ────────────────────────────────────────────────
//
// A voice demo is the one kind of screen recording where the cause is invisible.
// The viewer sees a studio changing by itself: a track appears, a filter
// sweeps, the drums go half time — and nothing on screen says why. The card
// already shows what was heard and what it did, but at 12px inside a panel in
// the corner, which is unreadable at phone size and invisible at a glance.
//
// So this is a lower third, not a UI element. It exists to be RECORDED: large
// type, high contrast, safe margins, and it goes away on its own so it never
// sits over the thing it was explaining.
//
// ⚠️ Off by default and deliberately not pretty-by-default in the app. This is
// a recording aid; somebody working would find a caption over their arrangement
// every time they spoke actively annoying, which is the whole reason it is a
// setting rather than a feature.

import React, { useEffect, useRef, useState } from 'react'

const CAPTION_KEY = 'beacon.voice.caption'

export function readVoiceCaption(): boolean {
  try { return localStorage.getItem(CAPTION_KEY) === 'on' } catch { return false }
}
export function writeVoiceCaption(on: boolean): void {
  try { localStorage.setItem(CAPTION_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
}

/** How long a finished exchange stays up before it fades. */
const HOLD_MS = 4200

export default function VoiceCaption({
  saying,
  reply,
  problem,
  listening,
}: {
  /** What is being said right now — the live transcript. */
  saying?: string
  /** What the studio answered. */
  reply?: string
  problem?: string
  listening?: boolean
}) {
  const answer = problem || reply || ''

  // ⚠️ No sticky copy of the sentence, and that took a rewrite to see. The
  // first version held the words in state so they would survive the answer
  // arriving — but VoiceControl only clears heard/said/problem when the NEXT
  // take starts, so the pair already holds together on its own. The state was
  // guarding against something that does not happen, and it cost a
  // setState-inside-an-effect to do it.
  //
  // What is left is one piece of state with an honest job: WHICH answer has
  // already had its time on screen. A new answer is a different string, so it
  // is visible again without anything having to reset it.
  const [expiredFor, setExpiredFor] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    // While the microphone is open the sentence is not finished, so it stays
    // up; the countdown starts when there is an answer to read.
    if (!answer || listening) return
    timer.current = setTimeout(() => setExpiredFor(answer), HOLD_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [answer, listening])

  const said = saying ?? ''
  const bad = !!problem
  const visible = !!(said || answer) && expiredFor !== answer
  // The listening pill is its own thing: it says the studio is paying
  // attention, which on video is the difference between a pause and a bug.
  const idle = !visible && !!listening

  if (!visible && !idle) return null

  return (
    <div
      data-voice-caption
      aria-hidden
      style={{
        position: 'fixed',
        // Above the transport, which is where the button lives — a caption over
        // the control being demonstrated hides the demonstration.
        left: '50%', bottom: 96, transform: 'translateX(-50%)',
        zIndex: 75, pointerEvents: 'none',
        width: 'min(1100px, 88vw)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        textAlign: 'center',
        opacity: 1,
        transition: 'opacity 260ms ease',
      }}
    >
      {idle && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 9,
          padding: '9px 18px', borderRadius: 999,
          background: 'rgba(10,10,12,.82)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,.14)',
          font: '600 16px/1 ui-sans-serif, system-ui, sans-serif',
          color: 'rgba(255,255,255,.9)', letterSpacing: '.01em',
        }}>
          <span style={{
            width: 9, height: 9, borderRadius: 999, background: '#ff5f56',
            boxShadow: '0 0 0 0 rgba(255,95,86,.7)',
            animation: 'voiceCaptionPulse 1.6s ease-out infinite',
          }} />
          Listening
        </div>
      )}

      {visible && said && (
        // The words, as a quote — it is somebody speaking, and quotation marks
        // do more to say that than any label would.
        <div style={{
          maxWidth: '100%',
          padding: '14px 26px', borderRadius: 14,
          background: 'rgba(10,10,12,.86)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 18px 50px rgba(0,0,0,.5)',
          font: '600 clamp(19px, 2.2vw, 30px)/1.28 ui-sans-serif, system-ui, sans-serif',
          color: '#fff', letterSpacing: '-.01em',
          textWrap: 'balance',
        }}>
          “{said}”
        </div>
      )}

      {visible && answer && (
        <div style={{
          maxWidth: '100%',
          padding: '10px 22px', borderRadius: 12,
          // The answer is visibly the STUDIO talking back, not more of the
          // person — different weight, different colour, smaller.
          background: bad ? 'rgba(60,18,18,.86)' : 'rgba(16,32,28,.86)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${bad ? 'rgba(255,120,110,.45)' : 'rgba(110,240,200,.35)'}`,
          font: '500 clamp(15px, 1.5vw, 21px)/1.35 ui-sans-serif, system-ui, sans-serif',
          color: bad ? '#ffc9c4' : '#9df3d6',
          textWrap: 'balance',
        }}>
          {answer}
        </div>
      )}

      <style>{`
        @keyframes voiceCaptionPulse {
          0%   { box-shadow: 0 0 0 0 rgba(255,95,86,.65); }
          70%  { box-shadow: 0 0 0 11px rgba(255,95,86,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,95,86,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-voice-caption] * { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
