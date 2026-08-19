// The Constellation — single source of truth for every destination on the site.
// Modules (the big editors), apps (standalone tools), tools (music utilities),
// and games (shareable mini-experiences) all live here; the launcher, the ⌘K
// switcher, the /apps directory, the sitemap, the proxy public-route list, and
// the legacy-URL redirects are ALL derived from this file. Adding a new app to
// the site = one entry here + its page folder.
//
// Pure and dependency-free (besides apps-registry, which is also pure) so it
// can be imported from proxy.ts (edge), next.config, server routes, and client
// components alike.

// Relative imports (not '@/…') so next.config.ts can load this file at config
// time, where tsconfig path aliases are not resolved.
import { MINI_APPS } from './apps-registry'
import type { ModuleKey } from './editor-types'

export type LightKind = 'module' | 'app' | 'tool' | 'game'
export type LightStatus = 'live' | 'beta' | 'hidden'

export interface LightEntry {
  /** Registry key. For apps this is also the top-level URL segment. */
  slug: string
  kind: LightKind
  name: string
  tagline: string
  /** Emoji glyph — used by the launcher grid and ⌘K rows. */
  icon: string
  /** Accent color for cards/chips. */
  color: string
  href: string
  status: LightStatus
  /** Old URLs that 301 here (next.config redirects are generated from these). */
  legacyHrefs?: string[]
  /** For kind 'module': the internal editor module key (unchanged in data). */
  moduleKey?: ModuleKey
  /** Excluded from sitemap + robots-disallowed (pre-launch surfaces). */
  noindex?: boolean
}

// ── Modules — the flagship editors, named for phenomena of light ─────────────
// Internal data keys stay 'audio' / 'video' / 'image' (projects, licenses, and
// module_config rows never migrate); only the public identity + URL change.
export const MODULES: LightEntry[] = [
  {
    slug: 'beacon', kind: 'module', moduleKey: 'audio',
    name: 'Beacon', tagline: 'The music studio — a full DAW in your browser.',
    icon: '🎛️', color: '#3b82f6', href: '/beacon',
    legacyHrefs: ['/apps/audio'], status: 'live',
  },
  {
    slug: 'prism', kind: 'module', moduleKey: 'video',
    name: 'Prism', tagline: 'The video suite — cut, grade, caption, export.',
    icon: '🎬', color: '#8b5cf6', href: '/prism',
    legacyHrefs: ['/apps/video'], status: 'live',
  },
  {
    slug: 'aperture', kind: 'module', moduleKey: 'image',
    name: 'Aperture', tagline: 'The design canvas — layers, text, brand kits.',
    icon: '🖼️', color: '#ec4899', href: '/aperture',
    legacyHrefs: ['/apps/image'], status: 'hidden',
  },
]

/** Module entry by its internal editor key ('audio' | 'video' | 'image'). */
export const moduleEntry = (key: ModuleKey): LightEntry =>
  MODULES.find(m => m.moduleKey === key)!

// ── Apps — standalone tools, promoted to top-level URLs ──────────────────────
export const APPS: LightEntry[] = MINI_APPS.map(a => ({
  slug: a.slug, kind: 'app' as const,
  name: a.title, tagline: a.tagline,
  icon: a.icon ?? '🔆', color: a.color ?? '#8b5cf6',
  href: a.href,
  legacyHrefs: [`/apps/${a.slug}`],
  status: (a.status ?? 'live') as LightStatus,
  noindex: a.noindex,
}))

// ── Tools — small music utilities under /tools ───────────────────────────────
const tool = (slug: string, name: string, tagline: string, icon: string): LightEntry => ({
  slug, kind: 'tool', name, tagline, icon, color: '#64748b',
  href: `/tools/${slug}`, status: 'live',
})
export const TOOLS: LightEntry[] = [
  tool('tuner', 'Tuner', 'Tune any instrument with your mic.', '🎚️'),
  tool('metronome', 'Metronome', 'Steady time, tap tempo, subdivisions.', '⏱️'),
  tool('chord-progressions', 'Chord Progressions', 'Hear and build progressions.', '🎹'),
  tool('chord-identifier', 'Chord Identifier', 'Name the chord you’re playing.', '🔎'),
  tool('circle-of-fifths', 'Circle of Fifths', 'The map of keys, interactive.', '🧭'),
  tool('scales', 'Scales', 'Every scale, played and shown.', '🪜'),
  tool('delay-calculator', 'Delay Calculator', 'Delay + reverb times from BPM.', '⏲️'),
  tool('ear-training', 'Ear Training', 'Intervals, chords, and melodies by ear.', '👂'),
  tool('vocal-range', 'Vocal Range', 'Find your range and voice type.', '🗣️'),
]

// ── Games — shareable mini-experiences under /play ───────────────────────────
const game = (slug: string, name: string, tagline: string, icon: string): LightEntry => ({
  slug, kind: 'game', name, tagline, icon, color: '#f59e0b',
  href: `/play/${slug}`, status: 'live',
})
export const GAMES: LightEntry[] = [
  game('guess-the-genre', 'Guess the Genre', 'Same four chords — name the genre.', '❓'),
  game('hear-the-difference', 'Hear the Difference', 'Trust your ears. A/B the mix.', '🎧'),
  game('build-a-beat', 'Build a Beat', 'Make a beat in ten seconds.', '🕹️'),
]

/** Everything, in launcher display order. */
export const LIGHTS: LightEntry[] = [...MODULES, ...APPS, ...TOOLS, ...GAMES]

/** Publicly visible entries (drop 'hidden'). */
export const visibleLights = (): LightEntry[] => LIGHTS.filter(e => e.status !== 'hidden')

export const lightBySlug = (slug: string): LightEntry | undefined =>
  LIGHTS.find(e => e.slug === slug)

// ── Derived: legacy 301s (consumed by next.config.ts redirects()) ────────────
export interface LegacyRedirect { source: string; destination: string }
export const LEGACY_REDIRECTS: LegacyRedirect[] = LIGHTS.flatMap(e =>
  (e.legacyHrefs ?? []).flatMap(src => [
    { source: src, destination: e.href },
    { source: `${src}/:path*`, destination: `${e.href}/:path*` },
  ]),
)

// ── Derived: public route matchers (consumed by proxy.ts) ────────────────────
// Every constellation destination is public — each page gates what needs auth
// downstream (same pattern as /dashboard and /projects).
export const PUBLIC_LIGHT_ROUTES: string[] = [
  '/apps',            // the public directory
  '/create',          // studio entry (guest funnel handles signed-out)
  '/store(.*)',
  '/play(.*)',
  '/tutorial(.*)',
  ...MODULES.map(m => `${m.href}(.*)`),
  ...APPS.map(a => `${a.href}(.*)`),
]
