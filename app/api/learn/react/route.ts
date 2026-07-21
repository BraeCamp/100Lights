import { sql } from '@/lib/db'
import { ensureLearnSchema } from '@/lib/learn-schema'

export const runtime = 'nodejs'

// "Was this helpful?" tallies for an article. Public and unauthenticated — the
// client guards double-votes with localStorage, which is plenty for a soft
// helpfulness signal (no accounts, nothing sensitive stored).

export async function GET(req: Request) {
  await ensureLearnSchema()
  const slug = new URL(req.url).searchParams.get('slug')
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })
  const [row] = await sql`SELECT yes, no FROM learn_reactions WHERE slug = ${slug}`
  return Response.json({ yes: Number(row?.yes ?? 0), no: Number(row?.no ?? 0) })
}

export async function POST(req: Request) {
  await ensureLearnSchema()
  let body: { slug?: string; helpful?: boolean }
  try { body = await req.json() } catch { return Response.json({ error: 'bad json' }, { status: 400 }) }
  if (!body.slug) return Response.json({ error: 'slug required' }, { status: 400 })
  const slug = body.slug
  const [row] = body.helpful
    ? await sql`INSERT INTO learn_reactions (slug, yes) VALUES (${slug}, 1)
                ON CONFLICT (slug) DO UPDATE SET yes = learn_reactions.yes + 1 RETURNING yes, no`
    : await sql`INSERT INTO learn_reactions (slug, no) VALUES (${slug}, 1)
                ON CONFLICT (slug) DO UPDATE SET no = learn_reactions.no + 1 RETURNING yes, no`
  return Response.json({ ok: true, yes: Number(row.yes), no: Number(row.no) })
}
