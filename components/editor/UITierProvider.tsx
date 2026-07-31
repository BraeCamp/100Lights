'use client'

// Studio UI complexity tiers — provider, persistence, and the first-run prompt.
// Mounted just inside WorkshopThemeProvider so every studio control can read
// useUITier(). Gating itself is done by an injected stylesheet (see
// lib/ui-tiers.ts) keyed off the `data-ui-tier` attribute on the wrapper here —
// switching tiers is instant and unmounts nothing.

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'
import {
  type UITier, UI_TIERS, TIER_INFO, tierAtLeast, isUITier, tierVisibilityCss,
} from '@/lib/ui-tiers'

const LS_KEY = '100lights-ui-tier'

interface UITierCtx {
  tier: UITier
  setTier: (t: UITier) => void
  /** Has the user explicitly chosen a tier (vs. the default)? */
  chosen: boolean
  /** Is the current tier at least `t`? For conditional logic CSS can't express. */
  atLeast: (t: UITier) => boolean
}

const Ctx = createContext<UITierCtx | null>(null)

export function useUITier(): UITierCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUITier must be used within UITierProvider')
  return c
}

/** Returns null outside a provider (for controls that also render elsewhere). */
export function useUITierOptional(): UITierCtx | null {
  return useContext(Ctx)
}

function readLocal(): UITier | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(LS_KEY)
    return isUITier(v) ? v : null
  } catch { return null }
}

export function UITierProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useUser()
  const initial = readLocal()
  const [tier, setTierState] = useState<UITier>(initial ?? 'intermediate')
  const [chosen, setChosen] = useState<boolean>(initial !== null)
  // ready = we know enough to decide whether to show the first-run prompt
  // (after Clerk load + any account reconcile). Prevents a modal flash for
  // users who already chose on another device.
  const [ready, setReady] = useState(false)
  const styleRef = useRef<HTMLStyleElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inject the tier→visibility stylesheet once (static content).
  useEffect(() => {
    let el = styleRef.current
    if (!el || !el.isConnected) {
      el = el ?? document.createElement('style')
      el.id = 'ui-tiers'
      el.textContent = tierVisibilityCss()
      document.head.appendChild(el)
      styleRef.current = el
    }
  }, [])
  useEffect(() => () => { styleRef.current?.remove() }, [])

  // Reconcile with the account copy when signed in; decide `ready`.
  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) { setReady(true); return }
    let cancelled = false
    const local = readLocal()
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        if (isUITier(data?.uiTier)) {
          setTierState(data.uiTier)
          setChosen(true)
          try { localStorage.setItem(LS_KEY, data.uiTier) } catch { /* ignore */ }
        } else if (local) {
          // Account has none yet — migrate the guest's local choice up.
          fetch('/api/settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uiTier: local }),
          }).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [isLoaded, isSignedIn])

  const persist = useCallback((t: UITier) => {
    try { localStorage.setItem(LS_KEY, t) } catch { /* ignore */ }
    if (!isSignedIn) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiTier: t }),
      }).catch(() => {})
    }, 500)
  }, [isSignedIn])

  const setTier = useCallback((t: UITier) => {
    setTierState(t)
    setChosen(true)
    persist(t)
  }, [persist])

  const atLeast = useCallback((t: UITier) => tierAtLeast(tier, t), [tier])

  return (
    <Ctx.Provider value={{ tier, setTier, chosen, atLeast }}>
      <div data-ui-tier={tier} style={{ display: 'contents' }}>{children}</div>
      {ready && !chosen && (
        <UITierFirstRun onChoose={(t) => {
          setTier(t)
          // Point the user at the switcher so they know they can change this later.
          // Delay a beat so the modal is gone and the button is on screen.
          setTimeout(() => window.dispatchEvent(new CustomEvent('100lights-tier-first-chosen')), 80)
        }} />
      )}
    </Ctx.Provider>
  )
}

// ── First-run experience prompt ───────────────────────────────────────────────
// Shown once, when a user opens a project without having chosen a tier. Explains
// what each level means for the UI. Rendered with data-editor so the workshop
// theme's CSS vars apply even though it's portaled to <body>.

function UITierFirstRun({ onChoose }: { onChoose: (t: UITier) => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      data-editor="true"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your studio setup"
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 720, background: 'var(--bg-surface, #14121a)',
        border: '1px solid var(--border, #2a2730)', borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
      }}>
        <div style={{ padding: '22px 24px 12px', textAlign: 'center' }}>
          <div style={{
            width: 44, height: 44, margin: '0 auto 12px', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent-subtle, rgba(139,92,246,0.15))', border: '1px solid rgba(139,92,246,0.3)',
          }}>
            <Sparkles size={22} color="var(--accent-light, #a78bfa)" />
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary, #f4f2f7)', margin: '0 0 6px' }}>
            How much studio do you want?
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary, #b4b0bd)', margin: 0, lineHeight: 1.5 }}>
            Pick the setup that fits you. It changes how many controls you see — you can switch any time from the toolbar.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, padding: '14px 24px 24px' }}>
          {UI_TIERS.map((id, i) => {
            const t = TIER_INFO[id]
            return (
              <button
                key={id}
                onClick={() => onChoose(id)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left',
                  padding: '16px 16px 18px', borderRadius: 12, cursor: 'pointer',
                  background: 'var(--bg-card, #1b1922)', border: '1px solid var(--border, #2a2730)',
                  transition: 'border-color 0.15s, transform 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent, #8b5cf6)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border, #2a2730)'; e.currentTarget.style.transform = 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, color: 'var(--accent-light, #a78bfa)',
                    background: 'var(--accent-subtle, rgba(139,92,246,0.15))', borderRadius: 6, padding: '2px 7px',
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary, #f4f2f7)' }}>{t.name}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #b4b0bd)' }}>{t.tagline}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted, #85808f)', lineHeight: 1.5 }}>{t.description}</span>
                <span style={{ marginTop: 4, fontSize: 10.5, color: 'var(--accent-light, #a78bfa)', fontWeight: 600, lineHeight: 1.4 }}>{t.shows}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
