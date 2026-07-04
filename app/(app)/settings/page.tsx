'use client'

import { useState, useEffect, useRef } from 'react'
import { Settings, Zap, CheckCircle2, ArrowRight, AlertCircle, RefreshCw, LogIn, Check, X } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'
import posthog from 'posthog-js'

interface BillingInfo {
  plan: 'free' | 'pro'
  status: string
  currentPeriodEnd: string | null
}

export default function SettingsPage() {
  const { isSignedIn, isLoaded, user } = useUser()
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [billingError, setBillingError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [upgradeError, setUpgradeError] = useState('')

  // Profile state
  const [username, setUsername]       = useState('')
  const [firstName, setFirstName]     = useState('')
  const [lastName, setLastName]       = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileStatus, setProfileStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [profileError, setProfileError]   = useState('')
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync from Clerk once loaded
  useEffect(() => {
    if (user) {
      setUsername(user.username ?? '')
      setFirstName(user.firstName ?? '')
      setLastName(user.lastName ?? '')
    }
  }, [user])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return

    const trimmed = username.trim()
    if (trimmed && !/^[a-zA-Z0-9_]{1,30}$/.test(trimmed)) {
      setProfileError('Username can only contain letters, numbers, and underscores (max 30 characters).')
      setProfileStatus('error')
      return
    }

    setProfileSaving(true)
    setProfileStatus('idle')
    setProfileError('')

    try {
      await user.update({
        username: trimmed || undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      })
      setProfileStatus('saved')
      if (statusTimer.current) clearTimeout(statusTimer.current)
      statusTimer.current = setTimeout(() => setProfileStatus('idle'), 3000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('username')) {
        setProfileError('That username is already taken or usernames are not enabled in settings.')
      } else {
        setProfileError('Failed to save profile. Please try again.')
      }
      setProfileStatus('error')
    } finally {
      setProfileSaving(false)
    }
  }

  const profileDirty =
    (username  !== (user?.username  ?? '')) ||
    (firstName !== (user?.firstName ?? '')) ||
    (lastName  !== (user?.lastName  ?? ''))

  function loadBilling() {
    setBillingError(false)
    fetch('/api/billing/info')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => setBilling(data))
      .catch(() => setBillingError(true))
  }

  useEffect(() => { if (isLoaded && isSignedIn) loadBilling() }, [isLoaded, isSignedIn])

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
    <main className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-xl">
        <div className="mb-10">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Account and billing preferences</p>
        </div>

        {/* Profile */}
        {isSignedIn && (
          <div className="mb-10">
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Profile</h2>
            <form
              onSubmit={handleSaveProfile}
              className="p-5 rounded-xl border"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              {/* Username */}
              <div className="mb-4">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Username
                </label>
                <div className="flex items-center gap-0" style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-surface)' }}>
                  <span className="px-3 py-2 text-sm select-none" style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--border)', background: 'var(--bg-base)', flexShrink: 0 }}>
                    @
                  </span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="yourhandle"
                    maxLength={30}
                    autoComplete="username"
                    style={{
                      flex: 1,
                      padding: '7px 12px',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontSize: 14,
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Letters, numbers, and underscores only. Used for your public project URLs.
                </p>
              </div>

              {/* First + Last name */}
              <div className="flex gap-3 mb-5">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    First name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="First"
                    maxLength={64}
                    autoComplete="given-name"
                    style={{
                      width: '100%',
                      padding: '7px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      outline: 'none',
                      fontSize: 14,
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Last name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="Last"
                    maxLength={64}
                    autoComplete="family-name"
                    style={{
                      width: '100%',
                      padding: '7px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      outline: 'none',
                      fontSize: 14,
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between gap-3">
                {profileStatus === 'saved' && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--success)' }}>
                    <Check size={12} /> Saved
                  </span>
                )}
                {profileStatus === 'error' && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--error)' }}>
                    <X size={12} /> {profileError}
                  </span>
                )}
                {profileStatus === 'idle' && <span />}
                <button
                  type="submit"
                  disabled={profileSaving || !profileDirty}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    background: profileDirty ? 'var(--accent)' : 'var(--border)',
                    color: profileDirty ? '#fff' : 'var(--text-muted)',
                    opacity: profileSaving ? 0.6 : 1,
                    cursor: profileDirty && !profileSaving ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}
                >
                  {profileSaving ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Plan status */}
        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Plan</h2>
          {!isSignedIn ? (
            <div className="flex flex-col items-center gap-3 py-10 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <LogIn size={18} color="var(--text-muted)" />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Sign in to manage billing</p>
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>Create an account to sync your projects and unlock Pro features.</p>
              <Link href="/sign-in" className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
                <LogIn size={12} /> Sign in
              </Link>
            </div>
          ) : billingError ? (
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
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>20 GB</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Storage</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>Free plan</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>500 MB storage</p>
                </div>
              </div>
              <div
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(59,130,246,0.08))', border: '1px solid rgba(139,92,246,0.25)' }}
              >
                <div>
                  <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>Upgrade to Pro — $19/month</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>20 GB storage</p>
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
    </main>
  )
}
