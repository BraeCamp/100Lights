import type { Metadata } from 'next'
// The Assistant is a second-screen helper window — no public content to index.
export const metadata: Metadata = { title: 'Assistant', robots: { index: false, follow: false } }
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</> }
