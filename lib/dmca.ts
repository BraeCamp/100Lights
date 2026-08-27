import { sql } from '@/lib/db'
import { schemaManaged } from './schema-guard'

// DMCA takedown notices. Safe-harbor protection requires a public way for
// copyright holders (who often aren't users) to report infringing user content
// and a process to act on it. Notices land here and surface in the admin, next
// to the community moderation queue.

let ready = false
async function ensure(): Promise<void> {
  if (ready || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS dmca_notices (
      id               BIGSERIAL   PRIMARY KEY,
      complainant_name TEXT        NOT NULL,
      email            TEXT        NOT NULL,
      work_description TEXT        NOT NULL,
      infringing_url   TEXT        NOT NULL,
      signature        TEXT        NOT NULL,
      good_faith       BOOLEAN     NOT NULL DEFAULT FALSE,
      accuracy         BOOLEAN     NOT NULL DEFAULT FALSE,
      status           TEXT        NOT NULL DEFAULT 'open',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

export interface DmcaNotice {
  id: string
  complainantName: string
  email: string
  workDescription: string
  infringingUrl: string
  signature: string
  status: 'open' | 'resolved'
  createdAt: string
}

const clip = (s: unknown, max: number) => (typeof s === 'string' ? s : '').trim().slice(0, max)

export async function submitDmcaNotice(input: {
  complainantName?: string; email?: string; workDescription?: string
  infringingUrl?: string; signature?: string; goodFaith?: boolean; accuracy?: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensure()
  const name = clip(input.complainantName, 200)
  const email = clip(input.email, 200)
  const work = clip(input.workDescription, 4000)
  const url = clip(input.infringingUrl, 1000)
  const signature = clip(input.signature, 200)
  if (!name || !email || !work || !url || !signature) return { ok: false, error: 'Please complete every field.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid contact email.' }
  if (!input.goodFaith || !input.accuracy) return { ok: false, error: 'Both statements must be affirmed.' }
  await sql`
    INSERT INTO dmca_notices (complainant_name, email, work_description, infringing_url, signature, good_faith, accuracy)
    VALUES (${name}, ${email}, ${work}, ${url}, ${signature}, TRUE, TRUE)
  `
  return { ok: true }
}

function map(r: Record<string, unknown>): DmcaNotice {
  return {
    id: String(r.id),
    complainantName: r.complainant_name as string,
    email: r.email as string,
    workDescription: r.work_description as string,
    infringingUrl: r.infringing_url as string,
    signature: r.signature as string,
    status: r.status as 'open' | 'resolved',
    createdAt: (r.created_at as Date | string).toString(),
  }
}

export async function listDmcaNotices(): Promise<DmcaNotice[]> {
  await ensure()
  const rows = await sql`SELECT * FROM dmca_notices ORDER BY (status = 'open') DESC, created_at DESC LIMIT 200`
  return rows.map(map)
}

export async function setDmcaStatus(id: string, status: 'open' | 'resolved'): Promise<void> {
  await ensure()
  await sql`UPDATE dmca_notices SET status = ${status} WHERE id = ${id}`
}
