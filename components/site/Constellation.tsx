// The Constellation — the launcher grid of everything you can open: studios
// (modules), apps, tools, and games. Server component, registry-driven, fully
// static; used on the home page and reusable anywhere a launcher fits.

import Link from 'next/link'
import { MODULES, APPS, TOOLS, GAMES, type LightEntry } from '@/lib/lights-registry'

function Card({ e, big }: { e: LightEntry; big?: boolean }) {
  return (
    <Link
      href={e.href}
      className="group"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: big ? '22px 20px 24px' : '16px 16px 18px', borderRadius: 14,
        border: `1px solid color-mix(in srgb, ${e.color} 22%, var(--border))`,
        background: `linear-gradient(145deg, color-mix(in srgb, ${e.color} 7%, var(--bg-card)) 0%, var(--bg-card) 60%)`,
        textDecoration: 'none', transition: 'transform 120ms, border-color 120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            width: big ? 40 : 32, height: big ? 40 : 32, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: big ? 20 : 16,
            background: `color-mix(in srgb, ${e.color} 16%, transparent)`,
            border: `1px solid color-mix(in srgb, ${e.color} 30%, transparent)`,
          }}
        >{e.icon}</span>
        <span style={{ fontSize: big ? 17 : 14.5, fontWeight: 750, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          {e.name}
        </span>
        {e.status === 'beta' && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: e.color, border: `1px solid color-mix(in srgb, ${e.color} 40%, transparent)`, borderRadius: 999, padding: '2px 7px' }}>
            Beta
          </span>
        )}
      </div>
      <p style={{ fontSize: big ? 13 : 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        {e.tagline}
      </p>
    </Link>
  )
}

export default function Constellation({ compact }: { compact?: boolean }) {
  const modules = MODULES.filter(m => m.status !== 'hidden')
  const apps = APPS.filter(a => a.status !== 'hidden')

  return (
    <div>
      {/* Studios */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 14 }}>
        {modules.map(m => <Card key={m.slug} e={m} big />)}
      </div>
      {/* Apps */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
        {apps.map(a => <Card key={a.slug} e={a} />)}
      </div>
      {!compact && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {[...TOOLS, ...GAMES].map(t => (
            <Link
              key={t.slug}
              href={t.href}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px',
                borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-card)',
                fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 12 }}>{t.icon}</span>
              {t.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
