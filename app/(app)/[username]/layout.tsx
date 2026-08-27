import type { Metadata } from 'next'
// /@username/<slug>-<code> is the pretty URL for the EDITOR, the same surface as
// /projects/[id] — which is noindex. It renders client-side, so a crawler only ever
// sees "Loading project…", and the URLs are people's own projects. Keep both out of
// the index for the same reason.
export const metadata: Metadata = { title: 'Project', robots: { index: false, follow: false } }
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</> }
