// ── Pretty project URLs ──────────────────────────────────────────────────────
// A project's shareable URL is `/@username/<readable-slug>-<code>`, e.g.
//   /@brae/midnight-drive-a3f91b
// The `<code>` is a stable short prefix of the project id (a UUID) — it never
// changes when the project is renamed, so links stay valid forever. The readable
// slug is purely cosmetic: resolution (see app/(app)/[username]/[slug]/page.tsx)
// ignores it and looks the project up by the code, so an out-of-date slug in an
// old link still resolves. No DB migration needed — the code is derived from the
// id we already store, appended to the URL at link-build time.

/** Stable short code for a project, derived from its id (rename-invariant). */
export function projectCode(id: string): string {
  const hex = id.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return hex.slice(0, 6) || id.slice(0, 6)
}

/** Build the canonical `/@username/slug-code` path from stored fields. */
export function projectPath(username: string | null | undefined, slug: string | null | undefined, id: string): string {
  const u = (username ?? '').replace(/^@/, '').trim()
  if (!u) return `/projects/${id}` // no username yet → fall back to the id URL
  const s = (slug || 'project').replace(/^\/+|\/+$/g, '')
  return `/@${encodeURIComponent(u)}/${s}-${projectCode(id)}`
}

/** Extract the trailing `-code` from a slug path segment (for resolution). */
export function codeFromSlug(slug: string): string {
  const parts = slug.split('-')
  return (parts[parts.length - 1] ?? '').toLowerCase()
}
