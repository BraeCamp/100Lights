import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PLAY_EXPERIENCES, playBySlug } from '@/lib/play-experiences'
import PlayShell from '@/components/play/PlayShell'

export function generateStaticParams() {
  return PLAY_EXPERIENCES.map(e => ({ slug: e.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const e = playBySlug(slug)
  if (!e) return { title: 'Play — 100Lights' }
  const url = `https://100lights.com/play/${e.slug}`
  return {
    title: `${e.title} — 100Lights`,
    description: e.description,
    alternates: { canonical: url },
    openGraph: { title: e.title, description: e.description, url, type: 'website', siteName: '100Lights' },
    twitter: { card: 'summary_large_image', title: e.title, description: e.description },
  }
}

export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const e = playBySlug(slug)
  if (!e) notFound()
  return <PlayShell slug={e.slug} />
}
