import { sql } from '@/lib/db'

// A living record of the source + license of every bundled piece of content
// (sounds, samples, presets, drum kits, article audio…). The point is that the
// licensing audit becomes an ongoing ledger instead of a one-time scramble, and
// you can prove provenance for anything you ship.

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS content_licenses (
      id         BIGSERIAL   PRIMARY KEY,
      name       TEXT        NOT NULL,
      category   TEXT        NOT NULL DEFAULT 'sound',
      source     TEXT,
      license    TEXT,
      url        TEXT,
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

export const LICENSE_CATEGORIES = ['sound', 'sample', 'preset', 'drum kit', 'loop', 'article audio', 'image', 'font', 'other']

export interface ContentLicense {
  id: string
  name: string
  category: string
  source: string | null
  license: string | null
  url: string | null
  notes: string | null
  updatedAt: string
}

function map(r: Record<string, unknown>): ContentLicense {
  return {
    id: String(r.id),
    name: r.name as string,
    category: (r.category as string) || 'sound',
    source: (r.source as string) ?? null,
    license: (r.license as string) ?? null,
    url: (r.url as string) ?? null,
    notes: (r.notes as string) ?? null,
    updatedAt: (r.updated_at as Date | string).toString(),
  }
}

export async function listLicenses(): Promise<ContentLicense[]> {
  await ensure()
  const rows = await sql`SELECT * FROM content_licenses ORDER BY category, name`
  return rows.map(map)
}

const clip = (s: unknown, n: number) => { const v = (typeof s === 'string' ? s : '').trim(); return v ? v.slice(0, n) : null }

export async function upsertLicense(input: {
  id?: string; name?: string; category?: string; source?: string; license?: string; url?: string; notes?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await ensure()
  const name = clip(input.name, 200)
  if (!name) return { ok: false, error: 'A name is required.' }
  const category = (input.category && LICENSE_CATEGORIES.includes(input.category)) ? input.category : 'sound'
  const source = clip(input.source, 500)
  const license = clip(input.license, 300)
  const url = clip(input.url, 1000)
  const notes = clip(input.notes, 2000)

  if (input.id) {
    await sql`
      UPDATE content_licenses SET name = ${name}, category = ${category}, source = ${source},
        license = ${license}, url = ${url}, notes = ${notes}, updated_at = NOW()
      WHERE id = ${input.id}
    `
    return { ok: true, id: input.id }
  }
  const rows = await sql`
    INSERT INTO content_licenses (name, category, source, license, url, notes)
    VALUES (${name}, ${category}, ${source}, ${license}, ${url}, ${notes})
    RETURNING id
  `
  return { ok: true, id: String(rows[0].id) }
}

export async function deleteLicense(id: string): Promise<void> {
  await ensure()
  await sql`DELETE FROM content_licenses WHERE id = ${id}`
}
