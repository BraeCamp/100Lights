import { listCatalog } from '@/lib/catalog'

export const runtime = 'nodejs'

// GET /api/catalog — the official sound catalog, for every user's library.
// Public + edge-cached; metadata only, audio streams from /api/catalog/audio.
export async function GET() {
  try {
    const rows = await listCatalog()
    const items = rows.map(r => ({
      id: r.id, name: r.name, category: r.category,
      url: `/api/catalog/audio?key=${encodeURIComponent(r.r2Key)}`,
      duration: r.duration, folder: r.folder, parentFolder: r.parentFolder,
      tags: r.tags, key: r.key, bpm: r.bpm,
    }))
    return Response.json({ items }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
    })
  } catch {
    // Table may not exist yet — an empty catalog beats a broken library.
    return Response.json({ items: [] })
  }
}
