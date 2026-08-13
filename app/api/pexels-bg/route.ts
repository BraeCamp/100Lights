// Public read of the curated Pexels background catalog — powers the search/browse bar in Lightning
// Bug. Returns only ACTIVE rows (hidden/deleted ones stay out). Videos stream from Pexels' CDN.
import { list } from '@/lib/pexels-bg'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  try {
    const rows = await list({
      q: p.get('q') ?? undefined,
      category: p.get('category') ?? undefined,
      brightness: p.get('brightness') ?? undefined,
      speed: p.get('speed') ?? undefined,
      status: 'active',
      order: p.get('order') === 'random' ? 'random' : undefined,
      limit: p.get('limit') ? Number(p.get('limit')) : 48,
      offset: p.get('offset') ? Number(p.get('offset')) : 0,
    })
    // Trim to what the browser needs.
    return Response.json({
      results: rows.map(r => ({ id: r.id, title: r.title, mp4: r.mp4, poster: r.poster, category: r.category, brightness: r.brightness, speed: r.speed, tags: r.tags, author: r.author, blockEdits: r.blockEdits })),
    })
  } catch {
    return Response.json({ results: [] })   // table may not exist yet
  }
}
