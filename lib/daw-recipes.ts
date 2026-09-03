// Admin "Test Recipes" → DAW recipe library.
//
// A recipe mined from real (public-domain) sheet music: a chord progression / bass line / melodic
// motif extracted as editable MIDI. Candidates land here for review in the admin panel; the sheet
// music itself is NOT stored — only the musical pattern. Integrate promotes a candidate into the
// live recipe library (merged client-side into the Sound Library catalog everyone sees, alongside the
// built-in CHORD_RECIPES); Delete discards it.
//
// The `spec` column is exactly a PracticeRecipe.build() result (see lib/practice-recipes.ts
// StoredRecipeSpec) so an integrated row drops straight into the catalog with no transform.
//
// Lazy self-creating table (mirrors lib/user-prefs.ts / lib/ai-cache.ts); every read fails soft.
import { sql } from '@/lib/db'

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS daw_recipes (
      id            TEXT PRIMARY KEY,
      status        TEXT NOT NULL DEFAULT 'candidate',   -- 'candidate' | 'integrated'
      title         TEXT NOT NULL,
      tagline       TEXT NOT NULL DEFAULT '',
      annotation    JSONB NOT NULL DEFAULT '[]'::jsonb,
      genre         TEXT,
      spec          JSONB NOT NULL,                      -- PracticeRecipe.build() output
      source        TEXT,                                -- where the pattern came from (admin note; not shown to users)
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      integrated_at TIMESTAMPTZ
    )`
  // Added after the table existed, so it is a separate statement rather than a
  // column in the CREATE above — a database created before this has already
  // skipped that one and would never see the new column.
  await sql`ALTER TABLE daw_recipes ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`
  ready = true
}

export type RecipeStatus = 'candidate' | 'integrated'

export interface DawRecipe {
  id: string
  status: RecipeStatus
  title: string
  tagline: string
  annotation: string[]
  genre?: string
  /** Free-form labels for browsing — the genre counts as one on top of these. */
  tags?: string[]
  spec: unknown            // ReturnType<PracticeRecipe['build']>
  source?: string
  createdAt?: string
  integratedAt?: string | null
}

/** StoredRecipeSpec shape the client catalog consumes (lib/practice-recipes.ts). */
export interface RecipeSpecPayload {
  id: string
  title: string
  tagline: string
  annotation: string[]
  genre?: string
  spec: unknown
}

function rowToRecipe(r: Record<string, unknown>): DawRecipe {
  return {
    id: String(r.id), status: r.status as RecipeStatus, title: String(r.title), tagline: String(r.tagline ?? ''),
    annotation: Array.isArray(r.annotation) ? r.annotation as string[] : [], genre: (r.genre as string) ?? undefined,
    tags: Array.isArray(r.tags) ? r.tags as string[] : [],
    spec: r.spec, source: (r.source as string) ?? undefined,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    integratedAt: r.integrated_at ? String(r.integrated_at) : null,
  }
}

/** All recipes for the admin panel (candidates + integrated), newest first. Fails soft to []. */
export async function listRecipes(): Promise<DawRecipe[]> {
  try {
    await ensure()
    const rows = await sql`SELECT * FROM daw_recipes ORDER BY (status = 'candidate') DESC, created_at DESC`
    return rows.map(rowToRecipe)
  } catch { return [] }
}

/** Integrated recipes only, as the client-catalog payload. Public read; fails soft to []. */
export async function getIntegratedSpecs(): Promise<RecipeSpecPayload[]> {
  try {
    await ensure()
    const rows = await sql`SELECT id, title, tagline, annotation, genre, spec FROM daw_recipes WHERE status = 'integrated' ORDER BY integrated_at DESC`
    return rows.map(r => ({
      id: String(r.id), title: String(r.title), tagline: String(r.tagline ?? ''),
      annotation: Array.isArray(r.annotation) ? r.annotation as string[] : [], genre: (r.genre as string) ?? undefined, spec: r.spec,
    }))
  } catch { return [] }
}

/** Add (or replace) a candidate recipe. First writer wins per id unless it re-runs the seed. */
export async function addCandidate(r: Omit<DawRecipe, 'status' | 'createdAt' | 'integratedAt'>): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO daw_recipes (id, status, title, tagline, annotation, genre, spec, source)
    VALUES (${r.id}, 'candidate', ${r.title}, ${r.tagline ?? ''}, ${JSON.stringify(r.annotation ?? [])}::jsonb,
            ${r.genre ?? null}, ${JSON.stringify(r.spec)}::jsonb, ${r.source ?? null})
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, tagline = EXCLUDED.tagline, annotation = EXCLUDED.annotation,
      genre = EXCLUDED.genre, spec = EXCLUDED.spec, source = EXCLUDED.source`
}

/** Promote a candidate into the live library. */
export async function integrateRecipe(id: string): Promise<void> {
  await ensure()
  await sql`UPDATE daw_recipes SET status = 'integrated', integrated_at = NOW() WHERE id = ${id}`
}

/** Send an integrated recipe back to candidate (undo an integrate). */
export async function unintegrateRecipe(id: string): Promise<void> {
  await ensure()
  await sql`UPDATE daw_recipes SET status = 'candidate', integrated_at = NULL WHERE id = ${id}`
}

/** Delete a recipe outright. */
export async function deleteRecipe(id: string): Promise<void> {
  await ensure()
  await sql`DELETE FROM daw_recipes WHERE id = ${id}`
}
