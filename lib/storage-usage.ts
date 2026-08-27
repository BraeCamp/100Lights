import { sql } from '@/lib/db'

/**
 * How much cloud space someone is using — the ONE definition.
 *
 * Two things were true before this existed: storage counted only R2 media, and
 * the sum was written out separately in the usage route and both upload gates.
 * So a project's own data cost nothing against the limit, which is why free
 * accounts needed a projects-count cap on top — two different limits doing one
 * job, and the count is the one that annoys people (twenty tiny MIDI sketches
 * are not a storage problem, but they hit the cap).
 *
 * Counting project rows too means space is the only limit that has to exist.
 * Brae: "Maybe we can limit by storage space like we're doing for others."
 *
 * Media is summed one row per R2 key — stable keys overwrite, so re-uploads
 * must not double-count.
 */
export interface StorageUsage {
  mediaBytes: number
  projectBytes: number
  totalBytes: number
}

/**
 * @param excludeKey an R2 key to leave out — an upload REPLACING that key must
 *   not be charged for both copies. The gates did this before; keeping it here
 *   is what lets them share one definition instead of writing their own sum.
 */
export async function storageUsage(userId: string, excludeKey?: string): Promise<StorageUsage> {
  let mediaBytes = 0
  let projectBytes = 0

  // Both sides are best-effort: a table that has not been provisioned yet must
  // not stop someone uploading, and reporting a low number is safer than
  // refusing a paying customer over a missing table.
  try {
    const rows = excludeKey
      ? await sql`
          SELECT COALESCE(SUM(sz), 0)::bigint AS total FROM (
            SELECT DISTINCT ON (key) size AS sz FROM upload_log
            WHERE user_id = ${userId} AND key <> ${excludeKey}
            ORDER BY key, at DESC
          ) t`
      : await sql`
          SELECT COALESCE(SUM(sz), 0)::bigint AS total FROM (
            SELECT DISTINCT ON (key) size AS sz
            FROM upload_log WHERE user_id = ${userId}
            ORDER BY key, at DESC
          ) t`
    mediaBytes = Number(rows[0]?.total ?? 0)
  } catch { /* upload_log not provisioned yet */ }

  try {
    const rows = await sql`
      SELECT COALESCE(SUM(octet_length(data::text)), 0)::bigint AS total
      FROM projects WHERE user_id = ${userId}`
    projectBytes = Number(rows[0]?.total ?? 0)
  } catch { /* projects table unreadable → count media only */ }

  return { mediaBytes, projectBytes, totalBytes: mediaBytes + projectBytes }
}
