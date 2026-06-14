'use client'

import { useState, useEffect } from 'react'
import { Settings, Zap, CreditCard, CheckCircle2, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react'
import posthog from 'posthog-js'

interface BillingInfo {
  plan: 'free' | 'pro'
  status: string
  currentPeriodEnd: string | null
}

export default function SettingsPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [billingError, setBillingError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [upgradeError, setUpgradeError] = useState('')

  function loadBilling() {
    setBillingError(false)
    fetch('/api/billing/info')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => setBilling(data))
      .catch(() => setBillingError(true))
  }

  useEffect(() => { loadBilling() }, [])

  async function handleUpgrade() {
    setLoading(true)
    setUpgradeError('')
    posthog.capture('upgrade_clicked', { source: 'settings' })
    try {
      const res = await fetch('/api/checkout', { method: 'POST' })
      const body = await res.json() as { url?: string; error?: string }
      if (!res.ok) {
        setUpgradeError(body.error ?? 'Something went wrong. Please try again.')
        return
      }
      if (body.url) window.location.href = body.url
    } finally {
      setLoading(false)
    }
  }

  async function handleManageBilling() {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const { url } = await res.json() as { url: string }
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  const isPro = billing?.plan === 'pro' && billing.status === 'active'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-xl">
        <div className="mb-10">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Account and billing preferences</p>
        </div>

        {/* Plan status */}
        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Plan</h2>
          {billingError ? (
            <div className="flex flex-col items-center gap-3 py-10 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <AlertCircle size={18} color="var(--text-muted)" />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load billing info</p>
              <button onClick={loadBilling} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : isPro ? (
            <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-subtle)' }}>
                    <CheckCircle2 size={18} color="var(--accent-light)" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>100Lights Pro</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {billing?.currentPeriodEnd
                        ? `Renews ${new Date(billing.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : '$19 / month'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleManageBilling}
                  disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                >
                  Manage billing
                </button>
              </div>
              <div className="mt-4 pt-4 grid grid-cols-3 gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                {[
                  { label: 'Transcriptions', value: '30/mo' },
                  { label: 'AI generations', value: '100/mo' },
                  { label: 'Storage', value: '20 GB' },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>Free plan</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>3 transcriptions · 10 AI generations · 500 MB storage</p>
                </div>
              </div>
              <div
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(59,130,246,0.08))', border: '1px solid rgba(139,92,246,0.25)' }}
              >
                <div>
                  <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>Upgrade to Pro — $19/month</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>30 transcriptions · 100 AI generations · 20 GB storage</p>
                </div>
                <button
                  onClick={handleUpgrade}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold shrink-0 ml-4"
                  style={{ background: 'var(--accent)', color: '#fff', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Loading…' : <><Zap size={13} /> Upgrade <ArrowRight size={13} /></>}
                </button>
              </div>
              {upgradeError && (
                <p className="mt-3 text-xs" style={{ color: 'var(--error)' }}>{upgradeError}</p>
              )}
            </div>
          )}
        </div>

        {/* AI features */}
        <div
          className="flex items-center gap-4 p-5 rounded-xl border mt-4"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-subtle)' }}>
            <Zap size={18} color="var(--accent-light)" />
          </div>
          <div>
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>AI features are ready</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Transcription and AI writing are powered by 100Lights — no API keys needed.
            </p>
          </div>
        </div>

        <div
          className="flex items-start gap-4 p-5 rounded-xl border mt-4"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-surface)' }}>
            <Settings size={18} color="var(--text-muted)" />
          </div>
          <div>
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>More settings coming soon</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Notification preferences, default export quality, and team management will appear here.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
