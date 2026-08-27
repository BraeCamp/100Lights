// Admin-only "export pass" for the social shorts: collect the rendered shorts from a nested
// account folder (e.g. Shorts › Tests), and bundle each as {mp4 + caption.txt} into a zip that's
// ready to post. The mp4s already live in R2 (built by scripts/build-shorts.mjs); this just packages
// them with their embedded post caption (data.postCaption). Gate callers with isAdmin().
import JSZip from 'jszip'
import { sql } from '@/lib/db'
import { presignDownload } from '@/lib/r2'
import { slugify } from '@/lib/slugify'

export interface ShortRow { id: string; name: string; slug: string; r2Key: string; caption: string; duration: number }


/** Resolve a nested folder (parent → child) to its id for a user. */
async function resolveFolder(userId: string, parent: string, child: string): Promise<string | null> {
  const par = await sql`SELECT id FROM folders WHERE user_id = ${userId} AND name = ${parent} ORDER BY created_at DESC LIMIT 1` as { id: string }[]
  const parentId = par[0]?.id ?? null
  const f = await sql`
    SELECT id FROM folders
    WHERE user_id = ${userId} AND name = ${child} AND parent_id IS NOT DISTINCT FROM ${parentId}
    ORDER BY created_at DESC LIMIT 1` as { id: string }[]
  return f[0]?.id ?? null
}

/** List the shorts (video projects) in the given nested folder, newest first. */
export async function listShorts(userId: string, parent = 'Shorts', child = 'Tests'): Promise<ShortRow[]> {
  const folderId = await resolveFolder(userId, parent, child)
  if (!folderId) return []
  const rows = await sql`
    SELECT id, name, slug, data
    FROM projects
    WHERE user_id = ${userId} AND folder_id = ${folderId} AND deleted_at IS NULL
    ORDER BY saved_at` as { id: string; name: string; slug: string; data: Record<string, unknown> }[]
  const out: ShortRow[] = []
  for (const r of rows) {
    const media = (r.data?.media as { r2Key?: string; duration?: number }[] | undefined) ?? []
    const r2Key = media[0]?.r2Key
    if (!r2Key) continue
    out.push({
      id: r.id, name: r.name, slug: r.slug || slugify(r.name, 'short'), r2Key,
      caption: (r.data?.postCaption as string) || r.name,
      duration: Number(media[0]?.duration ?? 0),
    })
  }
  return out
}

/** Build a zip: <slug>.mp4 + <slug>.txt (caption) for every short in the folder. Returns the zip bytes. */
export async function buildShortsZip(userId: string, parent = 'Shorts', child = 'Tests'): Promise<{ zip: Uint8Array; count: number }> {
  const shorts = await listShorts(userId, parent, child)
  const zip = new JSZip()
  const seen = new Set<string>()
  for (const s of shorts) {
    let base = s.slug
    while (seen.has(base)) base = `${base}-2`
    seen.add(base)
    const url = await presignDownload(s.r2Key, 600)
    const res = await fetch(url)
    if (!res.ok) continue
    const buf = new Uint8Array(await res.arrayBuffer())
    zip.file(`${base}.mp4`, buf)
    zip.file(`${base}.txt`, s.caption)
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return { zip: bytes, count: seen.size }
}
