/**
 * Single source of truth for what each plan can do.
 *
 * Isomorphic — no server-only imports — so API routes and client components
 * read the SAME numbers. When you add a gate, add it here first, then reference
 * `entitlements(plan).<field>` or `can(plan, 'feature')` everywhere else.
 *
 * Design rule: gate the CONTAINER (how much you store/sync), the OUTPUT
 * (release-grade formats, watermark), the REACH (collaboration, community
 * placement) and the POLISH (badges, themes) — NEVER the instrument. A free
 * user can always make a complete song with every instrument, effect, track,
 * and save it (locally, unlimited). Paying buys scale, convenience, and reach.
 *
 * ── The four plans ──────────────────────────────────────────────────────────
 *
 *   free    Make anything. Keep it locally. Modest cloud.
 *   pro     Cloud convenience: scale, release-grade output, collaboration.
 *   studio  YOUR machine does the heavy work — the desktop app. Background
 *           rendering off the UI process, every core, an unbounded native
 *           cache, real audio hardware, plugins, local ML. Costs us close to
 *           nothing to serve, which is why it can be generous.
 *   max     OUR machines do it for you. Server rendering, hosted exports and
 *           video, priority queue. This is the tier with real marginal cost,
 *           so it is the tier that is metered.
 *
 * Each tier answers a different question — "how much?", "how good?", "whose
 * computer?" — rather than being the same thing at three prices.
 */

export type Plan = 'free' | 'pro' | 'studio' | 'max'
export type AudioExportFormat = 'webm' | 'wav' | 'stems'

/** Ordering. Everything above compares ranks, never plan names, so a new tier
 *  slots in by adding one entry rather than by editing every comparison. */
export const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, studio: 2, max: 3 }

export const PAID_PLANS: readonly Plan[] = ['pro', 'studio', 'max']

/**
 * Is this a paying customer?
 *
 * Use this rather than `plan === 'pro'`. Before the tiers above existed, those
 * two things were the same sentence, and roughly twenty call sites said the
 * second when they meant the first — which would have quietly treated a Max
 * subscriber as a free user the day a third tier shipped. There is a test that
 * fails if `=== 'pro'` comes back.
 */
export function isPaid(plan: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK.pro
}

/** Does `plan` reach at least `needed`? */
export function atLeast(plan: Plan, needed: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[needed]
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TIER TABLE
//
// Every gated capability, and the lowest plan that gets it. This is the one
// place to look, and the one place to edit: moving a feature between tiers is
// a one-word change here and nothing anywhere else. Call sites ask
// `can(plan, 'feature')` and never name a tier.
// ─────────────────────────────────────────────────────────────────────────────

export const FEATURE_TIER = {
  // ── pro · cloud convenience ────────────────────────────────────────────────
  /** Share-with-edit and real-time co-editing. */
  collaboration:        'pro',
  /** Eligible for featured placement in Community. */
  featuredCommunity:    'pro',
  /** Pro badge on profile and posts. */
  proBadge:             'pro',
  /** Cloud snapshots you can restore. */
  versionHistory:       'pro',
  /** Export without the "Made with 100Lights" tag. */
  unwatermarkedExport:  'pro',
  /** WAV and per-track stems out of the export modal. */
  losslessExport:       'pro',
  /** LUFS / clipping / spectral-balance report after a bounce. */
  mixReport:            'pro',

  // ── studio · the desktop app; your machine does the work ───────────────────
  /** Access to the desktop build at all. */
  desktopApp:           'studio',
  /** Rendering in a separate OS process, so the interface never freezes. */
  backgroundRender:     'studio',
  /** Bake clips across every core instead of one main thread. */
  multiCoreRender:      'studio',
  /** Native on-disk render cache: no quota, no eviction, kept forever. */
  unlimitedRenderCache: 'studio',
  /** CoreAudio / ASIO, multichannel interfaces, real low latency. */
  nativeAudioIo:        'studio',
  /** MIDI hardware beyond what WebMIDI allows. */
  midiHardware:         'studio',
  /** Host third-party VST/AU plugins. Not "the instrument" under the design
   *  rule above — every built-in instrument stays free; this is other
   *  people's software running inside ours. */
  pluginHosting:        'studio',
  /** Video and timelapse export through native ffmpeg. */
  nativeVideoExport:    'studio',
  /** Record a build session and render a shareable timelapse. */
  sessionTimelapse:     'studio',
  /** Stem separation, transcription and embeddings run on your machine. */
  localMl:              'studio',
  /** "Find sounds that sound like this" over the library. */
  soundsLikeSearch:     'studio',

  // ── max · our machines do it for you ───────────────────────────────────────
  /** Bake clips on our servers — for weak hardware, or just for speed. */
  serverRender:         'max',
  /** Hosted bounce and master; nothing runs on your machine. */
  serverExport:         'max',
  /** Song videos and timelapses rendered for you. */
  hostedVideoRender:    'max',
  /** Mastering chain applied to the final bounce. */
  masteringChain:       'max',
  /** Re-render every project after a preset change, in the background. */
  batchRerender:        'max',
  /** Jobs go to the front of the render queue. */
  priorityQueue:        'max',
} as const satisfies Record<string, Plan>

export type Feature = keyof typeof FEATURE_TIER

/** Everything this plan can do — handy for a pricing page or an upsell. */
export function featuresFor(plan: Plan): Feature[] {
  return (Object.keys(FEATURE_TIER) as Feature[]).filter(f => can(plan, f))
}

/** The plan someone needs in order to use `feature`. */
export function tierFor(feature: Feature): Plan {
  return FEATURE_TIER[feature]
}

export function can(plan: Plan, feature: Feature): boolean {
  return atLeast(plan, FEATURE_TIER[feature])
}

// ─────────────────────────────────────────────────────────────────────────────
// Quotas. These are numbers rather than yes/no, so they live per plan rather
// than in the table above.
// ─────────────────────────────────────────────────────────────────────────────

export interface Entitlements {
  // ── Scale / quotas ──
  projectsMax: number               // cloud projects (local save is always unlimited)
  storageMb: number                 // total R2 media
  maxUploadMb: number               // per-file upload cap
  syncedSounds: number              // account-synced custom sounds
  communityPostsPerDay: number
  customThemes: number              // saved custom Workshop themes
  cloudVersionsPerProject: number   // retained version-history snapshots (0 = feature off)
  /** Seconds of OUR compute per month. The only quota that maps to a real
   *  bill, which is why it is the one that rises steeply with price. Studio
   *  gets a small allowance so the feature is discoverable on a weak machine —
   *  needing more of it is exactly the reason to move to Max. */
  serverRenderSecondsPerMonth: number

  // ── Output / release ──
  audioFormats: readonly AudioExportFormat[]  // formats the export modal allows
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
    serverRenderSecondsPerMonth: 0,
    audioFormats: ['webm'],
  },
  pro: {
    projectsMax: Infinity,
    storageMb: 20480,
    maxUploadMb: 1024,
    syncedSounds: Infinity,
    communityPostsPerDay: Infinity,
    customThemes: Infinity,
    cloudVersionsPerProject: 30,
    serverRenderSecondsPerMonth: 0,
    audioFormats: ['webm', 'wav', 'stems'],
  },
  studio: {
    projectsMax: Infinity,
    storageMb: 51200,
    maxUploadMb: 2048,
    syncedSounds: Infinity,
    communityPostsPerDay: Infinity,
    customThemes: Infinity,
    cloudVersionsPerProject: 100,
    serverRenderSecondsPerMonth: 1800,
    audioFormats: ['webm', 'wav', 'stems'],
  },
  max: {
    projectsMax: Infinity,
    storageMb: 204800,
    maxUploadMb: 5120,
    syncedSounds: Infinity,
    communityPostsPerDay: Infinity,
    customThemes: Infinity,
    cloudVersionsPerProject: Infinity,
    serverRenderSecondsPerMonth: 36000,
    audioFormats: ['webm', 'wav', 'stems'],
  },
}

export function entitlements(plan: Plan): Entitlements {
  return ENTITLEMENTS[plan] ?? ENTITLEMENTS.free
}

/** Human label for a plan, for pricing pages and upsells. */
export const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
  max: 'Max',
}

/** One line on why each tier exists. Kept next to the table so a pricing page
 *  and the gates can never drift apart. */
export const PLAN_PITCH: Record<Plan, string> = {
  free: 'Make anything. Keep it on your machine.',
  pro: 'Cloud scale, release-grade exports, and collaboration.',
  studio: 'The desktop app — your computer does the heavy work, at full speed.',
  max: 'Our machines do it for you: server rendering, hosted exports and video.',
}

/** Human label for a storage number, e.g. 20480 → "20 GB", 500 → "500 MB". */
export function formatStorage(mb: number): string {
  return mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`
}

/** Watermark and lossless export were booleans on Entitlements before the tier
 *  table existed. They are derived now so there is exactly one place that
 *  decides, but the old call shape still works. */
export function exportWatermark(plan: Plan): boolean {
  return !can(plan, 'unwatermarkedExport')
}
