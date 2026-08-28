// ===========================================================================
//  Luz licensing helpers for the Next.js routes.
//  Drop at lib/luz-license.ts alongside lib/luz-cloud.ts.
// ===========================================================================
import { randomInt } from 'node:crypto';
import { sql } from './luz-cloud';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I L O U

export function generateLicenseKey(prefix = 'LUZ') {
  const group = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${prefix}-${group()}-${group()}-${group()}-${group()}`;
}

/** Accepts lower case, spaces, missing dashes and the usual mistyped glyphs.

    Folding is applied to the BODY ONLY: the prefix deliberately contains
    letters outside the key alphabet ("LUZ" has an L and a U), so folding the
    whole string would rewrite it to "1VZ" and no real key would match. */
export function normaliseLicenseKey(input: unknown): string | null {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');

  if (cleaned.length < 16) return null;

  const prefix = cleaned.slice(0, cleaned.length - 16) || 'LUZ';
  const body = cleaned
    .slice(cleaned.length - 16)
    .replace(/I/g, '1').replace(/L/g, '1').replace(/O/g, '0').replace(/U/g, 'V');

  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

export type LuzLicense = {
  id: string; key: string; product: string; owner: string; email: string;
  order_ref: string | null; seats_allowed: number;
  expires_at: string | null; revoked_at: string | null;
};

export async function findLicense(rawKey: unknown): Promise<LuzLicense | null> {
  const key = normaliseLicenseKey(rawKey);
  if (!key) return null;
  const rows = (await sql`SELECT * FROM luz_licenses WHERE key = ${key} LIMIT 1`) as LuzLicense[];
  return rows[0] ?? null;
}

export async function seatCount(licenseId: string): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM luz_license_seats WHERE license_id = ${licenseId}
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

export const asMillis = (ts: string | null) => (ts ? new Date(ts).getTime() : 0);

/** Idempotent by order reference: Stripe retries, customers get one key. */
export async function issueLicenseForOrder(opts: {
  email: string; owner?: string; orderRef: string; seats?: number | string; product?: string;
}) {
  const existing = (await sql`
    SELECT * FROM luz_licenses WHERE order_ref = ${opts.orderRef} LIMIT 1
  `) as LuzLicense[];
  if (existing.length > 0) return { license: existing[0], created: false };

  const key = generateLicenseKey();
  const seats = Number(opts.seats ?? process.env.LUZ_DEFAULT_SEATS ?? 3);
  const rows = (await sql`
    INSERT INTO luz_licenses (key, product, owner, email, order_ref, seats_allowed)
    VALUES (${key}, ${opts.product ?? 'luz'}, ${opts.owner ?? ''},
            ${opts.email.toLowerCase()}, ${opts.orderRef}, ${seats})
    RETURNING *
  `) as LuzLicense[];
  return { license: rows[0], created: true };
}
