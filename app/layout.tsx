import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { Geist, Geist_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import { PostHogProvider } from "@/components/PostHogProvider"
import ZoomBlock from "@/components/ZoomBlock"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  metadataBase: new URL('https://100lights.com'),
  title: { template: '%s | 100Lights', default: '100Lights — AI Content Repurposing' },
  description: "Turn hours of video, audio, and recordings into articles, blog posts, and show notes in minutes.",
  openGraph: {
    type: 'website',
    siteName: '100Lights',
    title: '100Lights — AI Content Repurposing',
    description: 'Turn hours of video, audio, and recordings into articles, blog posts, and show notes in minutes.',
    url: 'https://100lights.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: '100Lights — AI Content Repurposing',
    description: 'Turn hours of video, audio, and recordings into articles, blog posts, and show notes in minutes.',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
          <ZoomBlock />
          <Suspense>
            <PostHogProvider>{children}</PostHogProvider>
          </Suspense>
        </body>
      </html>
    </ClerkProvider>
  )
}
