import Link from 'next/link'
import { Zap, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: 'var(--bg-base)' }}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.25)' }}>
        <Zap size={22} color="var(--accent-light)" />
      </div>
      <p className="text-7xl font-bold mb-3 tabular-nums" style={{ color: 'var(--border-light)' }}>404</p>
      <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Page not found</h1>
      <p className="text-sm mb-8 max-w-xs" style={{ color: 'var(--text-secondary)' }}>
        This page doesn&apos;t exist or may have been moved.
      </p>
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm"
          style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <ArrowLeft size={14} /> Home
        </Link>
      </div>
    </div>
  )
}
