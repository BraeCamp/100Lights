import { sql } from '@/lib/luz-cloud';
import { findLicense, seatCount, asMillis } from '@/lib/luz-license';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { key, machine } = body ?? {};

  const lic = await findLicense(key);
  if (!lic)
    return Response.json({ valid: false, error: 'That key was not recognised.' }, { status: 404 });
  if (lic.revoked_at)
    return Response.json({ valid: false, reason: 'This licence has been withdrawn.' }, { status: 403 });
  if (lic.expires_at && new Date(lic.expires_at) < new Date())
    return Response.json({ valid: false, reason: 'This licence has expired.' }, { status: 403 });

  const seat = (await sql`
    UPDATE luz_license_seats SET last_seen = now()
     WHERE license_id = ${lic.id} AND machine = ${machine}
     RETURNING machine
  `) as Array<unknown>;

  if (seat.length === 0)
    return Response.json({ valid: false, reason: 'This machine is no longer activated.' });

  return Response.json({
    valid: true,
    seatsUsed: await seatCount(lic.id),
    seatsAllowed: lic.seats_allowed,
    expiresAt: asMillis(lic.expires_at),
  });
}
