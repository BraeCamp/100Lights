// Workshop theming — user-customizable colors + patterns for the audio editor.
//
// Design goals:
//  - EXTENSIBLE: colors are a keyed token map and the theme carries a version +
//    an open index signature, so new tokens/fields (fonts, radii, advanced
//    palette roles) can be added later without breaking stored/shared themes.
//    Missing keys simply fall back to the base editor theme.
//  - PORTABLE: a theme is plain JSON — safe to persist, sync to an account, and
//    publish to the community. `sanitizeTheme` hardens anything coming from the
//    network or another user before it touches the DOM.

export const THEME_VERSION = 1

// Shared between the provider (reads/writes) and community import (writes).
export const WORKSHOP_THEME_LS_KEY = '100lights-workshop-theme'

// Each color token maps to a CSS custom property under [data-editor="true"].
// Add new roles here (e.g. accentAlt, waveform) — old themes stay valid.
export const THEME_COLOR_TOKENS = {
  bgBase:        '--bg-base',
  bgSurface:     '--bg-surface',
  bgCard:        '--bg-card',
  bgCardHover:   '--bg-card-hover',
  border:        '--border',
  borderLight:   '--border-light',
  textPrimary:   '--text-primary',
  textSecondary: '--text-secondary',
  textMuted:     '--text-muted',
  accent:        '--accent',
} as const

export type ThemeColorKey = keyof typeof THEME_COLOR_TOKENS
export const THEME_COLOR_KEYS = Object.keys(THEME_COLOR_TOKENS) as ThemeColorKey[]

// Human labels for the customization UI.
export const THEME_COLOR_LABELS: Record<ThemeColorKey, string> = {
  bgBase:        'Background',
  bgSurface:     'Surface',
  bgCard:        'Panels',
  bgCardHover:   'Panel hover',
  border:        'Borders',
  borderLight:   'Border (light)',
  textPrimary:   'Text',
  textSecondary: 'Text (secondary)',
  textMuted:     'Text (muted)',
  accent:        'Accent',
}

export type PatternType = 'none' | 'dots' | 'grid' | 'diagonal' | 'cross' | 'noise'

export const PATTERN_TYPES: { type: PatternType; label: string }[] = [
  { type: 'none',     label: 'None' },
  { type: 'dots',     label: 'Dots' },
  { type: 'grid',     label: 'Grid' },
  { type: 'diagonal', label: 'Diagonal' },
  { type: 'cross',    label: 'Cross' },
  { type: 'noise',    label: 'Noise' },
]

export interface ThemePattern {
  type: PatternType
  color?: string      // defaults to the resolved border color
  opacity: number     // 0..1
  scale: number       // cell size in px
  angle?: number      // degrees, for diagonal
}

export interface WorkshopTheme {
  version: number
  id?: string         // set when it came from a saved/community preset
  name?: string
  colors: Partial<Record<ThemeColorKey, string>>
  pattern: ThemePattern
  trackPalette?: string[]
  accentSync: boolean // derive accent hover/light/subtle from the base accent
  // Open for future fields; unknown keys are preserved on round-trip.
  [k: string]: unknown
}

// The base editor palette (mirrors [data-editor="true"] in globals.css). Used as
// the fall-back and the "reset" target so the UI always has something to show.
export const BASE_EDITOR_COLORS: Record<ThemeColorKey, string> = {
  bgBase:        '#141414',
  bgSurface:     '#1c1c1c',
  bgCard:        '#222222',
  bgCardHover:   '#292929',
  border:        '#2c2c2c',
  borderLight:   '#393939',
  textPrimary:   '#e8e8e8',
  textSecondary: '#b0b0b0',
  textMuted:     '#7c7c7c',
  accent:        '#3d8fef',
}

export const DEFAULT_TRACK_PALETTE = [
  '#3b82f6', '#22c55e', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#ef4444',
  '#6366f1', '#84cc16', '#06b6d4', '#f43f5e',
]

export function defaultTheme(): WorkshopTheme {
  return {
    version: THEME_VERSION,
    colors: {},
    pattern: { type: 'none', opacity: 0.5, scale: 22 },
    accentSync: true,
  }
}

// ── Color math ──────────────────────────────────────────────────────────────

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim())
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)))
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

// mix toward white (amt>0) or black (amt<0), amt in -1..1
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex)
  const t = amt < 0 ? 0 : 255
  const p = Math.abs(amt)
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p)
}

export function relativeLuminance(hex: string): number {
  const chan = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// Accent hover/light/subtle derived from a single base accent.
export function deriveAccentVars(accent: string): Record<string, string> {
  return {
    '--accent-hover':  shade(accent, -0.12),
    '--accent-light':  shade(accent, 0.18),
    '--accent-subtle': withAlpha(accent, 0.12),
  }
}

// ── Pattern generation (self-contained SVG data-URIs, theme-color aware) ──────

export function patternCss(
  pattern: ThemePattern,
  fallbackColor: string,
): { backgroundImage: string; backgroundSize: string } | null {
  if (!pattern || pattern.type === 'none') return null
  const color = isHex(pattern.color) ? pattern.color! : fallbackColor
  const s = Math.max(4, Math.min(200, pattern.scale || 22))
  const fill = withAlpha(color, pattern.opacity ?? 0.5)
  const ang = pattern.angle ?? 45

  let svg: string
  switch (pattern.type) {
    case 'dots':
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><circle cx='${s / 2}' cy='${s / 2}' r='${Math.max(0.6, s * 0.06)}' fill='${fill}'/></svg>`
      break
    case 'grid':
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><path d='M ${s} 0 L 0 0 0 ${s}' fill='none' stroke='${fill}' stroke-width='1'/></svg>`
      break
    case 'diagonal':
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><g transform='rotate(${ang} ${s / 2} ${s / 2})'><line x1='${s / 2}' y1='0' x2='${s / 2}' y2='${s}' stroke='${fill}' stroke-width='1'/></g></svg>`
      break
    case 'cross':
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><path d='M${s / 2} ${s * 0.35}V${s * 0.65}M${s * 0.35} ${s / 2}H${s * 0.65}' stroke='${fill}' stroke-width='1'/></svg>`
      break
    case 'noise':
      // fractal turbulence — one tile, cheap and resolution independent
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s * 4}' height='${s * 4}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='${Math.max(0, Math.min(1, pattern.opacity ?? 0.5)) * 0.5}'/></svg>`
      return { backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/%2523/g, '%23')}")`, backgroundSize: `${s * 4}px ${s * 4}px` }
  }
  return { backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, backgroundSize: `${s}px ${s}px` }
}

// ── Applying a theme to the editor root ───────────────────────────────────────

// Returns the CSS custom properties a theme contributes. Callers set these on
// the [data-editor="true"] element (inline styles beat the stylesheet block).
export function themeCssVars(theme: WorkshopTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const key of THEME_COLOR_KEYS) {
    const v = theme.colors?.[key]
    if (isHex(v)) vars[THEME_COLOR_TOKENS[key]] = v!
  }
  if (theme.accentSync && isHex(theme.colors?.accent)) {
    Object.assign(vars, deriveAccentVars(theme.colors!.accent!))
  }
  return vars
}

// Resolve a color token to its effective value (theme override or base).
export function resolveColor(theme: WorkshopTheme, key: ThemeColorKey): string {
  const v = theme.colors?.[key]
  return isHex(v) ? v! : BASE_EDITOR_COLORS[key]
}

export interface ContrastWarning { pair: string; ratio: number }

// Flag low text/background contrast (WCAG AA body text = 4.5:1).
export function contrastWarnings(theme: WorkshopTheme): ContrastWarning[] {
  const bg = resolveColor(theme, 'bgBase')
  const warns: ContrastWarning[] = []
  const check = (key: ThemeColorKey, label: string, min: number) => {
    const ratio = contrastRatio(resolveColor(theme, key), bg)
    if (ratio < min) warns.push({ pair: label, ratio: Math.round(ratio * 100) / 100 })
  }
  check('textPrimary', 'Text on background', 4.5)
  check('textSecondary', 'Secondary text on background', 3)
  check('accent', 'Accent on background', 2)
  return warns
}

// ── Validation / sanitization (network + community input) ─────────────────────

export function sanitizeTheme(input: unknown): WorkshopTheme {
  const t = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const colors: Partial<Record<ThemeColorKey, string>> = {}
  const rawColors = (t.colors && typeof t.colors === 'object' ? t.colors : {}) as Record<string, unknown>
  for (const key of THEME_COLOR_KEYS) {
    if (isHex(rawColors[key])) colors[key] = (rawColors[key] as string).startsWith('#') ? rawColors[key] as string : '#' + rawColors[key]
  }
  const rawPat = (t.pattern && typeof t.pattern === 'object' ? t.pattern : {}) as Record<string, unknown>
  const type = PATTERN_TYPES.some(p => p.type === rawPat.type) ? rawPat.type as PatternType : 'none'
  const pattern: ThemePattern = {
    type,
    color: isHex(rawPat.color) ? rawPat.color as string : undefined,
    opacity: clampNum(rawPat.opacity, 0, 1, 0.5),
    scale: clampNum(rawPat.scale, 4, 200, 22),
    angle: rawPat.angle == null ? undefined : clampNum(rawPat.angle, 0, 180, 45),
  }
  const trackPalette = Array.isArray(t.trackPalette)
    ? (t.trackPalette as unknown[]).filter(isHex).slice(0, 24) as string[]
    : undefined
  return {
    version: THEME_VERSION,
    name: typeof t.name === 'string' ? t.name.slice(0, 60) : undefined,
    colors,
    pattern,
    ...(trackPalette && trackPalette.length ? { trackPalette } : {}),
    accentSync: t.accentSync !== false,
  }
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt
}

// Apply a theme received from outside the provider (e.g. community import):
// persist it and notify any live editor so it re-themes immediately.
export function applyImportedTheme(input: unknown): WorkshopTheme {
  const clean = sanitizeTheme(input)
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(WORKSHOP_THEME_LS_KEY, JSON.stringify(clean)) } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('workshop-theme-import', { detail: clean }))
  }
  return clean
}

// ── User-saved presets (local library of custom themes) ───────────────────────

const PRESETS_LS_KEY = '100lights-workshop-presets'

export interface SavedPreset { id: string; name: string; theme: WorkshopTheme; savedAt: number }

export function getUserPresets(): SavedPreset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(p => ({ ...p, theme: sanitizeTheme(p.theme) })) : []
  } catch { return [] }
}

export function saveUserPreset(name: string, theme: WorkshopTheme): SavedPreset {
  const preset: SavedPreset = {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 60) || 'My theme',
    theme: sanitizeTheme({ ...theme, name }),
    savedAt: Date.now(),
  }
  const all = [preset, ...getUserPresets()].slice(0, 60)
  try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(all)) } catch { /* ignore */ }
  return preset
}

export function deleteUserPreset(id: string): void {
  const all = getUserPresets().filter(p => p.id !== id)
  try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}

// ── Built-in presets (always available, no account needed) ────────────────────

export const BUILTIN_PRESETS: WorkshopTheme[] = [
  {
    version: THEME_VERSION, id: 'preset-studio', name: 'Studio Gray',
    colors: {}, pattern: { type: 'none', opacity: 0.5, scale: 22 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-midnight', name: 'Midnight Purple',
    colors: {
      bgBase: '#0d0d14', bgSurface: '#131320', bgCard: '#181828', bgCardHover: '#1e1e32',
      border: '#252540', borderLight: '#2e2e50', textPrimary: '#f0effe',
      textSecondary: '#9998bb', textMuted: '#7d7d9c', accent: '#7c3aed',
    },
    pattern: { type: 'dots', color: '#2e2e50', opacity: 0.6, scale: 24 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-sunset', name: 'Sunset',
    colors: {
      bgBase: '#1a1013', bgSurface: '#241619', bgCard: '#2c1a1e', bgCardHover: '#372126',
      border: '#3e262c', borderLight: '#512f38', textPrimary: '#fdeee9',
      textSecondary: '#d4a99e', textMuted: '#a67c74', accent: '#f97316',
    },
    pattern: { type: 'diagonal', color: '#512f38', opacity: 0.5, scale: 18, angle: 45 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-forest', name: 'Forest',
    colors: {
      bgBase: '#0e1512', bgSurface: '#141d19', bgCard: '#182420', bgCardHover: '#1e2c27',
      border: '#243530', borderLight: '#2d443c', textPrimary: '#e8f5ee',
      textSecondary: '#9fc2b2', textMuted: '#749386', accent: '#22c55e',
    },
    pattern: { type: 'grid', color: '#2d443c', opacity: 0.5, scale: 26 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-mono', name: 'Mono',
    colors: {
      bgBase: '#0a0a0a', bgSurface: '#121212', bgCard: '#161616', bgCardHover: '#1d1d1d',
      border: '#242424', borderLight: '#303030', textPrimary: '#fafafa',
      textSecondary: '#a3a3a3', textMuted: '#6f6f6f', accent: '#e5e5e5',
    },
    pattern: { type: 'none', opacity: 0.5, scale: 22 }, accentSync: false,
  },
  {
    version: THEME_VERSION, id: 'preset-ocean', name: 'Ocean',
    colors: {
      bgBase: '#0a1622', bgSurface: '#10202f', bgCard: '#152838', bgCardHover: '#1b3345',
      border: '#223c50', borderLight: '#2c4c64', textPrimary: '#e6f2fb',
      textSecondary: '#9fc0d6', textMuted: '#6f92a8', accent: '#38bdf8',
    },
    pattern: { type: 'grid', color: '#2c4c64', opacity: 0.5, scale: 26 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-rose', name: 'Rose Quartz',
    colors: {
      bgBase: '#1a0f16', bgSurface: '#241521', bgCard: '#2c1a29', bgCardHover: '#371f32',
      border: '#3e2438', borderLight: '#522f49', textPrimary: '#fce9f3',
      textSecondary: '#d5a6c2', textMuted: '#a67c96', accent: '#ec4899',
    },
    pattern: { type: 'dots', color: '#522f49', opacity: 0.55, scale: 22 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-amber', name: 'Amber',
    colors: {
      bgBase: '#14100a', bgSurface: '#1c160d', bgCard: '#221a10', bgCardHover: '#2a2015',
      border: '#322818', borderLight: '#443619', textPrimary: '#f6efe1',
      textSecondary: '#cbb894', textMuted: '#9a8a68', accent: '#f59e0b',
    },
    pattern: { type: 'grid', color: '#443619', opacity: 0.45, scale: 24 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-neon', name: 'Neon',
    colors: {
      bgBase: '#0a0a12', bgSurface: '#101020', bgCard: '#14142a', bgCardHover: '#1a1a36',
      border: '#24244a', borderLight: '#33336a', textPrimary: '#eef0ff',
      textSecondary: '#a6a8d8', textMuted: '#7676a8', accent: '#d946ef',
    },
    pattern: { type: 'cross', color: '#33336a', opacity: 0.6, scale: 20 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-slate', name: 'Slate',
    colors: {
      bgBase: '#0f1117', bgSurface: '#161922', bgCard: '#1b1f2a', bgCardHover: '#222634',
      border: '#2a2f3d', borderLight: '#363c4e', textPrimary: '#eef1f6',
      textSecondary: '#aab3c5', textMuted: '#7c8598', accent: '#6366f1',
    },
    pattern: { type: 'none', opacity: 0.5, scale: 22 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-vapor', name: 'Vaporwave',
    colors: {
      bgBase: '#120a1e', bgSurface: '#1a0f2b', bgCard: '#221436', bgCardHover: '#2b1a44',
      border: '#38235a', borderLight: '#4a2f75', textPrimary: '#f3e9ff',
      textSecondary: '#c4a6e0', textMuted: '#9678b8', accent: '#f472b6',
    },
    pattern: { type: 'diagonal', color: '#4a2f75', opacity: 0.5, scale: 18, angle: 60 }, accentSync: true,
  },
  {
    version: THEME_VERSION, id: 'preset-contrast', name: 'High Contrast',
    colors: {
      bgBase: '#000000', bgSurface: '#0a0a0a', bgCard: '#111111', bgCardHover: '#1a1a1a',
      border: '#333333', borderLight: '#4d4d4d', textPrimary: '#ffffff',
      textSecondary: '#d4d4d4', textMuted: '#a3a3a3', accent: '#ffcc00',
    },
    pattern: { type: 'none', opacity: 0.5, scale: 22 }, accentSync: false,
  },
]
