import { sql, resolveUser, jsonError } from '@/lib/luz-cloud';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await resolveUser(request);
  if (!user) return jsonError('Sign in to your 100Lights account first.', 401);

  const inserted = (await sql`
    INSERT INTO luz_preset_likes (preset_id, user_id)
    VALUES (${id}, ${user.userId})
    ON CONFLICT DO NOTHING
    RETURNING preset_id
  `) as Array<unknown>;

  if (inserted.length > 0)
    await sql`UPDATE luz_presets SET likes = likes + 1 WHERE id = ${id}`;

  const rows = (await sql`SELECT likes FROM luz_presets WHERE id = ${id}`) as Array<{ likes: number }>;
  return Response.json({ likes: rows[0]?.likes ?? 0 });
}
