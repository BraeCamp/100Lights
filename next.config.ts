import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import { LEGACY_REDIRECTS } from './lib/lights-registry'

const nextConfig: NextConfig = {
  // Which build is this? Vercel knows the commit; the browser did not, and
  // that gap cost real time — more than once a bug report and a deploy could
  // not be lined up because there was no way to ask "are you even on the build
  // I just shipped?". Surfaced in the studio's admin menu.
  //
  // Three sources, because the first is not guaranteed: VERCEL_GIT_COMMIT_SHA
  // is only set when the deploy carries git metadata, and a CLI deploy may not.
  // VERCEL_URL is unique per deployment and always present on Vercel, and the
  // build time is computed here so it exists everywhere — so SOMETHING always
  // identifies the build, which is the whole point.
  // ⚠️ public/ is served from the CDN and is NOT part of a serverless function's
  // filesystem. /api/render-clip renders clips with Apollo's real engine, which
  // means reading public/apollo/engine.js at runtime — without this line that
  // read throws ENOENT in production only, and server loading silently goes
  // back to being the thing that gives up. Nothing in dev can catch it, because
  // in dev the whole repo is on disk.
  outputFileTracingIncludes: {
    '/api/render-clip': ['./public/apollo/engine.js'],
  },
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    NEXT_PUBLIC_DEPLOY_ID: process.env.VERCEL_URL ?? 'local',
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async redirects() {
    // Permanent redirects so old links, shared scenes, and SEO carry over
    // (query strings are preserved automatically).
    return [
      // The great un-scattering (2026-08): apps moved from /apps/<slug> to
      // top-level /<slug>, module homes to their light names (/beacon, /prism,
      // /aperture) — all generated from the constellation registry.
      ...LEGACY_REDIRECTS.map(r => ({ ...r, permanent: true })),
      // Studio entry renamed /new → /create.
      { source: '/new', destination: '/create', permanent: true },
      // The /apollo2 UI experiment merged back into /apollo (2026-08-20).
      { source: '/apollo2', destination: '/apollo', permanent: true },
      { source: '/apollo2/:path*', destination: '/apollo/:path*', permanent: true },
      // Lightning Bug's original "Music Video" name (predates the move above,
      // so it points straight at the final home — no redirect chains).
      { source: '/apps/musicvideo', destination: '/lightningbug', permanent: true },
      { source: '/apps/musicvideo/:path*', destination: '/lightningbug/:path*', permanent: true },
    ]
  },
  async headers() {
    return [
      {
        // Required for SharedArrayBuffer (used by FFmpeg.wasm in AudioEditor).
        // `credentialless` COEP allows third-party CDN assets (Clerk, PostHog,
        // Stripe) without requiring them to set CORP headers.
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy',  value: 'credentialless' },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
})
