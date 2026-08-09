import { sql } from '@/lib/db'

// Voice Corrections — the server-side mirror of the VoiceMidi human-in-the-loop
// correction loop (client store lives in lib/voice-corrections.ts + IndexedDB).
// Each row is one "take" a user (or the owner) manually fixed: the tracker's
// DETECTED notes, the user's CORRECTED ground truth, the acoustic EVIDENCE, the
// take audio (stored as a playable WAV in R2 under `voice-corrections/`), and the
// detector SETTINGS in force. The owner then COMMENTS on each ("what to fix in
// detection/rendering") and the AI reads those comments + the data to tune.
//
// Mirrors lib/app-targets.ts: lazy self-creating table, fail-soft list, R2 for the
// binary payload, JSONB for the structured signals. Written by two paths — the
// public submit route (from the no-login voicemidi app) and the admin CRUD route.

export interface CorrectionRow {
  id: string
  ts: number
  appVersion: string
  detected: unknown          // CorrectionNote[]
  corrected: unknown         // CorrectionNote[]
  diff: unknown              // CorrectionDiff
  evidence: unknown          // CorrectionEvidence (per-frame arrays)
  /** R2 object key of the take audio (WAV), when audio was present. */
  r2Key: string | null
  audioSr: number | null
  audioDur: number | null
  settings: unknown          // CorrectionSettings (+ instrument)
  comment: string            // the owner's "what to fix" note the AI reads
  status: string             // 'new' | 'reviewed' | 'fixed'
  createdAt?: string
}

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS voice_corrections (
      id          TEXT PRIMARY KEY,
      ts          BIGINT NOT NULL DEFAULT 0,
      app_version TEXT NOT NULL DEFAULT '',
      detected    JSONB NOT NULL DEFAULT '[]'::jsonb,
      corrected   JSONB NOT NULL DEFAULT '[]'::jsonb,
      diff        JSONB NOT NULL DEFAULT '{}'::jsonb,
      evidence    JSONB NOT NULL DEFAULT '{}'::jsonb,
      r2_key      TEXT,
      audio_sr    DOUBLE PRECISION,
      audio_dur   DOUBLE PRECISION,
      settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
      comment     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'new',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

function toRow(r: Record<string, unknown>): CorrectionRow {
  const j = (v: unknown, fb: unknown) => {
    if (v == null) return fb
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return fb } }
    return v
  }
  return {
    id: String(r.id),
    ts: Number(r.ts ?? 0),
    appVersion: String(r.app_version ?? ''),
    detected: j(r.detected, []),
    corrected: j(r.corrected, []),
    diff: j(r.diff, {}),
    evidence: j(r.evidence, {}),
    r2Key: r.r2_key ? String(r.r2_key) : null,
    audioSr: r.audio_sr != null ? Number(r.audio_sr) : null,
    audioDur: r.audio_dur != null ? Number(r.audio_dur) : null,
    settings: j(r.settings, {}),
    comment: String(r.comment ?? ''),
    status: String(r.status ?? 'new'),
    createdAt: r.created_at ? String(r.created_at) : undefined,
  }
}

/** All corrections, newest first. Fails soft (returns []) so the admin panel and
 *  the public submit's "already have some" path never crash when the DB is
 *  unreachable in dev — mirrors getFlags / listTargets defaults. */
export async function listCorrections(): Promise<CorrectionRow[]> {
  try {
    await ensure()
    const rows = await sql`
      SELECT id, ts, app_version, detected, corrected, diff, evidence,
             r2_key, audio_sr, audio_dur, settings, comment, status, created_at
      FROM voice_corrections ORDER BY created_at DESC
    `
    return rows.map(toRow)
  } catch {
    return []
  }
}

export async function addCorrection(p: {
  id: string; ts: number; appVersion: string
  detected: unknown; corrected: unknown; diff: unknown; evidence: unknown
  r2Key?: string | null; audioSr?: number | null; audioDur?: number | null
  settings: unknown; comment?: string; status?: string
}): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO voice_corrections (
      id, ts, app_version, detected, corrected, diff, evidence,
      r2_key, audio_sr, audio_dur, settings, comment, status
    ) VALUES (
      ${p.id}, ${p.ts}, ${p.appVersion},
      ${JSON.stringify(p.detected ?? [])}::jsonb,
      ${JSON.stringify(p.corrected ?? [])}::jsonb,
      ${JSON.stringify(p.diff ?? {})}::jsonb,
      ${JSON.stringify(p.evidence ?? {})}::jsonb,
      ${p.r2Key ?? null}, ${p.audioSr ?? null}, ${p.audioDur ?? null},
      ${JSON.stringify(p.settings ?? {})}::jsonb,
      ${p.comment ?? ''}, ${p.status ?? 'new'}
    )
    ON CONFLICT (id) DO NOTHING
  `
}

/** Owner's edit surface: the "what to fix" comment + the review status. Only the
 *  provided fields change (COALESCE keeps the other). */
export async function updateCorrection(id: string, p: { comment?: string; status?: string }): Promise<boolean> {
  await ensure()
  const rows = await sql`
    UPDATE voice_corrections SET
      comment = COALESCE(${p.comment ?? null}, comment),
      status  = COALESCE(${p.status ?? null}, status)
    WHERE id = ${id}
    RETURNING id
  `
  return rows.length > 0
}

/** Delete the row and return its r2_key (if any) so the caller can drop the
 *  take audio from R2. Returns { found } so a no-audio record still reports it. */
export async function deleteCorrection(id: string): Promise<{ found: boolean; r2Key: string | null }> {
  await ensure()
  const rows = await sql`DELETE FROM voice_corrections WHERE id = ${id} RETURNING r2_key`
  if (rows.length === 0) return { found: false, r2Key: null }
  return { found: true, r2Key: rows[0].r2_key ? String(rows[0].r2_key) : null }
}

/** Look up one correction (used to presign its take audio for playback/download). */
export async function getCorrection(id: string): Promise<CorrectionRow | null> {
  await ensure()
  const rows = await sql`
    SELECT id, ts, app_version, detected, corrected, diff, evidence,
           r2_key, audio_sr, audio_dur, settings, comment, status, created_at
    FROM voice_corrections WHERE id = ${id}
  `
  return rows.length ? toRow(rows[0]) : null
}

/**
 * The AI's read path — every correction as plain JSON, including the owner's
 * comments. This is what a tuning/training pass consumes (alongside the per-take
 * WAV it can presign + fetch by r2Key). Consumption is a separate, later step.
 */
export async function exportCorrections(): Promise<{ exportedAt: string; count: number; corrections: CorrectionRow[] }> {
  const corrections = await listCorrections()
  return { exportedAt: new Date().toISOString(), count: corrections.length, corrections }
}

// ── WAV writer (int16 LE PCM base64 → playable mono WAV bytes) ────────────────────
// The client stores the take as base64 little-endian Int16 PCM. We wrap it in a
// 44-byte canonical WAV header so R2 holds a directly-playable/analyzable file —
// no float round-trip (the PCM bytes are copied through verbatim).
export function pcmBase64ToWav(pcmBase64: string, sampleRate: number): Uint8Array {
  // Decode base64 → PCM bytes (Node Buffer; this module runs server-side only).
  const pcm = Buffer.from(pcmBase64 || '', 'base64')
  // Keep it even-length (whole Int16 frames).
  const dataLen = pcm.length - (pcm.length % 2)
  const sr = sampleRate > 0 ? Math.round(sampleRate) : 16000
  const numCh = 1, bitsPer = 16
  const blockAlign = numCh * (bitsPer / 8)
  const byteRate = sr * blockAlign
  const out = new Uint8Array(44 + dataLen)
  const dv = new DataView(out.buffer)
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE')
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, numCh, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, byteRate, true)
  dv.setUint16(32, blockAlign, true); dv.setUint16(34, bitsPer, true)
  ws(36, 'data'); dv.setUint32(40, dataLen, true)
  out.set(pcm.subarray(0, dataLen), 44)
  return out
}
