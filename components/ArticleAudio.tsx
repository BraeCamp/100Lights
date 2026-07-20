'use client'

/**
 * Themed audio player for article `@audio(...)` blocks.
 *
 * The native `<audio controls>` widget renders as a light-grey pill that looks
 * broken against the dark article page. This is the same thing in the site's
 * colors: play/pause, a scrubbable progress bar, and elapsed time.
 *
 * The server renders a plain `<audio controls>` as the fallback (see
 * simple-markdown), so with JS off or before this chunk arrives the audio is
 * still playable — this only ever upgrades a working control.
 */

import React, { useEffect, useRef, useState } from 'react'

const fmt = (s: number) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function ArticleAudio({ src, caption }: { src: string; caption?: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)

  useEffect(() => {
    const a = ref.current
    if (!a) return
    const onTime = () => setT(a.currentTime)
    const onMeta = () => setDur(a.duration)
    const onEnd = () => { setPlaying(false); setT(0) }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnd)
    a.addEventListener('play', () => setPlaying(true))
    a.addEventListener('pause', () => setPlaying(false))
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnd)
    }
  }, [])

  // Pause every other article player when this one starts, so a before/after
  // pair can't end up playing over each other.
  const toggle = () => {
    const a = ref.current
    if (!a) return
    if (a.paused) {
      document.querySelectorAll('audio').forEach(o => { if (o !== a) o.pause() })
      void a.play()
    } else {
      a.pause()
    }
  }

  const seek = (clientX: number) => {
    const a = ref.current, bar = barRef.current
    if (!a || !bar || !isFinite(a.duration)) return
    const r = bar.getBoundingClientRect()
    a.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * a.duration
  }

  const pct = dur ? (t / dur) * 100 : 0

  return (
    <figure style={{ margin: '22px 0' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '12px 16px', borderRadius: 12,
          border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)',
        }}
      >
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{
            flexShrink: 0, width: 38, height: 38, borderRadius: 19, border: 'none',
            background: '#7c3aed', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, lineHeight: 1, paddingLeft: playing ? 0 : 3,
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div
          ref={barRef}
          onClick={e => seek(e.clientX)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(t)}
          tabIndex={0}
          onKeyDown={e => {
            const a = ref.current
            if (!a) return
            if (e.key === 'ArrowRight') a.currentTime = Math.min(a.duration, a.currentTime + 5)
            if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 5)
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() }
          }}
          style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.12)', cursor: 'pointer', position: 'relative' }}
        >
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: '#a78bfa' }} />
        </div>

        <span style={{ flexShrink: 0, fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 74, textAlign: 'right' }}>
          {fmt(t)} / {fmt(dur)}
        </span>

        <audio ref={ref} src={src} preload="none" style={{ display: 'none' }} />
      </div>
      {caption && (
        <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>
      )}
    </figure>
  )
}
