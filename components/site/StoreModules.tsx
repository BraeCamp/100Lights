'use client'
// Studio (module) licenses in the web store — the same one-time purchases the
// desktop launcher sells, finally surfaced on the web. Owning Pro bundles every
// studio; otherwise each is a one-time license via Stripe checkout.

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Check, Loader2 } from 'lucide-react'
import { MODULES, moduleEntry } from '@/lib/lights-registry'
import type { ModuleKey } from '@/lib/editor-types'

const PRICES: Partial<Record<ModuleKey, string>> = { video: '$79', image: '$39' }

interface LicenseInfo { owned: boolean; licenseType: string | null }

export default function StoreModules() {
  const { isSignedIn } = useUser()
  const [licenses, setLicenses] = useState<Record<string, LicenseInfo> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSignedIn) return
    fetch('/api/modules/licenses')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setLicenses(d?.licenses ?? null))
      .catch(() => {})
  }, [isSignedIn])

  const buy = async (moduleKey: ModuleKey) => {
    if (!isSignedIn) { window.location.assign('/sign-in'); return }
    setBusy(moduleKey)
    setError(null)
    try {
      const res = await fetch('/api/modules/purchase', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleKey }),
      })
      const d = await res.json()
      if (!res.ok || !d.url) throw new Error(d.error ?? 'Checkout unavailable right now')
      window.location.assign(d.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout unavailable right now')
      setBusy(null)
    }
  }

  // Only launched, non-free modules are sold à la carte (audio is free forever)
  const sellable = MODULES.filter(m => m.status !== 'hidden' && m.moduleKey !== 'audio')

  return (
    <div>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {/* Beacon — free forever, shown so the story is honest */}
        <div style={{ padding: '20px 20px 22px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>{moduleEntry('audio').icon}</span>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{moduleEntry('audio').name}</h3>
            <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: 'var(--success)' }}>Free</span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>{moduleEntry('audio').tagline}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <Check size={13} color="var(--success)" /> Included for everyone, forever
          </div>
        </div>

        {sellable.map(m => {
          const lic = licenses?.[m.moduleKey!]
          const owned = lic?.owned
          return (
            <div key={m.slug} style={{
              padding: '20px 20px 22px', borderRadius: 14,
              border: `1px solid color-mix(in srgb, ${m.color} 30%, var(--border))`,
              background: `linear-gradient(145deg, color-mix(in srgb, ${m.color} 7%, var(--bg-card)) 0%, var(--bg-card) 60%)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span aria-hidden="true" style={{ fontSize: 20 }}>{m.icon}</span>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{m.name}</h3>
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: m.color }}>
                  {PRICES[m.moduleKey!] ?? ''} <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)' }}>once</span>
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.5 }}>{m.tagline}</p>
              {owned ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--success)' }}>
                  <Check size={14} /> You own this{lic?.licenseType === 'bundle' ? ' (included with Pro)' : ''}
                </div>
              ) : (
                <button
                  onClick={() => { void buy(m.moduleKey!) }}
                  disabled={busy !== null}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9,
                    background: m.color, color: '#fff', fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer',
                    opacity: busy && busy !== m.moduleKey ? 0.6 : 1,
                  }}
                >
                  {busy === m.moduleKey ? <Loader2 size={13} className="animate-spin" /> : null}
                  {busy === m.moduleKey ? 'Starting checkout…' : `Buy ${m.name}`}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {error && <p style={{ fontSize: 12, color: '#f87171', marginTop: 10 }}>{error}</p>}
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 12 }}>
        One-time licenses are yours for good. A Pro membership includes every studio while it&apos;s active.
      </p>
    </div>
  )
}
