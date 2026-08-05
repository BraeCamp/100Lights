import type { Metadata } from 'next'

// Private prototype sandbox — never indexed, no sidebar chrome.
export const metadata: Metadata = {
  title: 'Sound Lab · Test',
  robots: { index: false, follow: false },
}

export default function TestLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100dvh', background: 'var(--bg-base, #0a0a0f)', color: 'var(--text-primary, #f1f0ff)' }}>{children}</div>
}
