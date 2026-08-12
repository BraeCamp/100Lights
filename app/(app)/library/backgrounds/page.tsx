'use client'

// Standalone Background Library — browse the visual backgrounds catalog app-wide, not just
// inside Lightning Bug. Same data (lib/bg-library) and offline store the app uses.

import Link from 'next/link'
import { AudioLines, Clapperboard, ArrowRight } from 'lucide-react'
import BackgroundLibrary from '@/components/media/BackgroundLibrary'

export default function BackgroundsLibraryPage() {
  return (
    <main className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <div style={{ padding: '22px 28px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Background Library</h1>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/library" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 999, background: 'var(--bg-card)', color: 'var(--text-secondary)', textDecoration: 'none', border: '1px solid var(--border)' }}>
              <AudioLines size={13} /> Sounds
            </Link>
            <Link href="/apps/musicvideo" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 999, background: 'var(--accent)', color: '#0e0d12', textDecoration: 'none' }}>
              <Clapperboard size={13} /> Open Lightning Bug <ArrowRight size={12} />
            </Link>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 14px', maxWidth: 680, lineHeight: 1.5 }}>
          Video &amp; animated backgrounds for your visuals — the same library Lightning Bug uses. Hover a tile to preview
          the motion, save it for offline, download it to your device, or open one straight into a live show.
        </p>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 28px 24px', padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-surface)' }}>
        <BackgroundLibrary />
      </div>
    </main>
  )
}
