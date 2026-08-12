import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  async redirects() {
    // Lightning Bug was renamed from "Music Video" (/apps/musicvideo → /apps/lightningbug).
    // Permanent redirects so old links, shared scenes, and SEO carry over (query strings are
    // preserved automatically).
    return [
      { source: '/apps/musicvideo', destination: '/apps/lightningbug', permanent: true },
      { source: '/apps/musicvideo/:path*', destination: '/apps/lightningbug/:path*', permanent: true },
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
