// ===========================================================================
//  Mint licence keys in bulk, for resellers.
//
//  Plugin Boutique, ADSR and the rest sell the plug-in themselves: our Stripe
//  webhook never fires, so nothing mints a key. The usual arrangement is that
//  we hand the marketplace a list of serials up front and they give one to
//  each buyer. That is what this is for.
//
//  Keys minted here have no email attached. They are claimed by whoever
//  activates them first — /license/activate never required an email, it just
//  reports whatever the licence carries.
//
//    curl -X POST https://100lights.com/api/luz/license/batch \
//      -H "authorization: Bearer $PLUGINS_ADMIN_TOKEN" \
//      -H "content-type: application/json" \
//      -d '{"count":500,"note":"pluginboutique-2026-09"}'
// ===========================================================================
import { timingSafeEqual } from 'node:crypto';
import { sql } from '@/lib/luz-cloud';
import { generateLicenseKey } from '@/lib/luz-license';

export const runtime = 'nodejs';

/** At most one batch this size — a typo in `count` should not mint a million rows. */
const MAX_BATCH = 5000;

function authorised(request: Request): boolean {
  // Product-neutral: this endpoint mints keys for ANY plug-in in the catalog,
  // so the token that guards it is not Luz's. LUZ_ADMIN_TOKEN is accepted as a
  // fallback only so an environment set up before the rename keeps working.
  const expected =
    process.env.PLUGINS_ADMIN_TOKEN ?? process.env.LUZ_ADMIN_TOKEN ?? '';
  // Fails CLOSED. If the variable is missing in some environment, the endpoint
  // must refuse rather than accept an empty bearer token and let anyone mint
  // themselves a free licence.
  if (expected.length < 16) return false;

  const match = /^Bearer\s+(.+)$/i.exec((request.headers.get('authorization') ?? '').trim());
  if (!match) return false;

  const given = Buffer.from(match[1]);
  const want = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // length is not the secret.
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(request: Request) {
  if (!authorised(request))
    return Response.json({ error: 'Not authorised.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const count = Number(body?.count ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH)
    return Response.json(
      { error: `count must be a whole number between 1 and ${MAX_BATCH}.` },
      { status: 400 },
    );

  const product = String(body?.product ?? 'luz').slice(0, 40);
  const seats = Number.isInteger(body?.seats) ? Number(body.seats) : 3;
  const note = String(body?.note ?? '').slice(0, 200);
  const owner = String(body?.owner ?? '').slice(0, 120);

  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    // The alphabet excludes I, L, O and U, so a collision is remote — but
    // `key` is UNIQUE, and one clash would otherwise abort the whole batch.
    // Retry a few times, then give up loudly rather than return short.
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const key = generateLicenseKey();
      const rows = (await sql`
        INSERT INTO luz_licenses (key, product, owner, email, seats_allowed, note)
        VALUES (${key}, ${product}, ${owner}, '', ${seats}, ${note})
        ON CONFLICT (key) DO NOTHING
        RETURNING key
      `) as Array<{ key: string }>;
      if (rows.length > 0) {
        keys.push(rows[0].key);
        inserted = true;
      }
    }
    if (!inserted)
      return Response.json(
        { error: 'Could not generate a unique key.', minted: keys },
        { status: 500 },
      );
  }

  return Response.json({ count: keys.length, product, seats, note, keys });
}
