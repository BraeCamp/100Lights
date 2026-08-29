import { sql, resolveUser, jsonError, toItem, MAX_PRESET_BYTES, PAGE_SIZE }
  from '@/lib/luz-cloud';

export const runtime = 'nodejs';

// ------------------------------------------------------------------ browse --
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const category = (url.searchParams.get('category') ?? '').trim();
  const viewer = (await resolveUser(request))?.userId ?? null;

  const like = q ? `%${q}%` : null;
  const cat = category && category !== 'All' ? category : null;

  const rows = (await sql`
    SELECT p.id, p.name, p.author, p.category, p.tags, p.notes,
           p.downloads, p.likes, p.updated_at,
           EXISTS (SELECT 1 FROM luz_preset_likes l
                    WHERE l.preset_id = p.id AND l.user_id = ${viewer}) AS liked_by_me,
           count(*) OVER () AS total
      FROM luz_presets p
     WHERE (p.is_public = true OR p.user_id = ${viewer})
       AND (${like}::text IS NULL
            OR lower(p.name) LIKE ${like}
            OR lower(p.tags) LIKE ${like}
            OR lower(p.author) LIKE ${like})
       AND (${cat}::text IS NULL OR p.category = ${cat})
     ORDER BY p.updated_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
  `) as Array<Record<string, unknown>>;

  return Response.json({
    items: rows.map(toItem),
    total: rows.length > 0 ? Number(rows[0].total) : 0,
    page,
  });
}

// ----------------------------------------------------------------- publish --
export async function POST(request: Request) {
  const user = await resolveUser(request);
  if (!user) return jsonError('Sign in to your 100Lights account first.', 401);

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('That request was not readable.', 400);

  const { name, category, tags, notes, xml, product } = body;
  const isPublic = body.public !== false;

  if (typeof name !== 'string' || name.trim().length === 0)
    return jsonError('A patch needs a name.', 400);
  if (typeof xml !== 'string' || xml.length === 0)
    return jsonError('That patch came through empty.', 400);
  if (Buffer.byteLength(xml, 'utf8') > MAX_PRESET_BYTES)
    return jsonError('That patch is unexpectedly large.', 413);
  if (!xml.includes('<LuzPreset'))
    return jsonError('That does not look like a Luz patch.', 400);

  const rows = (await sql`
    INSERT INTO luz_presets (user_id, name, author, category, tags, notes, product, xml, is_public)
    VALUES (${user.userId}, ${name.trim().slice(0, 120)}, ${user.displayName},
            ${String(category ?? 'Cloud').slice(0, 60)}, ${String(tags ?? '').slice(0, 240)},
            ${String(notes ?? '').slice(0, 2000)}, ${String(product ?? 'luz').slice(0, 32)},
            ${xml}, ${isPublic})
    RETURNING id, name
  `) as Array<{ id: string; name: string }>;

  return Response.json(rows[0], { status: 201 });
}
