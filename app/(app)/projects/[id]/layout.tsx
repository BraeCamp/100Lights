import type { Metadata, Viewport } from 'next'
import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import ZoomBlock from '@/components/ZoomBlock'

interface Props {
  params: Promise<{ id: string }>
}

// The editor: pinch and ctrl+wheel are editing gestures, so browser zoom is
// locked here (the surrounding (app) group leaves it on for ordinary pages).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  if (id === 'demo') return { title: 'Demo Project', robots: { index: false, follow: false } }

  try {
    const { userId } = await auth()
    if (!userId) return { title: 'Project' }
    const rows = await sql`
      SELECT name FROM projects WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL LIMIT 1
    ` as { name: string }[]
    const name = rows[0]?.name
    return { title: name ?? 'Project', robots: { index: false, follow: false } }
  } catch {
    return { title: 'Project' }
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><ZoomBlock />{children}</>
}
