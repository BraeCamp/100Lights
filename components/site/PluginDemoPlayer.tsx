'use client'
// ============================================================================
//  Audio demos for a plug-in product page.
//
//  One <audio> element shared by every row, because a page that lets six clips
//  play over each other is worse than one that plays none. Picking a new demo
//  stops the previous one.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginDemo } from '@/lib/plugins-catalog'

const C = {
  card: 'var(--bg-card)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  sub: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  accent: 'var(--accent)',
} as const

export default function PluginDemoPlayer({ demos }: { demos: PluginDemo[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState<Set<string>>(new Set())

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'none'
    audioRef.current = audio

    const onEnded = () => { setPlaying(null); setProgress(0) }
    const onTime = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration)
    }
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTime)

    return () => {
      audio.pause()
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTime)
      audioRef.current = null
    }
  }, [])

  const toggle = useCallback((demo: PluginDemo) => {
    const audio = audioRef.current
    if (!audio) return

    if (playing === demo.name) {
      audio.pause()
      setPlaying(null)
      return
    }

    audio.pause()
    audio.src = `/demos/${encodeURIComponent(demo.file)}`
    setProgress(0)
    void audio.play()
      .then(() => setPlaying(demo.name))
      .catch(() => {
        // Usually the file is not there yet, which is worth saying rather than
        // leaving a button that does nothing when clicked.
        setFailed(prev => new Set(prev).add(demo.name))
        setPlaying(null)
      })
  }, [playing])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {demos.map(demo => {
        const isPlaying = playing === demo.name
        const isBroken = failed.has(demo.name)

        return (
          <button
            key={demo.name}
            onClick={() => toggle(demo)}
            disabled={isBroken}
            aria-label={isPlaying ? `Stop ${demo.name}` : `Play ${demo.name}`}
            style={{
              position: 'relative', overflow: 'hidden', width: '100%',
              display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
              border: `1px solid ${isPlaying ? C.accent : C.border}`,
              borderRadius: 12, background: C.card,
              padding: '13px 16px', cursor: isBroken ? 'default' : 'pointer',
              opacity: isBroken ? 0.55 : 1,
            }}
          >
            {/* progress fill, behind the content */}
            {isPlaying && (
              <span
                aria-hidden
                style={{
                  position: 'absolute', inset: 0, transformOrigin: 'left',
                  transform: `scaleX(${progress})`,
                  background: 'var(--accent)', opacity: 0.1,
                  transition: 'transform 120ms linear', pointerEvents: 'none',
                }}
              />
            )}

            <span style={{
              position: 'relative', flexShrink: 0,
              width: 30, height: 30, borderRadius: 999,
              border: `1px solid ${isPlaying ? C.accent : C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isPlaying ? C.accent : C.sub, fontSize: 12,
            }}>
              {isPlaying ? '❚❚' : '▶'}
            </span>

            <span style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: C.text }}>
                {demo.name}
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: C.sub, marginTop: 2 }}>
                {isBroken ? 'This demo has not been rendered yet.' : demo.blurb}
              </span>
            </span>

            <span style={{
              position: 'relative', flexShrink: 0, fontSize: 10.5, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted,
            }}>
              {demo.category}
            </span>
          </button>
        )
      })}
    </div>
  )
}
