import { listCatalog, catalogVersion } from '@/lib/catalog'

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
export async function GET(req: Request) {
  try {
    // The client sends the version it already has. Almost every page load is a
    // no-op — the catalog changes when an admin adds a pack, not when someone
    // opens the studio — so answering "nothing changed" in sixty bytes is the
    // difference between a quarter-megabyte per visit and none.
    const have = new URL(req.url).searchParams.get('v')
    const version = await catalogVersion()
    if (have && have === version) {
      return Response.json({ unchanged: true, version }, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
      })
    }
    const rows = await listCatalog()
    const items = rows.map(r => ({
      id: r.id, name: r.name, category: r.category,
      url: `/api/catalog/audio?key=${encodeURIComponent(r.r2Key)}`,
      duration: r.duration, folder: r.folder, parentFolder: r.parentFolder,
      tags: displayTags(r.tags), key: r.key, bpm: r.bpm,
    }))
    return Response.json({ items, version }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
    })
  } catch {
    // Table may not exist yet — an empty catalog beats a broken library.
    return Response.json({ items: [], version: '' })
  }
}
