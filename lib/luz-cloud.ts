// ===========================================================================
//  Luz Cloud — shared helpers for the Next.js route handlers
//
//  Drop this file at lib/luz-cloud.ts in the 100Lights app and copy the
//  app/api/luz tree alongside it. Uses @neondatabase/serverless so it runs on
//  the edge or in a node runtime without a connection pool.
// ===========================================================================
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';

// Reuses the app's own connection rather than opening a second one. lib/db.ts
// already picks between a local Postgres and Neon, so the licence routes work
// in local dev too — a private neon(DATABASE_URL!) here threw at import time
// whenever the variable was unset, taking unrelated pages down with it.
export { sql };

const pepper = () => process.env.LUZ_KEY_PEPPER ?? '';

export const hashKey = (key: string) =>
  createHash('sha256').update(`${key}${pepper()}`).digest('hex');

export const generateKey = () => `luz_${randomBytes(24).toString('base64url')}`;

export type LuzUser = {
  userId: string;
  email: string;
  displayName: string;
  plan: string;
};

/** Resolves the caller from the Authorization header, or null. */
export async function resolveUser(request: Request): Promise<LuzUser | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const rows = (await sql`
    SELECT u.id, u.email, u.display_name, u.plan
      FROM luz_api_keys k
      JOIN luz_users u ON u.id = k.user_id
     WHERE k.key_hash = ${hashKey(match[1])} AND k.revoked_at IS NULL
     LIMIT 1
  `) as Array<{ id: string; email: string; display_name: string; plan: string }>;

  if (rows.length === 0) return null;

  return {
    userId: rows[0].id,
    email: rows[0].email,
    displayName: rows[0].display_name,
    plan: rows[0].plan,
  };
}

export const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

/** The shape the plug-in expects for a preset listing entry. */
export const toItem = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  author: row.author,
  category: row.category,
  tags: row.tags,
  notes: row.notes,
  downloads: Number(row.downloads ?? 0),
  likes: Number(row.likes ?? 0),
  likedByMe: Boolean(row.liked_by_me ?? false),
  updatedAt: row.updated_at,
});

export const MAX_PRESET_BYTES = 512 * 1024;
export const PAGE_SIZE = 40;
