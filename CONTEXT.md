# 100Lights — AI Context File

This file is for Claude to read at the start of new sessions to understand the app without needing a full conversation recap.

> **Heads-up on stack:** this runs a modified **Next.js 16** with breaking changes vs. what you may know — read the guides in `node_modules/next/dist/docs/` before writing framework code (see `AGENTS.md`).

## What is 100Lights?

100Lights is **"The Music Studio in Your Browser"** — a full browser-based DAW (digital audio workstation). The pitch: most music software does the work for you; 100Lights is built so the work makes you *better* (ear training baked into a real DAW). It runs in the browser, free to start, with an optional desktop app (Mac/Windows) and a mobile touch build.

Core features:
- **Session & Arrangement View** — Ableton-style live clip launching plus a full timeline.
- **Piano roll** with per-roll sustain/effects and **voice mapping** (sing a melody, see your pitch traced over the keys).
- **Mixing & effects** — full mixer with sends/returns and a per-track chain (EQ, Compressor, Reverb, Delay, Saturator, Auto Pan, and more).
- **Drum Rack & JAM** — 8-pad drum rack; JAM captures a live take straight onto the timeline.
- **Sound library** — 1000+ built-in sounds; samples stretch to any note length (hold a violin for four bars).
- **Community** — share samples, packs, presets, and chord-progression recipes via public links anyone can play (no account to listen).
- **Real-time collaboration** — live co-editing of a session (Liveblocks), with chat and timeline comments.
- **Podcast mode** — multitrack talk recording, level riding, clean exports.
- **Practice Room / Learn** — guided skill paths that self-check as you work, build-a-song-by-genre walkthroughs, and "design sounds with code" (synth patches from a few lines of math).
- **Free tools** (public, no login) at `/tools` — metronome, tuner, ear training, scales, chord identifier, chord progressions, circle of fifths, delay calculator, vocal range.
- Exports: WAV (44.1/48 kHz), WebM, per-track stems (zip of WAVs), MIDI.

Target users: bedroom producers, singers, podcasters, and learners who want a real DAW that also trains their ear.

> **Note on history:** 100Lights was previously a content-repurposing / transcription product ("contentforge"). That product is gone. Some dormant code remains (see *Legacy / dormant code* below) but **there is no end-user AI or transcription feature** — the live product is unambiguously a music DAW.

## Business Model

Two plans; feature gates live in `lib/stripe.ts` (`PLAN_LIMITS`), prices live in Stripe:

- **Free**: 500 MB storage, up to 5 projects. Full audio editor (DAW) free forever.
- **Pro** ($19/mo or annual): 20 GB storage, unlimited projects, live collaboration on shared projects, priority support.

- **Prices are not hardcoded.** `getProPrice()` fetches from Stripe at runtime by **lookup_key** (`pro_monthly`, `pro_annual`), cached 5 min. No price/product IDs in code or env — Stripe owns pricing; this repo owns the feature gates. Adding a plan = new Stripe price + lookup_key, then update `PLAN_LIMITS`.
- Pro can also be granted **without Stripe**: admin **gifts** (`gift_plan` / `gift_until` on `subscriptions`) and **redemption codes** (`lib/codes.ts` — promo codes stackable/redeemable once each, starter codes once-ever, granting N days of Pro).
- Payments via Stripe Checkout (subscriptions) + billing portal. Clerk `user.created` webhook auto-creates a Stripe customer + free subscription row.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.7 (App Router, Turbopack) — **modified build, read `node_modules/next/dist/docs/`** |
| UI | React 19.2.4, Tailwind v4, `lucide-react` icons |
| Auth | Clerk v7 (`@clerk/nextjs` ^7.5.1) — live mode, custom domain `clerk.100lights.com` |
| Database | Neon serverless Postgres (`@neondatabase/serverless`) + `pg` — `lib/db.ts` is **dual-mode** (Neon HTTP remote / local `pg` adapter, same tagged-template API) |
| File storage | Cloudflare R2 via S3 API (`@aws-sdk/client-s3`), bucket set via `R2_BUCKET` env |
| Realtime collab | Liveblocks (`@liveblocks/client|node|react`) |
| Audio | Custom Web Audio engine in `lib/` (no Tone.js); `@ffmpeg/ffmpeg` + `jszip` for export/packaging |
| Payments | Stripe (`stripe` ^22, API `2026-05-27.dahlia`), live mode |
| Webhooks | `svix` (Clerk signature verification) |
| Analytics | PostHog (`posthog-js`) |
| Error tracking | Sentry (`@sentry/nextjs`, `instrumentation.ts`) |
| Mobile | Capacitor 7 (`capacitor.config.json`, appId `com.hundredlights.studio`) wrapping the hosted `/m` PWA |
| Desktop | Electron (`electron/`, `DESKTOP.md`) — separate build |
| Deployment | Vercel (auto-deploy from GitHub `main`) |
| Domain | 100lights.com (Vercel), clerk.100lights.com (CNAME → Clerk) |

**No AI SDK is a dependency** — no `@anthropic-ai/sdk`, `openai`, or `@deepgram/sdk`. The bits of AI/transcription code that remain call raw HTTP and are admin-only or dormant (see below).

## Repository Structure (`/Users/brae/100lights`)

> The `package.json` `"name"` is still literally `"contentforge"` — a harmless leftover from the old product.

```
app/
├── layout.tsx              # Root layout — ClerkProvider, PostHog, fonts, AnnouncementBanner
├── page.tsx                # Marketing landing (ISR, revalidate 3600)
├── (app)/                  # Authed studio shell (AppLayoutClient re-locks editor zoom)
│   ├── projects/[id]/      # THE DAW editor/studio (project by id)
│   ├── new/                # Create-project flow
│   ├── dashboard/          # User home / project list
│   ├── library/            # User sound library
│   ├── launcher/, apps/[module]/  # Module launcher + pluggable feature modules
│   ├── trash/              # Soft-deleted projects
│   ├── settings/           # Plan status, billing portal
│   ├── [username]/         # Public user profile pages
│   └── admin/              # Founder admin console (see Admin below)
├── community/              # Public community browse/detail
├── learn/                  # Public Learn articles (Practice Room content)
├── tools/                  # Free public music utilities (metronome, tuner, ear training, …)
├── m/                      # Mobile touch studio (public PWA)
├── guest/, share/, download/, tutorial/, audio-check/, legal/, sign-in/, sign-up/
└── api/
    ├── projects/, projects/[id]/     # CRUD + soft-delete/restore; lazy trash purge
    ├── media/, stems/, fetch-audio/  # R2 presign, stem export, audio fetch
    ├── catalog/                      # Official sound catalog (R2-backed, ships to all)
    ├── library/                      # Per-user synced sounds (user_sounds)
    ├── process-synth/, synth-code/, match-vocal/  # Audio/synth/voice-map compute
    ├── liveblocks-auth/              # Realtime collab tokens
    ├── community/, learn/, learn-audio/, learn-media/, notifications/
    ├── checkout/, billing/, webhook/stripe/, webhook/clerk/   # Stripe + Clerk
    ├── codes/, platform-flags/, feedback/, announcements/
    ├── cron/digest/                  # Weekly founder digest email (dormant w/o keys)
    ├── admin/                        # All admin endpoints
    └── transcribe/                   # LEGACY Deepgram route — dormant (503 without key)
components/
├── mobile/MobileDawClient.tsx → MobileDaw.tsx     # Mobile DAW (wraps real desktop components)
│   └── daw/                                        # ChordPad, MobileTransport, seed, templates
├── AnnouncementBanner.tsx            # Global dismissible broadcast banner
└── … (editor, layout, providers)
lib/                        # DB, auth, billing, audio engine, admin, etc. (see below)
db/schema.sql               # Canonical Neon schema (run once)
```

## Key `lib/` files

- `db.ts` — dual-mode DB driver (Neon HTTP / local `pg`), same `sql` tagged-template API. Local adapter returns a thenable **without `.catch`** — use try/catch.
- `subscription.ts` — plan resolution (Stripe → gift → code precedence), `getSubscription`, `upsertSubscription`, `getPlanLimits`.
- `stripe.ts` — Stripe client, `PLAN_LIMITS`, runtime price lookup by lookup_key.
- `codes.ts` — redemption codes (promo stackable, starter once-ever).
- `r2.ts` — Cloudflare R2 (S3) client, presigned upload/download, `listAllObjects`, delete.
- `catalog.ts` / `sound-library.ts` — official global sound catalog (R2) / per-user IndexedDB library.
- `community-server.ts`, `community.ts` — community kinds, reactions, table provisioning.
- `admin-auth.ts` — admin gate (see Admin). `admin-audit.ts` — append-only admin action log.
- `announcements.ts` — broadcast banners. `notifications-server.ts` — in-app notifications.
- `email.ts` — transactional email, **dormant** until `RESEND_API_KEY` set (silent no-op otherwise).
- `digest.ts` — founder morning-brief metrics (best-effort; emailable via cron).
- `webhook-handlers.ts` / `webhook-log.ts` — idempotent webhook business logic + logged/replayable event store.
- `platform-flags.ts` — module / audio-mode / community-mode feature flags.
- `rate-limit.ts` — per-user daily action limits (`usage` table). `guest-sessions.ts` — token guest uploads.
- **Audio engine** (large set): `daw-engine.ts`, `daw-state.ts`, `daw-types.ts`, `daw-effects.ts`, `daw-instruments.ts`, `daw-undo.ts`, `sampler-engine.ts`, `fm-synth.ts`, `wavetable-synth.ts`, `drum-synth.ts`, `pitch-detect*.ts`, `beat-analyzer.ts`, `hpss.ts`, `stft.ts`, `wsola.ts`, `wav-encoder.ts`, `exporter.ts`, `midi-file.ts`, `web-midi.ts`, `ableton-parser.ts`, etc.

## Database Schema (Neon)

`db/schema.sql` creates the core tables; **many others are created lazily** via `CREATE TABLE IF NOT EXISTS` in `lib/*` and route files (so a fresh DB self-provisions).

Core tables:

```sql
-- projects: a serialized DAW project as JSONB
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  saved_at TIMESTAMPTZ,
  data JSONB NOT NULL DEFAULT '{}',   -- the serialized DAW project
  deleted_at TIMESTAMPTZ              -- NULL = active, non-null = trash (purged after 7 days)
);

-- subscriptions: billing + comp state
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  stripe_sub_id TEXT,                 -- present = a real paying Stripe sub
  plan TEXT DEFAULT 'free',           -- 'free' | 'pro'
  status TEXT DEFAULT 'active',       -- mirrors Stripe subscription status
  current_period_end TIMESTAMPTZ,
  gift_plan TEXT,                     -- admin gift (e.g. 'pro')
  gift_until TIMESTAMPTZ,             -- NULL = indefinite gift
  created_at TIMESTAMPTZ,             -- real signup time (count new users on this)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Other tables (purpose):
- `user_settings` (per-user prefs/theme JSONB), `usage` (per-user/day rate-limit counters).
- `redemption_codes` + `code_redemptions` (promo/starter Pro codes), `admin_audit` (admin action log), `catalog_sounds` (official curated catalog; audio in R2).
- Community: `community_items` (+ `community_comments`, `community_comment_reports`, `community_reactions`, `community_reports`, `community_votes`). `community_items.kind` ∈ song/sample/preset/recipe/pack/project/theme/kit/pattern/post, with soft-removal (`removed_at/by/reason`).
- `learn_articles` + `learn_reactions` (Learn content), `announcements` (broadcast banners), `notifications` (in-app social), `platform_config` (flags).
- Collab: `project_members` + `project_suggestions`; `guest_sessions` (guest uploads); `demo_audio_overrides` (landing demo audio).
- Ops (added by recent admin work): `webhook_events` (logged/replayable Stripe+Clerk events), `mrr_snapshots` (daily MRR history, self-populating on admin load), `user_sounds` (per-user synced library), `user_notes` (admin CRM notes/tags per user), `feedback` (user feedback inbox).

## Auth & Admin

- **App auth**: Clerk via `middleware.ts` (`clerkMiddleware`) with a public-route allowlist (landing, sign-in/up, share, guest, community, learn, tools, `/m`, download, legal, etc.); everything else calls `auth.protect()`. `DEV_OPEN=1` fully bypasses auth in dev (never prod).
- **Admin** (`lib/admin-auth.ts`): hardcoded `ADMIN_EMAIL = braedancampbell@gmail.com`. `isAdmin()` requires **both** the Clerk user's primary email == that constant **and** an `admin_auth` cookie whose value == `process.env.ADMIN_CODE`. Every admin route calls `await isAdmin()`; consequential actions are logged to `admin_audit` via `logAdmin()`.
- **Admin console** (`app/(app)/admin`): a grouped sidebar cockpit — General (Daily Brief, Overview, Users, Revenue, Announcements, Articles, Codes, Feedback, Community, Module Visibility, Status, Webhooks, Storage, Audit, Quick Links) + Audio (Catalog, Sound Library, MIDI Presets, Sample Packs, Beat Corrections) + Video/Image (coming soon). ⌘K command palette; live attention badges in the nav.
- **Dev testing pattern**: to exercise admin locally, temporarily add a `NODE_ENV !== 'production'` bypass gated on cookie `__dev_admin === 'devadmin-9f3a2c7b1e'` in `lib/admin-auth.ts` **and** `app/(app)/admin/layout.tsx`, verify via Playwright, then **`git checkout` revert both before pushing**.

## Mobile

Touch-first studio at **`/m`** — `app/m/page.tsx` renders `MobileDawClient` → `MobileDaw` (`components/mobile/`). It's a **phone layout around the REAL desktop feature components** (ArrangementView, Mixer, SessionView, InstrumentPicker, DeviceChain, SoundLibrary, PolyCode) driven by the shared `DawContext` — the layout changes, not the functions. Shell: a hamburger drawer (Home / projects / live Clips / Sound library / Code), a slim transport, and a **Song | Mix | Sounds** bottom nav, so a phone session is a normal `DawProject`. Installable as a **PWA** (`app/manifest.ts` + `public/sw.js`). Native App/Play Store shipping is pre-wired via **Capacitor 7** (appId `com.hundredlights.studio`), which loads the hosted `/m` (`server.url = https://100lights.com/m`) plus native plugins (haptics, splash, status bar, share, preferences) to satisfy Apple guideline 4.2. See `MOBILE.md`. **Keep mobile/desktop in sync, especially anything affecting sound** — both must survive project sync.

## Key Architectural Decisions

1. **Dual-mode `sql`** (`lib/db.ts`) — Neon HTTP in prod, a local `pg` adapter in dev. The local adapter's thenable has no `.catch`; guard optional queries with try/catch. Composable `${sql\`…\`}` fragments work in both, but avoid conditional-fragment-in-a-value-slot (use parameterized `CASE`).
2. **Prices in Stripe, gates in code** — no price IDs in env; `getProPrice()` resolves by lookup_key with a 5-min cache.
3. **Soft delete** — projects set `deleted_at`; Trash restores; lazy purge (>7 days) runs on `/api/projects` GET, clearing R2 + DB.
4. **Self-provisioning schema** — beyond `db/schema.sql`, feature tables are created on first use via `CREATE TABLE IF NOT EXISTS`, so shipping a feature needs no manual migration step.
5. **R2 presigned URLs** — media is private; upload via presigned PUT, playback via presigned GET (1-hour expiry).
6. **Admin actions are audited** — anything consequential calls `logAdmin(action, target, detail)`.

## Legacy / dormant code (from the old transcription product — safe to ignore, don't build on)

- `package.json` `"name": "contentforge"` — stale name.
- `app/api/transcribe/route.ts` + `lib/providers/deepgram.ts` + `lib/providers/transcription.ts` — **Deepgram transcription, dormant**; returns 503 without `DEEPGRAM_API_KEY`. Not surfaced anywhere in the product. **We do not use transcription anymore.**
- `app/api/admin/articles/generate|revise` + `ANTHROPIC_API_KEY` — Anthropic is used **only** as an admin-only editorial tool for drafting Learn articles (returns 501 without the key). 100Lights ships no user-facing AI feature.
- `lib/replicate.ts` + `REPLICATE_API_TOKEN` — present; verify before relying on it.
- Root strategy artifacts (`launch-copy.html`, `pricing-analysis.html`, `pricing-strategy.html`) — old planning docs.

## Environment Variables (Vercel + `.env.local`)

- Core: `DATABASE_URL` (Neon pooler), `NODE_ENV`, `NEXT_PUBLIC_APP_URL`, `DEV_OPEN` (dev-only auth bypass)
- Clerk: publishable/secret keys (SDK convention) + `CLERK_WEBHOOK_SECRET`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- Liveblocks: `LIVEBLOCKS_SECRET_KEY`
- Analytics/errors: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`
- Admin/ops: `ADMIN_CODE` (admin cookie value), `CRON_SECRET`, `DIGEST_TO`, `ARTICLE_PREVIEW_SECRET`
- Email (dormant until set): `RESEND_API_KEY`, `EMAIL_FROM`
- Legacy/optional: `DEEPGRAM_API_KEY` (dormant transcribe route), `ANTHROPIC_API_KEY` (admin article tooling), `REPLICATE_API_TOKEN`

## What the Owner Wants

Brae is building this as a low-maintenance SaaS. They want:
- Revenue-focused polish (conversion, retention, upgrade flows) and an admin console that runs the company.
- Automated Stripe/billing wherever possible; minimal manual steps.
- Clean, dark, professional UI via the existing CSS-variable color system.
- Ship features that make the product better and make money — no unnecessary complexity.
