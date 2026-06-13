'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import { Zap, X, Check } from 'lucide-react'

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

  const showUpgrade = useCallback((r = '') => {
    setReason(r)
    setOpen(true)
  }, [])

  async function handleUpgrade() {
    const res = await fetch('/api/checkout', { method: 'POST' })
    const { url } = await res.json() as { url: string }
    if (url) window.location.href = url
  }

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
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              {reason || 'Upgrade to Pro to keep going — more AI power, more transcriptions, more storage.'}
            </p>

            <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Pro — $19 / month
              </div>
              {[
                '30 transcriptions per month',
                '100 AI generations per month',
                '20 GB media storage',
                'Priority processing',
              ].map(f => (
                <div key={f} className="flex items-center gap-2.5 mb-2">
                  <Check size={13} color="var(--success)" />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{f}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleUpgrade}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Zap size={15} />
              Upgrade to Pro
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
