import { sql } from './db'

// One place that owns the learn_articles shape, so the articles route and the
// schedule route can't drift on it.
let ready = false

export async function ensureLearnSchema() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS learn_articles (
      slug        TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      date        TEXT NOT NULL,
      updated     TEXT,
      tags        TEXT NOT NULL DEFAULT '',
      draft       BOOLEAN NOT NULL DEFAULT true,
      body        TEXT NOT NULL DEFAULT ''
    )
  `
  // Added later for scheduled publishing — ISO datetime a draft goes live at.
  await sql`ALTER TABLE learn_articles ADD COLUMN IF NOT EXISTS publish_at TEXT`
  // Soft delete, mirroring projects. `repo_shadow` marks a row that exists
  // only to hide a committed content/learn/*.md file.
  await sql`ALTER TABLE learn_articles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`
  await sql`ALTER TABLE learn_articles ADD COLUMN IF NOT EXISTS repo_shadow BOOLEAN NOT NULL DEFAULT false`
  // "Was this helpful?" tallies, one row per article slug.
  await sql`
    CREATE TABLE IF NOT EXISTS learn_reactions (
      slug TEXT PRIMARY KEY,
      yes  INTEGER NOT NULL DEFAULT 0,
      no   INTEGER NOT NULL DEFAULT 0
    )
  `
  ready = true
}

/** Articles keep 7 days in the trash before permanent deletion. */
export const TRASH_DAYS = 7

/**
 * Drop rows whose trash window has expired.
 *
 * A row shadowing a repo file can never be fully removed — deleting it would
 * un-delete the article, because the .md file is still committed and would
 * become visible again. Those rows are emptied and kept as permanent
 * tombstones instead; everything else is deleted outright.
 */
export async function purgeExpiredArticleTrash() {
  await sql`
    DELETE FROM learn_articles
    WHERE deleted_at IS NOT NULL
      AND repo_shadow = false
      AND deleted_at < NOW() - INTERVAL '7 days'
  `
  await sql`
    UPDATE learn_articles SET body = '', description = ''
    WHERE deleted_at IS NOT NULL
      AND repo_shadow = true
      AND deleted_at < NOW() - INTERVAL '7 days'
      AND body <> ''
  `
}
