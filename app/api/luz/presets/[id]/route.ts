import { sql, resolveUser, jsonError, toItem } from '@/lib/luz-cloud';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const viewer = (await resolveUser(request))?.userId ?? null;

  const rows = (await sql`
    SELECT * FROM luz_presets
     WHERE id = ${id} AND (is_public = true OR user_id = ${viewer})
     LIMIT 1
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) return jsonError('No such patch.', 404);

  // best effort; a failed counter must not fail the download
  sql`UPDATE luz_presets SET downloads = downloads + 1 WHERE id = ${id}`.catch(() => {});

  return Response.json({ ...toItem(rows[0]), xml: rows[0].xml });
}
