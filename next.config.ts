import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import { LEGACY_REDIRECTS } from './lib/lights-registry'

const nextConfig: NextConfig = {
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
