/**
 * Who is an admin, as a plain constant with no imports.
 *
 * Split out of lib/admin-auth.ts so the CLIENT can ask the same question. That
 * module reaches for `@clerk/nextjs/server` and `next/headers`, so importing it
 * from a component would drag server-only code into the browser bundle — and
 * copying the address into a second file would be the kind of duplication that
 * quietly disagrees with itself later.
 */
export const ADMIN_EMAIL = 'braedancampbell@gmail.com'

/** Case-insensitive, because an email address is. */
export function isAdminAddress(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL
}
