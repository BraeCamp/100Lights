import { auth } from '@clerk/nextjs/server'
import { isAdmin } from '@/lib/admin-auth'
import { listShorts, buildShortsZip } from '@/lib/shorts-export'

export const runtime = 'nodejs'

// GET /api/admin/shorts-export            → JSON manifest of the shorts (list mode, for the panel)
// GET /api/admin/shorts-export?zip=1      → a .zip of every short's mp4 + caption.txt (ready to post)
// Admin-only. Targets the signed-in admin's own "Shorts › <folder>" (default "Tests").
export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Admins only' }, { status: 401 })
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const url = new URL(req.url)
  const parent = url.searchParams.get('parent') || 'Shorts'
  const child = url.searchParams.get('folder') || 'Tests'

  if (url.searchParams.get('zip')) {
    const { zip, count } = await buildShortsZip(userId, parent, child)
    if (!count) return Response.json({ error: `No shorts found in ${parent} › ${child}` }, { status: 404 })
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(zip as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="shorts-${child.toLowerCase()}-${stamp}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const shorts = await listShorts(userId, parent, child)
  return Response.json({ folder: `${parent} › ${child}`, count: shorts.length, shorts: shorts.map(s => ({ name: s.name, slug: s.slug, duration: s.duration, caption: s.caption })) })
}
