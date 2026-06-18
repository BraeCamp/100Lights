import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

interface Props {
  params: Promise<{ id: string }>
}

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
  return <>{children}</>
}
