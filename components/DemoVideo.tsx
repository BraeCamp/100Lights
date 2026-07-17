'use client'

// The landing demo loop, motion-aware: users with prefers-reduced-motion get
// the poster with an explicit play button instead of a 30-second autoplaying
// animation. Everyone else keeps the ambient loop.

import { useState, useEffect, useRef, useSyncExternalStore } from 'react'

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export default function DemoVideo(props: { src: string; poster: string; ariaLabel: string }) {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
  const [playing, setPlaying] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)

  const autoplay = !reduced

  // React doesn't emit the muted ATTRIBUTE (only the property), and Chromium's
  // autoplay policy checks the attribute — set both imperatively and kick play
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (reduced) {
      // SSR markup carries autoPlay (the preference is only knowable
      // client-side) — stop it as soon as we learn better
      if (!playing) { v.pause(); v.currentTime = 0 }
      return
    }
    v.muted = true
    v.setAttribute('muted', '')
    v.play().catch(() => { /* blocked — poster + user gesture still work */ })
  }, [reduced, playing])

  return (
    <div style={{ position: 'relative' }}>
      <video
        ref={ref}
        src={props.src}
        poster={props.poster}
        autoPlay={autoplay}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={props.ariaLabel}
        className="w-full block"
        style={{ aspectRatio: '1280 / 800' }}
      />
      {reduced && !playing && (
        <button
          onClick={() => { setPlaying(true); void ref.current?.play() }}
          aria-label="Play the studio demo video"
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.35)', border: 'none', cursor: 'pointer', width: '100%',
          }}
        >
          <span style={{
            width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#111',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }} aria-hidden="true">▶</span>
        </button>
      )}
    </div>
  )
}
