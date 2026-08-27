/**
 * Single source of truth for what each plan can do.
 *
 * Isomorphic — no server-only imports — so API routes and client components
 * read the SAME numbers. When you add a gate, add it here first, then reference
 * `entitlements(plan).<field>` everywhere else.
 *
 * Design rule: gate the CONTAINER (how much you store/sync), the OUTPUT
 * (release-grade formats, watermark), the REACH (collaboration, community
 * placement) and the POLISH (badges, themes) — NEVER the instrument. A free
 * user can always make a complete song with every instrument, effect, track,
 * and save it (locally, unlimited). Paying buys scale, convenience, and reach.
 */

export type Plan = 'free' | 'pro'
export type AudioExportFormat = 'webm' | 'wav' | 'stems'

export interface Entitlements {
  // ── Scale / quotas ──
  projectsMax: number               // cloud projects (local save is always unlimited)
  storageMb: number                 // total R2 media
  maxUploadMb: number               // per-file upload cap
  syncedSounds: number              // account-synced custom sounds
  communityPostsPerDay: number
  customThemes: number              // saved custom Workshop themes
  cloudVersionsPerProject: number   // retained version-history snapshots (0 = feature off)

  // ── Output / release ──
  audioFormats: readonly AudioExportFormat[]  // formats the export modal allows
  exportWatermark: boolean          // visual "Made with 100Lights" tag on clips/screenshots

  // ── Convenience / safety ──
  versionHistory: boolean           // cloud snapshots you can restore

  // ── Reach / distribution ──
  collaboration: boolean            // share-with-edit / real-time co-editing
  featuredCommunity: boolean        // eligible for featured placement

  // ── Vanity / creator ──
  proBadge: boolean                 // Pro badge on profile + community posts
}

export const ENTITLEMENTS: Record<Plan, Entitlements> = {
  free: {
    projectsMax: 5,
    storageMb: 500,
    maxUploadMb: 100,
    syncedSounds: 30,
    communityPostsPerDay: 3,
    customThemes: 2,
    cloudVersionsPerProject: 3,

    audioFormats: ['webm'],
    exportWatermark: true,

    versionHistory: true,

    collaboration: false,
    featuredCommunity: false,

    proBadge: false,
  },
  pro: {
    projectsMax: Infinity,
    storageMb: 20480,
    maxUploadMb: 1024,
    syncedSounds: Infinity,
    communityPostsPerDay: Infinity,
    customThemes: Infinity,
    cloudVersionsPerProject: 30,

    audioFormats: ['webm', 'wav', 'stems'],
    exportWatermark: false,

    versionHistory: true,

    collaboration: true,
    featuredCommunity: true,

    proBadge: true,
  },
}

export function entitlements(plan: Plan): Entitlements {
  return ENTITLEMENTS[plan] ?? ENTITLEMENTS.free
}

/** Boolean-only feature keys — handy for `can(plan, 'collaboration')`. */
export type BoolFeature = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never
}[keyof Entitlements]

export function can(plan: Plan, feature: BoolFeature): boolean {
  return entitlements(plan)[feature]
}
