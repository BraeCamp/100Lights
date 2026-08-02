import { sql } from './db'
import { ensureLearnSchema } from './learn-schema'

// Author "needs work / to-do" flags for Learn articles. A row in `article_todo`
// means the article is flagged; `note` is an optional reminder of what's wrong.
// Decoupled from learn_articles so it works for repo-only and DB articles alike.

export interface TodoFlag { slug: string; note: string }

/** All flagged slugs → note. */
export async function getTodoFlags(): Promise<Record<string, string>> {
  await ensureLearnSchema()
  const rows = await sql`SELECT slug, note FROM article_todo` as { slug: string; note: string }[]
  const out: Record<string, string> = {}
  for (const r of rows) out[r.slug] = r.note
  return out
}

/** Flag (with an optional note) or clear an article's to-do state. */
export async function setTodoFlag(slug: string, needsWork: boolean, note = ''): Promise<void> {
  await ensureLearnSchema()
  if (needsWork) {
    await sql`
      INSERT INTO article_todo (slug, note, updated) VALUES (${slug}, ${note}, NOW())
      ON CONFLICT (slug) DO UPDATE SET note = EXCLUDED.note, updated = NOW()
    `
  } else {
    await sql`DELETE FROM article_todo WHERE slug = ${slug}`
  }
}
