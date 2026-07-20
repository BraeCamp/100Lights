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
  ready = true
}
