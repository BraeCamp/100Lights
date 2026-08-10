// Phase 2 of the ElevenLabs learning corpus: capture what the AI PRODUCED for a user (stems + prompt/
// params) so an off-box worker can analyze it into the corpus. We intercept only the ElevenLabs OUTPUT
// — never the user's edits or finished song — and only when the user hasn't opted out (lib/user-prefs).
// Raw audio lives in R2 as transient STAGING under `captures/<id>/`; the worker (scripts/process-
// captures.mjs) analyzes it, records the (small) analysis to the corpus, then deletes the staging — so
// R2 only ever holds not-yet-processed captures.
//
// Lazy self-creating table (mirrors lib/credits.ts). Neon = user-creation captures; Brae's own
// generations stay local via scripts/elevenlabs-song.mjs.
import { sql } from '@/lib/db'

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS generation_captures (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      prompt       TEXT,
      params       JSONB,
      model        TEXT,
      stem_keys    JSONB,          -- [{ name, key }] in R2
      mix_key      TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',   -- pending | processed | failed
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )`
  ready = true
}

export interface CaptureInput {
  id: string; userId: string; prompt: string; params: Record<string, unknown>
  model: string; stemKeys: Array<{ name: string; key: string }>; mixKey: string | null
}

export async function recordCapture(c: CaptureInput): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO generation_captures (id, user_id, prompt, params, model, stem_keys, mix_key)
    VALUES (${c.id}, ${c.userId}, ${c.prompt}, ${JSON.stringify(c.params || {})}, ${c.model},
            ${JSON.stringify(c.stemKeys)}, ${c.mixKey})
    ON CONFLICT (id) DO NOTHING`
}
