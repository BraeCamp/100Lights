'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import { Zap, X, Check } from 'lucide-react'
import posthog from 'posthog-js'

type BillingPeriod = 'monthly' | 'annual'

interface UpgradeModalContextValue {
  showUpgrade: (reason?: string) => void
}

const UpgradeModalContext = createContext<UpgradeModalContextValue>({ showUpgrade: () => {} })

export function useUpgradeModal() {
  return useContext(UpgradeModalContext)
}

export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('')
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  const [loading, setLoading] = useState(false)

  const showUpgrade = useCallback((r = '') => {
    setReason(r)
    setOpen(true)
  }, [])

  async function handleUpgrade() {
    setLoading(true)
    posthog.capture('upgrade_clicked', { source: 'modal', reason, billing_period: period })
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: period }),
      })
      const { url } = await res.json() as { url: string }
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  const monthlyPrice = 19
  const annualTotal = 190
  const annualPerMonth = (annualTotal / 12).toFixed(2)
  const annualSavings = monthlyPrice * 12 - annualTotal

  return (
    <UpgradeModalContext.Provider value={{ showUpgrade }}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl p-8"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-lg"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={16} />
            </button>

            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
              style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.3)' }}>
              <Zap size={22} color="var(--accent-light)" />
            </div>

            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              You've reached your limit
            </h2>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              {reason || 'Upgrade to Pro for more storage and priority support.'}
            </p>

            {/* Billing toggle */}
            <div className="flex items-center gap-1 p-1 rounded-xl mb-5 w-fit" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              {(['monthly', 'annual'] as BillingPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="relative px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                  style={{
                    background: period === p ? 'var(--accent)' : 'transparent',
                    color: period === p ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {p === 'monthly' ? 'Monthly' : 'Annual'}
                  {p === 'annual' && (
                    <span className="ml-1.5 text-xs" style={{ color: period === 'annual' ? 'rgba(255,255,255,0.8)' : 'var(--success)' }}>
                      Save ${annualSavings}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-end gap-1 mb-1">
                <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {period === 'annual' ? `$${annualPerMonth}` : `$${monthlyPrice}`}
                </span>
                <span className="text-sm mb-0.5" style={{ color: 'var(--text-muted)' }}>/month</span>
                {period === 'annual' && (
                  <span className="text-xs mb-0.5 ml-1" style={{ color: 'var(--text-muted)' }}>
                    (${annualTotal}/year)
                  </span>
                )}
              </div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Pro plan
              </div>
              {[
                '20 GB media storage',
                'Priority processing',
                'Unlimited projects',
              ].map(f => (
                <div key={f} className="flex items-center gap-2.5 mb-2">
                  <Check size={13} color="var(--success)" />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{f}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--accent)', color: '#fff', opacity: loading ? 0.7 : 1 }}
            >
              <Zap size={15} />
              {loading ? 'Redirecting…' : `Upgrade to Pro — ${period === 'annual' ? `$${annualTotal}/year` : `$${monthlyPrice}/mo`}`}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="w-full text-center text-sm mt-3"
              style={{ color: 'var(--text-muted)' }}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
    </UpgradeModalContext.Provider>
  )
}
