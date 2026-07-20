/**
 * Tag parsing, kept free of server imports.
 *
 * This lives apart from `learn-articles.ts` because the admin editor (a client
 * component) needs it, and importing it from there would pull `fs` and the
 * database driver into the browser bundle.
 */

/** Most tags an article may carry. */
export const MAX_TAGS = 10

/**
 * Parse a comma-separated tag list, de-duplicated and capped.
 *
 * The cap keeps recommendations meaningful: tags decide which articles get
 * suggested, and an article tagged with everything matches everything, which
 * makes it noise in every other article's shortlist. Order is authorial, so
 * the first ten are kept — put the most applicable ones first.
 */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of (raw ?? '').split(',')) {
    const tag = t.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length === MAX_TAGS) break
  }
  return out
}
