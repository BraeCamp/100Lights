'use client'

// Read-only inventory of the standalone Mini-Apps (/apps/<slug>). Source of
// truth is lib/apps-registry.ts — add an app there and it shows up here.

import { MINI_APPS } from '@/lib/apps-registry'

export default function AppsPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{MINI_APPS.length} mini-app{MINI_APPS.length === 1 ? '' : 's'}</span>
      </div>

      <div className="rounded-xl border" style={{ borderColor: 'var(--border)', overflowX: 'auto' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
              {['App', 'Status', 'Route', ''].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MINI_APPS.map((a, i) => {
              const live = (a.status ?? 'live') === 'live'
              return (
                <tr key={a.slug} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                  <td className="px-3 py-2.5" style={{ maxWidth: 380 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 12.5 }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{a.tagline}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{a.description}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span style={{
                      fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
                      padding: '2px 8px', borderRadius: 99,
                      background: live ? 'rgba(52,211,153,0.15)' : 'rgba(245,158,11,0.15)',
                      color: live ? '#34d399' : '#f59e0b',
                    }}>{a.status ?? 'live'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{a.href}</span>
                  </td>
                  <td className="px-3 py-2.5" style={{ whiteSpace: 'nowrap' }}>
                    <a href={a.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-light)' }}>Open ↗</a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Read-only inventory. Add or edit apps in <span style={{ fontFamily: 'monospace' }}>lib/apps-registry.ts</span> — a public launcher and the Sound Targets’ per-app keys read the same list.
      </p>
    </div>
  )
}
