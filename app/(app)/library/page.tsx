'use client'

// Standalone sound library — browse, audition, organize, and share your
// sounds without opening a project. The same library the editor uses.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { AudioLines, ArrowRight } from 'lucide-react'
import { initLibrary } from '@/lib/sound-library'
import SoundLibrary from '@/components/editor/SoundLibrary'

export default function LibraryPage() {
  const { user, isLoaded } = useUser()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isLoaded) return
    initLibrary(user?.id ?? null)
    const t = setTimeout(() => setReady(true), 0)
    return () => clearTimeout(t)
  }, [isLoaded, user?.id])

  return (
    <main className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <div style={{ padding: '22px 28px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Sound Library</h1>
          <Link href="/new?modules=audio&audioMode=music" style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
            padding: '8px 16px', borderRadius: 999, background: 'var(--accent)', color: '#fff', textDecoration: 'none',
          }}><AudioLines size={13} /> Open Studio <ArrowRight size={12} /></Link>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 14px', maxWidth: 640, lineHeight: 1.5 }}>
          Every sound and recipe you can use in the studio. Press ▶ to listen, hover your own samples to share them,
          and check the Recipes tab for ready-made progressions. In the studio, drag anything straight onto a track.
        </p>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', margin: '0 28px 24px', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-surface)' }}>
        {ready ? <SoundLibrary embedded /> : <p style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)' }}>Loading your sounds…</p>}
      </div>
    </main>
  )
}
