'use client'

// The DAW instantiates a DawEngine (and its AudioContext) on mount, which only
// exists in the browser — so load it client-only, never server-rendered. The
// page's SEO metadata still comes from app/m/layout.tsx (server).

import dynamic from 'next/dynamic'

const MobileDaw = dynamic(() => import('./MobileDaw'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading studio…
    </div>
  ),
})

export default function MobileDawClient() {
  return <MobileDaw />
}
