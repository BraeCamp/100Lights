'use client'

/**
 * Blind A/B listening test.
 *
 * "Can You Hear the Difference?" sets up five comparisons and then has to tell
 * the reader to go build each one in the studio. This makes the test happen in
 * the page: two clips labelled A and B in a random order, the reader commits to
 * an answer, and only then is it revealed.
 *
 * The commit-before-reveal ordering is the whole point. Knowing which clip is
 * which makes people hear a difference whether or not one exists, so a widget
 * that showed the labels up front would teach the opposite of what the article
 * is about.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'

export interface ABSpec {
  /** The clip with the treatment applied. */
  treatedSrc: string
  /** The untreated clip. */
  plainSrc: string
  /** What the reader is being asked to identify, e.g. "compression". */
  question: string
  /** Shown after they answer — what to listen for next time. */
  explanation?: string
  caption?: string
}

type Slot = 'A' | 'B'

export default function ArticleAB({ spec }: { spec: ABSpec }) {
  // Randomised per mount so the answer can't be learned from position, and so
  // a reader who replays the article gets a fresh test.
  const treatedSlot: Slot = useMemo(() => (Math.random() < 0.5 ? 'A' : 'B'), [])
  const [guess, setGuess] = useState<Slot | null>(null)
  const [playingSlot, setPlayingSlot] = useState<Slot | null>(null)
  const aRef = useRef<HTMLAudioElement>(null)
  const bRef = useRef<HTMLAudioElement>(null)

  const srcFor = (s: Slot) => (s === treatedSlot ? spec.treatedSrc : spec.plainSrc)
  const correct = guess === treatedSlot

  function play(s: Slot) {
    const el = (s === 'A' ? aRef : bRef).current
    const other = (s === 'A' ? bRef : aRef).current
    if (!el) return
    other?.pause()
    document.querySelectorAll('audio').forEach(o => { if (o !== el) o.pause() })
    if (el.paused) {
      // Restart each time — A/B only works if both start from the same place.
      el.currentTime = 0
      void el.play()
      setPlayingSlot(s)
    } else {
      el.pause()
      setPlayingSlot(null)
    }
  }

  useEffect(() => {
    const clear = () => setPlayingSlot(null)
    const a = aRef.current, b = bRef.current
    a?.addEventListener('ended', clear)
    b?.addEventListener('ended', clear)
    return () => { a?.removeEventListener('ended', clear); b?.removeEventListener('ended', clear) }
  }, [])

  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ border: '1px solid rgba(52,211,153,0.35)', borderRadius: 12, padding: '16px 18px', background: 'rgba(52,211,153,0.05)' }}>
        <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600 }}>
          {spec.question}
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['A', 'B'] as Slot[]).map(s => (
            <div key={s} style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => play(s)}
                style={{
                  padding: '10px 14px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  border: `1px solid ${playingSlot === s ? '#34d399' : 'var(--border)'}`,
                  background: playingSlot === s ? 'rgba(52,211,153,0.15)' : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                }}
              >{playingSlot === s ? '❚❚' : '▶'} Clip {s}</button>
              <button
                onClick={() => setGuess(s)}
                disabled={guess !== null}
                style={{
                  padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                  cursor: guess ? 'default' : 'pointer',
                  border: `1px solid ${guess === s ? '#34d399' : 'var(--border)'}`,
                  background: guess === s ? 'rgba(52,211,153,0.2)' : 'transparent',
                  color: guess === s ? '#34d399' : 'var(--text-muted)',
                  opacity: guess && guess !== s ? 0.4 : 1,
                }}
              >{guess === s ? 'your answer' : 'this one'}</button>
            </div>
          ))}
        </div>

        {guess === null ? (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Play both, as many times as you like. Commit to an answer before you scroll on — a guess you
            haven&rsquo;t committed to is one you can quietly revise once you know.
          </p>
        ) : (
          <div style={{ fontSize: 12.5, lineHeight: 1.65 }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700, color: correct ? '#34d399' : '#f59e0b' }}>
              {correct ? 'Correct — that was the treated one.' : `Not this time. It was Clip ${treatedSlot}.`}
            </p>
            {!correct && (
              <p style={{ margin: '0 0 6px', color: 'var(--text-muted)' }}>
                Worth knowing rather than worth minding. Most people cannot hear this yet, which is the
                honest starting point and the reason the drill exists.
              </p>
            )}
            {spec.explanation && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{spec.explanation}</p>}
            <button
              onClick={() => setGuess(null)}
              style={{ marginTop: 8, fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', color: 'var(--text-muted)', cursor: 'pointer' }}
            >Try again</button>
          </div>
        )}

        <audio ref={aRef} src={srcFor('A')} preload="none" style={{ display: 'none' }} />
        <audio ref={bRef} src={srcFor('B')} preload="none" style={{ display: 'none' }} />
      </div>
      {spec.caption && (
        <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{spec.caption}</figcaption>
      )}
    </figure>
  )
}
