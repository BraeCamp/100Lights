import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TUTORIALS, getTutorial, stepImagePath } from '@/lib/tutorials'

export const revalidate = 3600

export function generateStaticParams() {
  return TUTORIALS.map(t => ({ slug: t.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const t = getTutorial(slug)
  if (!t) return { title: 'Not found' }
  return {
    title: `${t.title} — 100Lights Tutorial`,
    description: t.description,
    alternates: { canonical: `https://100lights.com/tutorial/${t.slug}` },
    openGraph: { title: t.title, description: t.description, type: 'article', url: `https://100lights.com/tutorial/${t.slug}`, siteName: '100Lights' },
    twitter: { card: 'summary_large_image', title: t.title, description: t.description },
  }
}

export default async function TutorialPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const t = getTutorial(slug)
  if (!t) notFound()

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-base)' }}>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '44px 20px 80px' }}>
        <Link href="/tutorial" style={{ fontSize: 12.5, color: 'var(--text-muted)', textDecoration: 'none' }}>← All tutorials</Link>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--accent-light)', background: 'var(--accent-subtle, rgba(139,92,246,0.14))', border: '1px solid rgba(139,92,246,0.3)', marginTop: 22 }}>Feature tutorial</div>
        <h1 style={{ fontSize: 33, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, margin: '14px 0 10px', letterSpacing: '-0.02em' }}>{t.title}</h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{t.tagline}</p>

        <ol style={{ listStyle: 'none', margin: '36px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 30 }}>
          {t.steps.map((s, i) => (
            <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 14, background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                <p style={{ fontSize: 15.5, color: 'var(--text-primary)', lineHeight: 1.6, margin: 0, paddingTop: 3 }}>{s.text}</p>
              </div>
              {s.helpId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={stepImagePath(t.slug, i)}
                  alt={`Step ${i + 1}: ${s.text}`}
                  loading="lazy"
                  style={{ display: 'block', width: 'auto', maxWidth: 'min(100%, 460px)', marginLeft: 40, borderRadius: 12, border: '1px solid var(--border)' }}
                />
              )}
            </li>
          ))}
        </ol>

        <div style={{ marginTop: 44, padding: '24px 22px', borderRadius: 16, textAlign: 'center', background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(59,130,246,0.08))', border: '1px solid rgba(139,92,246,0.3)' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Now do it — the studio points at each control</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>Open the free studio with this walkthrough live. No account needed to start.</p>
          <Link href={`/new?modules=audio&guide=${t.slug}`} style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
            Do it in the studio →
          </Link>
        </div>
      </main>
    </div>
  )
}
