'use client'

/**
 * Applies the user's Workshop theme (colors + pattern) inside a standalone
 * window — the pop-out Assistant and Build-history controls run in their own
 * documents, outside the editor's WorkshopThemeProvider, so they wouldn't
 * otherwise inherit the customization. Reads the saved theme from localStorage
 * (same origin as the studio) and live-syncs when it changes in another window.
 */

import { useEffect } from 'react'
import {
  type WorkshopTheme, defaultTheme, sanitizeTheme, themeCssVars, patternCss, resolveColor,
} from '@/lib/workshop-theme'

const LS_KEY = '100lights-workshop-theme'
const STYLE_ID = 'workshop-theme-standalone'

function readTheme(): WorkshopTheme {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return sanitizeTheme(JSON.parse(raw))
  } catch { /* ignore */ }
  return defaultTheme()
}

function applyTheme() {
  const theme = readTheme()
  const vars = themeCssVars(theme)
  const pat = patternCss(theme.pattern, resolveColor(theme, 'border'))
  const decls = Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('')
  const patDecls = pat
    ? `--workshop-pattern:${pat.backgroundImage};--workshop-pattern-size:${pat.backgroundSize};`
    : `--workshop-pattern:none;--workshop-pattern-size:auto;`
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el) }
  el.textContent = `[data-editor="true"]{${decls}${patDecls}}`
}

// Apply the saved theme to this standalone document + keep it in sync across
// windows. Wrap your root in an element with data-editor="true" so the vars land.
export function useApplyWorkshopTheme() {
  useEffect(() => {
    applyTheme()
    const onStorage = (e: StorageEvent) => { if (e.key === LS_KEY) applyTheme() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}

export default function StandaloneThemedShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  useApplyWorkshopTheme()
  return (
    <div data-editor="true" style={{ backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)', ...style }}>
      {children}
    </div>
  )
}
