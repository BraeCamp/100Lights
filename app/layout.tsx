import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { Geist, Geist_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import { PostHogProvider } from "@/components/PostHogProvider"
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar"
import ReferralCapture from "@/components/ReferralCapture"
import AgeGate from "@/components/AgeGate"
import AnnouncementBanner from "@/components/AnnouncementBanner"
import { HideOnEmbed } from "@/components/HideOnEmbed"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  metadataBase: new URL('https://100lights.com'),
  title: { template: '%s | 100Lights', default: '100Lights — The Music Studio in Your Browser' },
  description: 'A full digital audio workstation built for the browser — Session View, piano roll, drum rack, mixer, and a community of shared sounds and chord recipes.',
  openGraph: {
    type: 'website',
    siteName: '100Lights',
    title: '100Lights — The Music Studio in Your Browser',
    description: 'A full DAW built for the browser, with a community of shared sounds and chord recipes. No downloads, no plugins.',
    url: 'https://100lights.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: '100Lights — The Music Studio in Your Browser',
    description: 'A full DAW built for the browser, with a community of shared sounds and chord recipes.',
  },
  // ── AI / LLM opt-out (applies to every page via this root layout) ──────────
  // Our content must NOT be used to train large language models or other AI. We
  // keep normal search indexing (index, follow) but add the recognized "no AI"
  // signals: `noai`/`noimageai` (the meta-tag convention) and `tdm-reservation:1`
  // (the W3C Text & Data Mining Reservation Protocol). The enforced crawler block
  // is in app/robots.ts. Search engines ignore the unknown tokens, so ranking is
  // unaffected.
  robots: 'index, follow, noai, noimageai',
  other: { 'tdm-reservation': '1' },
  // Search Console / Bing verification via env vars — set the code from each
  // console in Vercel and it verifies without touching DNS. Omitted when unset.
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } } : {}),
  },
}

// Public pages allow pinch-zoom — blocking it hurts accessibility and mobile
// usability. The DAW re-locks zoom in app/(app)/layout.tsx, where editing
// gestures conflict with it.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: '#8b5cf6',
          colorBackground: '#0f0f11',
          colorInputBackground: '#18181b',
          colorText: '#f1f0ff',
          colorTextSecondary: '#c0bedd',
          colorInputText: '#f1f0ff',
          colorNeutral: '#c4c3d8',
          borderRadius: '0.75rem',
          fontFamily: 'var(--font-geist-sans)',
        },
      }}
    >
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
        <body className="h-full">
          <a href="#main" className="skip-link">Skip to main content</a>
          {/* Site chrome + analytics — hidden on /embed so third-party iframes
              stay bare (no banner/age-gate/referral/PostHog/service-worker JS). */}
          <HideOnEmbed>
            <ServiceWorkerRegistrar />
            {/* Analytics is a leaf, not a wrapper: it reads searchParams, which
                opts its subtree out of static HTML. Keeping `children` outside
                this boundary is what lets pages prerender their real markup. */}
            <Suspense>
              <PostHogProvider />
            </Suspense>
            <ReferralCapture />
            <AgeGate />
          </HideOnEmbed>
          {children}
          <HideOnEmbed>
            <AnnouncementBanner />
          </HideOnEmbed>
        </body>
      </html>
    </ClerkProvider>
  )
}
