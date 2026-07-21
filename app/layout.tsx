import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { Geist, Geist_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import { PostHogProvider } from "@/components/PostHogProvider"
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar"
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
  robots: { index: true, follow: true },
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
          <ServiceWorkerRegistrar />
          {/* Analytics is a leaf, not a wrapper: it reads searchParams, which
              opts its subtree out of static HTML. Keeping `children` outside
              this boundary is what lets pages prerender their real markup. */}
          <Suspense>
            <PostHogProvider />
          </Suspense>
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
