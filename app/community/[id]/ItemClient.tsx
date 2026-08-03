'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { getCommunityItem, toggleVote, importItem, type CommunityItem } from '@/lib/community'
import { initLibrary } from '@/lib/sound-library'
import { FeedCard } from '../FeedCard'
import { SaveToCollection } from '../SaveToCollection'
import type { RelatedItem } from './page'

const KIND_LABEL: Record<string, string> = {
  song: 'Songs', sample: 'Samples', preset: 'Presets', recipe: 'Chord recipes', pack: 'Sample packs', project: 'Project starters', theme: 'Themes', kit: 'Drum kits', pattern: 'Beat patterns', post: 'Posts', clip: 'Clips',
}
// A one-line "what do I do with this" hint per kind — orients newcomers and gives
// the page real content instead of just a card.
const KIND_HINT: Record<string, string> = {
  song: 'Press play to listen — no account needed. Sign in to open it in the studio and remix it.',
  sample: 'Audition it here, then import it to drop the sound straight onto a track in your own project.',
  preset: 'Import it to install the synth patch in your library — it syncs across your devices.',
  recipe: 'Audition the progression, then open it in the studio as editable MIDI to build on.',
  pack: 'Import the whole pack to add every sample to your library at once.',
  project: 'Open it in the studio to hear how it was built, then make it your own.',
  theme: 'Import to apply this look to your editor.',
  kit: 'Import to load this drum kit onto a beat and start programming.',
  pattern: 'Import to drop this pattern onto the step grid.',
  post: 'Join the conversation below — share your take or ask a question.',
  clip: 'Watch the clip, then head to the studio to try it yourself.',
}

export function ItemClient({ id, initialItem, related = [], byAuthor = [], remixes = [], source = null, author, kind }: { id: string; initialItem?: CommunityItem; related?: RelatedItem[]; byAuthor?: RelatedItem[]; remixes?: RelatedItem[]; source?: { id: string; name: string; author_name: string } | null; author?: string; kind?: string }) {
  const { user, isLoaded, isSignedIn } = useUser()
  // Seeded from the server so the name/description/author are in the SSR HTML
  // (crawlable) instead of a "Loading…" placeholder; the fetch below then
  // refreshes with the viewer's own vote/reaction state.
  const [item, setItem] = useState<CommunityItem | null>(initialItem ?? null)
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

  const itemKind = kind ?? item.kind
  const kindLabel = KIND_LABEL[itemKind] ?? 'Community'
  const hint = KIND_HINT[itemKind]
  const engagement = (item.votes ?? 0) + (item.downloads ?? 0)
  const popular = engagement >= 8
  const copyEmbed = () => {
    const h = itemKind === 'song' || itemKind === 'sample' ? 200 : 150
    const code = `<iframe src="https://100lights.com/embed/${id}" width="480" height="${h}" style="border:0;border-radius:12px" loading="lazy" title="${item.name.replace(/"/g, '')} on 100Lights"></iframe>`
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => flash('Embed code copied — paste it anywhere')).catch(() => flash('Copy failed'))
    else flash('Copy isn’t available here')
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '26px 18px 80px' }}>
        {/* Breadcrumb — links up to the category hub (navigation + internal SEO links) */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          <Link href="/community" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'inherit', textDecoration: 'none' }}>
            <ArrowLeft size={13} /> Community
          </Link>
          {itemKind !== 'post' && (
            <>
              <span>/</span>
              <Link href={`/community/browse/${itemKind}`} style={{ color: 'inherit', textDecoration: 'none' }}>{kindLabel}</Link>
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {popular && (
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.03em', color: '#fb923c', background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 999, padding: '2px 9px' }}>
                🔥 Popular
              </span>
            )}
            <SaveToCollection itemId={id} signedIn={!isLoaded || !!isSignedIn} onToast={flash} />
            <button onClick={copyEmbed} title="Copy an embed code for this — paste it into a blog or Discord" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', cursor: 'pointer' }}>
              {'</>'} Embed
            </button>
          </span>
        </nav>

        <FeedCard
          item={item} busy={busy} signedIn={!isLoaded || !!isSignedIn}
          commentsOpen
          onAuthorClick={a => { window.location.href = `/community/creator/${encodeURIComponent(a)}` }}
          onTagClick={t => { window.location.href = `/community?tag=${encodeURIComponent(t)}` }}
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

        {source && (
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden>🔀</span>
            <span>Remixed from <Link href={`/community/${source.id}`} style={{ color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}>{source.name}</Link> by {source.author_name}</span>
          </p>
        )}

        {hint && (
          <p style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-muted)', display: 'flex', gap: 7 }}>
            <span aria-hidden>💡</span><span>{hint}</span>
          </p>
        )}

        {remixes.length > 0 && (
          <section style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>
              🔀 {remixes.length} remix{remixes.length === 1 ? '' : 'es'} — made from this
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {remixes.map(r => (
                <li key={r.id}>
                  <Link href={`/community/${r.id}`} style={{
                    display: 'block', textDecoration: 'none', color: 'inherit',
                    background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border)',
                    borderRadius: 9, padding: '11px 13px',
                  }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>by {r.author_name}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {byAuthor.length > 0 && (
          <section style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>
              More from {author}
              {author && (
                <Link href={`/community/creator/${encodeURIComponent(author)}`} style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#a78bfa', textDecoration: 'none', textTransform: 'none', letterSpacing: 0 }}>
                  see all →
                </Link>
              )}
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {byAuthor.map(r => (
                <li key={r.id}>
                  <Link href={`/community/${r.id}`} style={{
                    display: 'block', textDecoration: 'none', color: 'inherit',
                    background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border)',
                    borderRadius: 9, padding: '11px 13px',
                  }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{KIND_LABEL[r.kind] ?? r.kind}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {related.length > 0 && (
          <section style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>
              {itemKind === 'post' ? 'More from the community' : `More ${kindLabel.toLowerCase()}`}
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {related.map(r => (
                <li key={r.id}>
                  <Link href={`/community/${r.id}`} style={{
                    display: 'block', textDecoration: 'none', color: 'inherit',
                    background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border)',
                    borderRadius: 9, padding: '11px 13px',
                  }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{KIND_LABEL[r.kind] ?? r.kind} · by {r.author_name}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

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
