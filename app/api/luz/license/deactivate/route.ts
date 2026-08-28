import { sql } from '@/lib/luz-cloud';
import { findLicense, seatCount } from '@/lib/luz-license';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { key, machine } = body ?? {};

  const lic = await findLicense(key);
  if (!lic) return Response.json({ error: 'That key was not recognised.' }, { status: 404 });

  await sql`DELETE FROM luz_license_seats WHERE license_id = ${lic.id} AND machine = ${machine}`;

  return Response.json({
    ok: true,
    seatsUsed: await seatCount(lic.id),
    seatsAllowed: lic.seats_allowed,
  });
}
