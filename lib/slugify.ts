/**
 * The canonical URL/filename slug. Use this for anything a user will see in a
 * URL, an R2 key, or a downloaded filename — project slugs, podcast show slugs,
 * shorts, export filenames.
 *
 * Two other functions in this repo look like slugify and are deliberately NOT
 * this one; don't "unify" them without reading why:
 *   · lib/article-personas.ts  headingAnchorId  — heading anchors in published
 *     Learn articles. Changing it breaks every existing #deep-link.
 *   · lib/music-learn.mjs      corpusSlug       — on-disk corpus directory
 *     names. Changing it orphans existing corpus entries.
 */
export function slugify(name: string, fallback = 'untitled'): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60) || fallback
}
