'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { getCommunityItem, toggleVote, importItem, type CommunityItem } from '@/lib/community'
import { initLibrary } from '@/lib/sound-library'
import { FeedCard } from '../FeedCard'

export function ItemClient({ id }: { id: string }) {
  const { user, isLoaded, isSignedIn } = useUser()
  const [item, setItem] = useState<CommunityItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => { if (isLoaded && isSignedIn) initLibrary(user?.id ?? null) }, [isLoaded, isSignedIn, user?.id])

  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    const t = setTimeout(() => { void getCommunityItem(id).then(setItem) }, 0)
    return () => clearTimeout(t)
  }, [id])

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  if (!item) return <p style={{ textAlign: 'center', padding: 60, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '26px 18px 80px' }}>
        <Link href="/community" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 16 }}>
          <ArrowLeft size={13} /> Community feed
        </Link>

        <FeedCard
          item={item} busy={busy} signedIn={!isLoaded || !!isSignedIn}
          onVote={async () => {
            try {
              const r = await toggleVote(item.id)
              setItem(prev => prev ? { ...prev, votes: r.votes, votedByMe: r.votedByMe } : prev)
            } catch { flash('Vote failed') }
          }}
          onImport={async () => {
            setBusy(true)
            try { flash(await importItem(item)) }
            catch (e) { flash(e instanceof Error ? e.message : 'Import failed') }
            finally { setBusy(false) }
          }}
          onToast={flash}
        />

        {!isSignedIn && (
          <div style={{ marginTop: 18, padding: '16px 20px', borderRadius: 12, textAlign: 'center', background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(34,211,238,0.06))', border: '1px solid rgba(139,92,246,0.3)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Like what you hear?</p>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              100Lights is a full music studio in your browser — sign up free to pull this into your own project.
            </p>
            <Link href="/sign-up" style={{ display: 'inline-block', padding: '8px 22px', borderRadius: 999, background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              Start making music
            </Link>
          </div>
        )}
      </div>

      {toast && (
        <div role="status" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
          background: '#1e1e1e', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 18px',
          fontSize: 12.5, color: 'var(--text-primary)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', maxWidth: '80vw',
        }}>{toast}</div>
      )}
    </div>
  )
}
