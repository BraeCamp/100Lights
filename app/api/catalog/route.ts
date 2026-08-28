import { listCatalog } from '@/lib/catalog'

/**
 * The catalog rows carry full provenance — every label, the source URL, the
 * description — because a pack is only reorganisable later if that survives
 * the import. None of it belongs in THIS response: syncCatalog fetches the
 * whole list with `no-store`, so it is paid on every page load by every
 * visitor. Measured on a 3,289-sound pack: 234 KB gzipped with everything,
 * 86 KB without the four heavy fields.
 *
 * They stay in the database, which is where a reorganisation runs anyway.
 */
// `inst:` repeats the folder name on all 351 samples of one piano, and
// `var:`/`grp:`/`fam:` are groupings only a reorganisation reads. `note:`,
// `rr:` and `mic:` stay: Apollo reads all three in the browser to build key
// zones and to pick which take of a pitch to load.
const HEAVY = /^(labels|desc|url|src|inst|var|grp|fam):/
function displayTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return tags
  return tags.filter(t => !HEAVY.test(t))
}

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
      tags: displayTags(r.tags), key: r.key, bpm: r.bpm,
    }))
    return Response.json({ items }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
    })
  } catch {
    // Table may not exist yet — an empty catalog beats a broken library.
    return Response.json({ items: [] })
  }
}
