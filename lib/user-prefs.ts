// Per-user AI preferences. Currently just the opt-out for the ElevenLabs learning corpus (Phase 2):
// when a user generates audio with AI, we analyze what the AI PRODUCED (notes/chords/FX) into the
// corpus to improve our own engine — never their edits or finished songs. This flag lets them opt out.
//
// Lazy self-creating table (mirrors lib/credits.ts / lib/age-gate.ts). Reads fail soft to the default
// (participating; opt_out = false).
import { sql } from '@/lib/db'
import { ensureSchema } from '@/lib/schema-version'

async function ensure(): Promise<void> {
  await ensureSchema('user-prefs', 1, async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id           TEXT PRIMARY KEY,
        ai_corpus_opt_out BOOLEAN NOT NULL DEFAULT false,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
  })
}

export interface AiPrefs { corpusOptOut: boolean }

/** Current AI prefs. Fails soft to the default (participating) so a DB hiccup never blocks the UI. */
export async function getAiPrefs(userId: string): Promise<AiPrefs> {
  try {
    await ensure()
    const r = await sql`SELECT ai_corpus_opt_out FROM user_prefs WHERE user_id = ${userId}`
    return { corpusOptOut: r.length ? !!r[0].ai_corpus_opt_out : false }
  } catch { return { corpusOptOut: false } }
}

export async function setAiCorpusOptOut(userId: string, optOut: boolean): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO user_prefs (user_id, ai_corpus_opt_out) VALUES (${userId}, ${optOut})
    ON CONFLICT (user_id) DO UPDATE SET ai_corpus_opt_out = ${optOut}, updated_at = NOW()`
}
