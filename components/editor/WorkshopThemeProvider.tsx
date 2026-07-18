'use client'

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import {
  type WorkshopTheme, defaultTheme, sanitizeTheme, themeCssVars, patternCss, resolveColor,
} from '@/lib/workshop-theme'

const LS_KEY = '100lights-workshop-theme'

interface WorkshopThemeCtx {
  theme: WorkshopTheme
  setTheme: (t: WorkshopTheme) => void
  update: (patch: Partial<WorkshopTheme>) => void
  reset: () => void
  isSignedIn: boolean
}

const Ctx = createContext<WorkshopThemeCtx | null>(null)

export function useWorkshopTheme(): WorkshopThemeCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWorkshopTheme must be used within WorkshopThemeProvider')
  return c
}

// Optional variant that returns null outside a provider (for components that may
// render both in and out of the editor, e.g. the track color picker).
export function useWorkshopThemeOptional(): WorkshopThemeCtx | null {
  return useContext(Ctx)
}

function readLocal(): WorkshopTheme {
  if (typeof window === 'undefined') return defaultTheme()
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return sanitizeTheme(JSON.parse(raw))
  } catch { /* ignore */ }
  return defaultTheme()
}

export function WorkshopThemeProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useUser()
  // Lazy init from localStorage — instant, no flash. The value is only consumed
  // by the apply effect (never rendered to the DOM), so there's no SSR mismatch.
  const [theme, setThemeState] = useState<WorkshopTheme>(readLocal)
  const styleRef = useRef<HTMLStyleElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When signed in, reconcile with the account copy (async — no sync setState).
  useEffect(() => {
    if (!isSignedIn) return
    let cancelled = false
    const local = readLocal()
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        if (data?.theme) {
          setThemeState(sanitizeTheme(data.theme))
        } else if (JSON.stringify(local) !== JSON.stringify(defaultTheme())) {
          // Account has no theme yet — migrate the guest's local one up.
          fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: local }),
          }).catch(() => {})
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isSignedIn])

  // Apply: one managed <style> targeting the editor root. CSS vars cascade to
  // all children; the pattern is exposed as vars the editor root paints.
  useEffect(() => {
    let el = styleRef.current
    // Re-append when detached too — StrictMode's mount/unmount/mount cycle runs
    // the cleanup (which removes the node) but keeps the ref, so a plain
    // null-check would leave the style orphaned out of the DOM.
    if (!el || !el.isConnected) {
      el = el ?? document.createElement('style')
      el.id = 'workshop-theme'
      document.head.appendChild(el)
      styleRef.current = el
    }
    const vars = themeCssVars(theme)
    const pat = patternCss(theme.pattern, resolveColor(theme, 'border'))
    const decls = Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('')
    const patDecls = pat
      ? `--workshop-pattern:${pat.backgroundImage};--workshop-pattern-size:${pat.backgroundSize};`
      : `--workshop-pattern:none;--workshop-pattern-size:auto;`
    el.textContent = `[data-editor="true"]{${decls}${patDecls}}`
  }, [theme])

  useEffect(() => () => { styleRef.current?.remove() }, [])

  // Persist: localStorage now, account debounced.
  const persist = useCallback((t: WorkshopTheme) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(t)) } catch { /* ignore */ }
    if (!isSignedIn) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: t }),
      }).catch(() => {})
    }, 600)
  }, [isSignedIn])

  const setTheme = useCallback((t: WorkshopTheme) => {
    const clean = sanitizeTheme(t)
    setThemeState(clean)
    persist(clean)
  }, [persist])

  const update = useCallback((patch: Partial<WorkshopTheme>) => {
    setThemeState(prev => {
      const next = sanitizeTheme({ ...prev, ...patch })
      persist(next)
      return next
    })
  }, [persist])

  const reset = useCallback(() => setTheme(defaultTheme()), [setTheme])

  // A theme applied from the community (outside this provider) re-themes live.
  useEffect(() => {
    const onImport = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) setTheme(detail)
    }
    window.addEventListener('workshop-theme-import', onImport)
    return () => window.removeEventListener('workshop-theme-import', onImport)
  }, [setTheme])

  return (
    <Ctx.Provider value={{ theme, setTheme, update, reset, isSignedIn: !!isSignedIn }}>
      {children}
    </Ctx.Provider>
  )
}
