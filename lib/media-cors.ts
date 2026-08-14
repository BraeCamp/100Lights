/**
 * Whether this origin may load R2 media with crossOrigin="anonymous".
 *
 * The bucket's CORS allowlist covers exactly these origins (verified against
 * the live bucket): on them, CORS-enabled media elements deliver readable
 * frames — scopes, LUTs, frame blending and optical flow work directly on
 * signed URLs with no blob download. Anywhere else (Vercel previews, other
 * dev ports) we must NOT set crossOrigin — a disallowed CORS request fails the
 * media load outright, which is far worse than tainted pixels; those origins
 * fall back to the lazy blob-localize path instead.
 *
 * If the bucket allowlist changes in Cloudflare, mirror it here.
 */
// NB: the dev server runs on :3001 too — keep both localhost ports here AND in the bucket's CORS
// allowlist (Cloudflare dashboard), or direct-to-R2 media reads/uploads fail CORS on :3001 and fall
// back to the (4 MB-capped) proxy.
const R2_CORS_ORIGINS = new Set(['https://100lights.com', 'http://localhost:3000', 'http://localhost:3001'])

export function r2CorsEligible(): boolean {
  return typeof window !== 'undefined' && R2_CORS_ORIGINS.has(window.location.origin)
}
