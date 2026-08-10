// STT correction/confirmation signal. When a user CONFIRMS a caption is right or CORRECTS it, we record
// the pair (what the model heard → what it should be) plus the model's own confidence. That's the ground
// truth the hybrid needs to calibrate itself: a CORRECTED high-confidence caption = the model was
// confidently wrong (be less sure there); a CONFIRMED low-confidence caption = a false alarm (don't
// flag/escalate that kind next time). Mirrors lib/voice-corrections.ts for the audio→MIDI path.
//
// Lazy self-creating Neon table; every write fails soft so feedback never blocks the UI.
import { sql } from '@/lib/db'

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS stt_corrections (
      id          TEXT PRIMARY KEY,
      source      TEXT NOT NULL DEFAULT 'captions',   -- 'captions' | 'video'
      original    TEXT NOT NULL,                       -- what the local model transcribed
      final       TEXT NOT NULL,                       -- what the user confirmed/corrected it to
      corrected   BOOLEAN NOT NULL,                    -- final != original
      confidence  REAL,                                -- the hybrid's confidence on this caption
      start_sec   REAL,
      end_sec     REAL,
      user_id     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

export interface SttCorrection {
  id: string
  source?: 'captions' | 'video'
  original: string
  final: string
  confidence?: number
  startSec?: number
  endSec?: number
}

/** Persist a batch of caption confirmations/corrections. `corrected` is derived (final != original) so
 *  both "it was right" (equal) and "here's the fix" (different) are captured in one call. Fails soft. */
export async function recordCorrections(records: SttCorrection[], userId?: string | null): Promise<number> {
  if (!records.length) return 0
  try {
    await ensure()
    let n = 0
    for (const r of records) {
      const original = (r.original ?? '').trim()
      const final = (r.final ?? '').trim()
      if (!original && !final) continue
      await sql`
        INSERT INTO stt_corrections (id, source, original, final, corrected, confidence, start_sec, end_sec, user_id)
        VALUES (${r.id}, ${r.source ?? 'captions'}, ${original}, ${final}, ${original !== final},
                ${r.confidence ?? null}, ${r.startSec ?? null}, ${r.endSec ?? null}, ${userId ?? null})
        ON CONFLICT (id) DO UPDATE SET final = EXCLUDED.final, corrected = EXCLUDED.corrected, created_at = NOW()`
      n++
    }
    return n
  } catch { return 0 }
}

export interface CorrectionRow extends SttCorrection { corrected: boolean; createdAt?: string }

/** All corrections/confirmations, newest first — for the admin review + confidence calibration. */
export async function listCorrections(limit = 500): Promise<CorrectionRow[]> {
  try {
    await ensure()
    const rows = await sql`SELECT * FROM stt_corrections ORDER BY created_at DESC LIMIT ${limit}`
    return rows.map(r => ({
      id: String(r.id), source: r.source as 'captions' | 'video', original: String(r.original), final: String(r.final),
      corrected: !!r.corrected, confidence: r.confidence as number ?? undefined,
      startSec: r.start_sec as number ?? undefined, endSec: r.end_sec as number ?? undefined, createdAt: String(r.created_at),
    }))
  } catch { return [] }
}

/** Quick calibration read: how often the model was confidently wrong vs falsely flagged. */
export async function correctionStats(): Promise<{ total: number; corrected: number; confidentlyWrong: number; falseAlarms: number }> {
  try {
    await ensure()
    const r = await sql`
      SELECT COUNT(*)::int total,
             COUNT(*) FILTER (WHERE corrected)::int corrected,
             COUNT(*) FILTER (WHERE corrected AND confidence >= 0.7)::int confidently_wrong,
             COUNT(*) FILTER (WHERE NOT corrected AND confidence < 0.7)::int false_alarms
      FROM stt_corrections`
    const row = r[0] || {}
    return { total: row.total ?? 0, corrected: row.corrected ?? 0, confidentlyWrong: row.confidently_wrong ?? 0, falseAlarms: row.false_alarms ?? 0 }
  } catch { return { total: 0, corrected: 0, confidentlyWrong: 0, falseAlarms: 0 } }
}
