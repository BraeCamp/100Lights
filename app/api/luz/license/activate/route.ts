import { sql } from '@/lib/luz-cloud';
import { findLicense, seatCount, asMillis } from '@/lib/luz-license';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { key, machine, label } = body ?? {};
  if (!machine) return Response.json({ error: 'Missing machine id.' }, { status: 400 });

  const lic = await findLicense(key);
  if (!lic) return Response.json({ error: 'That key was not recognised.' }, { status: 404 });
  if (lic.revoked_at)
    return Response.json({ error: 'That licence has been withdrawn.' }, { status: 403 });
  if (lic.expires_at && new Date(lic.expires_at) < new Date())
    return Response.json({ error: 'That licence has expired.' }, { status: 403 });

  // Reinstalling on a machine that already has a seat must never cost a seat.
  const existing = (await sql`
    SELECT 1 FROM luz_license_seats WHERE license_id = ${lic.id} AND machine = ${machine}
  `) as Array<unknown>;

  if (existing.length === 0) {
    const used = await seatCount(lic.id);
    if (used >= lic.seats_allowed)
      return Response.json({
        error: `That key is already active on ${used} machines. Release one from its Licence page first.`,
      }, { status: 409 });
  }

  await sql`
    INSERT INTO luz_license_seats (license_id, machine, label)
    VALUES (${lic.id}, ${machine}, ${String(label ?? '').slice(0, 80)})
    ON CONFLICT (license_id, machine)
    DO UPDATE SET last_seen = now(), label = EXCLUDED.label
  `;

  return Response.json({
    owner: lic.owner,
    email: lic.email,
    product: lic.product,
    orderRef: lic.order_ref ?? '',
    expiresAt: asMillis(lic.expires_at),
    seatsUsed: await seatCount(lic.id),
    seatsAllowed: lic.seats_allowed,
  });
}
