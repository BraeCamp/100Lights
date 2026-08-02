import type { Metadata } from 'next'
// Share links are private, per-recipient URLs — never index them.
export const metadata: Metadata = { robots: { index: false, follow: false } }
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</> }
