'use client'

// Thin bar across the top that fills as you read. Pure enhancement — it reads
// document scroll, so it needs no props and no knowledge of the article.

import { useEffect, useState } from 'react'

export default function ReadingProgress() {
  const [p, setP] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setP(max > 0 ? Math.min(1, el.scrollTop / max) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])
  return (
    <div aria-hidden="true" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 60, pointerEvents: 'none' }}>
      <div style={{ height: '100%', width: `${p * 100}%`, background: 'linear-gradient(90deg, #8b5cf6, #3b82f6)', transition: 'width 0.08s linear' }} />
    </div>
  )
}
