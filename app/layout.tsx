import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { Geist, Geist_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import { PostHogProvider } from "@/components/PostHogProvider"
import LightMount from "@/components/LightMount"
import DesktopMenu from "@/components/DesktopMenu"
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar"
import ReferralCapture from "@/components/ReferralCapture"
import AnnouncementBanner from "@/components/AnnouncementBanner"
import CommandK from "@/components/site/CommandK"
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
    // No `url` here: a root-level og:url is inherited by every page that does
    // not set its own, and then every shared link claims to be the homepage.
    // Pages set their own (they all do); the home page sets this one.
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
        <head>
          {/*
            ⚠️ THE CACHE RESET RUNS BEFORE THE APP DOES, and that placement is
            the whole point.

            Doing it from a React effect meant the bundle had already started
            loading, so the reload aborted a dozen chunk requests mid-flight —
            twelve net::ERR_ABORTED on a fast connection, and a half-loaded app
            on a slow one. Brae: "It still will load in safari and won't load in
            Brave." Here it decides before a single chunk is asked for.

            Deliberately tiny, dependency-free and synchronous-looking: it must
            not itself be a reason the page fails to start. Everything is
            wrapped, because the failure mode of a reset that throws is an app
            that never opens — which is worse than anything it was clearing.

            Caches and the service worker only. IndexedDB — the sound library,
            offline projects — is never touched.
          */}
          <script
            id="cache-reset"
            dangerouslySetInnerHTML={{ __html: `(function(){try{
var K='100l.cache.purge',V='${'2026-09-02-stale-apollo-worklet'}';
var done;try{done=localStorage.getItem(K)}catch(e){return}
if(done===V)return;
try{localStorage.setItem(K,V);if(localStorage.getItem(K)!==V)return}catch(e){return}
var jobs=[];
try{if(window.caches&&caches.keys)jobs.push(caches.keys().then(function(k){
  return Promise.all(k.map(function(n){return caches.delete(n)}))}))}catch(e){}
try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations)
  jobs.push(navigator.serviceWorker.getRegistrations().then(function(r){
    return Promise.all(r.map(function(x){return x.unregister()}))}))}catch(e){}
Promise.all(jobs).catch(function(){}).then(function(){location.replace(location.href)});
}catch(e){}})();` }}
          />
        </head>
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
          </HideOnEmbed>
          {children}
          <HideOnEmbed>
            <AnnouncementBanner />
            {/* ⌘K quick switcher — renders nothing until opened */}
            <CommandK />
            {/* ⚠️ LIGHT LIVES AT THE ROOT, not in the app layout.
                Brae: "it still dies when the page changes."

                It was mounted in (app), which covers the studio, projects and
                the dashboard — but community, apps, learn and store are all
                OUTSIDE that group, and Light's own navigation offers three of
                them as destinations. So obeying "go to the community" ended
                Light: it walked itself off the edge of its own layout, and
                every question it had open went with it.

                Here it is a sibling of every page there is, so no navigation
                can unmount it. LightMount decides where it should be seen; the
                point of this position is only that it never stops existing.
                Inside HideOnEmbed so an embedded iframe stays bare. */}
            <LightMount />
            <DesktopMenu />
          </HideOnEmbed>
        </body>
      </html>
    </ClerkProvider>
  )
}
