# 100Lights — AI Context File

This file is for Claude to read at the start of new sessions to understand the app without needing a full conversation recap.

## What is 100Lights?

100Lights is a SaaS platform for AI-powered content repurposing. Users upload video, audio, or recordings (podcasts, lectures, calls, etc.) and the app:
1. Transcribes the content (Deepgram nova-3)
2. Lets users edit the timeline, cut clips, and adjust captions
3. Generates written content from the transcript using Claude AI: articles, blog posts, show notes, social posts

Target users: solo creators, podcasters, YouTubers, course creators who want to multiply their content output without extra work.

## Business Model

- **Free tier**: 3 transcriptions/month, 10 AI generations/month, 500 MB storage
- **Pro tier**: $19/month — 30 transcriptions, 100 AI generations, 20 GB storage
  - Stripe Price lookup_key: `pro_monthly`
  - Stripe Product ID: `prod_Uh2YMyz7GoP880`
- Payments via Stripe Checkout (subscriptions). Billing portal auto-creates config on first use.
- Clerk webhook creates a Stripe customer automatically when a user signs up.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.7 (App Router, Turbopack) |
| Auth | Clerk v7 (`@clerk/nextjs` 7.5.1) — **live mode**, custom domain `clerk.100lights.com` |
| Database | Neon serverless Postgres |
| File storage | Cloudflare R2 (`100lights-media-user` bucket) |
| Transcription | Deepgram nova-3 |
| AI generation | Anthropic Claude (`claude-haiku-4-5-20251001`) |
| Payments | Stripe (live mode) |
| Analytics | PostHog |
| Error tracking | Sentry |
| Deployment | Vercel (auto-deploy from GitHub `main` branch) |
| Domain | 100lights.com (Vercel), clerk.100lights.com (DNS CNAME → Clerk) |

## Repository Structure

```
/Users/brae/contentforge/
├── app/
│   ├── layout.tsx              # Root layout — ClerkProvider, PostHog, fonts
│   ├── page.tsx                # Landing page (marketing, not behind auth)
│   ├── sign-in/                # Clerk <SignIn /> component
│   ├── sign-up/                # Clerk <SignUp /> component
│   ├── legal/terms/            # Terms of Service (real content, ready)
│   ├── legal/privacy/          # Privacy Policy (real content, ready)
│   ├── (app)/                  # Auth-protected app shell
│   │   ├── layout.tsx          # Server component — auth() check, redirects to /sign-in
│   │   ├── AppLayoutClient.tsx # Client — renders Sidebar + main or full-screen editor
│   │   ├── dashboard/          # Recent projects, stats, onboarding empty state
│   │   ├── projects/           # All projects list
│   │   ├── projects/[id]/      # Full video editor (VideoEditor.tsx)
│   │   ├── new/                # New project — same editor with blank state
│   │   ├── trash/              # Soft-deleted projects with restore/permanent delete
│   │   └── settings/           # Plan status, upgrade/billing portal buttons
│   └── api/
│       ├── projects/           # GET list, POST create; lazy trash purge
│       ├── projects/[id]/      # GET, PUT, DELETE (soft-delete); restore endpoint
│       ├── projects/trash/     # GET trashed projects
│       ├── media/presign-upload/ # Returns R2 presigned PUT URL (500 MB limit)
│       ├── media/signed-url/   # Returns R2 presigned GET URL for playback
│       ├── transcribe/         # Calls Deepgram, writes to DB, increments usage
│       ├── ai/                 # Calls Claude, writes output, increments usage
│       ├── usage/              # GET current month usage vs plan limits
│       ├── billing/info/       # GET current plan and period end from DB
│       ├── billing/portal/     # POST → Stripe billing portal session URL
│       ├── checkout/           # POST → Stripe Checkout session URL
│       ├── webhook/stripe/     # Handles subscription events, updates DB
│       └── webhook/clerk/      # user.created → creates Stripe customer + free subscription row
├── components/
│   ├── editor/
│   │   ├── VideoEditor.tsx     # Main editor: timeline, media library, AI panel (~1700 lines)
│   │   ├── MediaLibrary.tsx    # Left panel — file import with client-side validation
│   │   ├── VideoPlayer.tsx     # Playback with clip/caption overlay
│   │   ├── Timeline.tsx        # Drag-and-drop multi-track timeline
│   │   ├── Inspector.tsx       # Right panel — caption/clip properties
│   │   └── ExportModal.tsx     # Export options
│   ├── layout/
│   │   └── Sidebar.tsx         # Nav, usage meters (AI + transcriptions), upgrade button
│   ├── UpgradeModal.tsx        # Context-based modal with plan comparison + checkout trigger
│   └── PostHogProvider.tsx     # Initializes PostHog, identifies users, fires pageviews
├── lib/
│   ├── stripe.ts               # PLAN_LIMITS, getProPrice() — fetches by lookup_key, 5-min cache
│   ├── subscription.ts         # getSubscription(), upsertSubscription(), getPlanLimits()
│   ├── db.ts                   # Neon sql tagged template
│   ├── r2.ts                   # S3Client wrapper — presign, getObject, deleteObject/deleteObjects
│   ├── types.ts                # Shared types: Caption, Clip, Output, ContentType
│   └── editor-types.ts         # Editor-specific: MediaItem, Track, TimelineItem, etc.
└── db/schema.sql               # Neon schema: projects, usage, subscriptions tables
```

## Database Schema (Neon)

```sql
-- projects: core data stored as JSONB
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- NULL = active, non-null = in trash (purged after 7 days)
);

-- usage: per-user per-action monthly counters
CREATE TABLE usage (
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,           -- 'transcribe' | 'ai_generate'
  count INTEGER DEFAULT 0,
  reset_at TIMESTAMPTZ,           -- beginning of next month
  PRIMARY KEY (user_id, action)
);

-- subscriptions: billing state synced from Stripe webhooks
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  plan TEXT DEFAULT 'free',       -- 'free' | 'pro'
  status TEXT DEFAULT 'active',   -- mirrors Stripe subscription status
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Key Architectural Decisions

1. **No middleware.ts** — Clerk auth is done in `app/(app)/layout.tsx` as a server component. The root layout has no auth check so landing/legal/sign-in pages are public.

2. **Stripe lookup keys** — No price IDs in env vars. `getProPrice()` in `lib/stripe.ts` fetches by `lookup_key='pro_monthly'` with 5-minute cache. Adding new plans requires a Stripe product + price with a new lookup_key, then updating `PLAN_LIMITS`.

3. **Soft delete** — Projects are soft-deleted (deleted_at set). Trash page shows them with restore option. Lazy purge runs on `/api/projects` GET — checks for entries older than 7 days and bulk-deletes from R2 + DB.

4. **Upgrade modal** — Context-based via `UpgradeModalProvider` in AppLayoutClient. Call `useUpgradeModal().showUpgrade(reason)` from anywhere in the app tree. The editor calls this on 429 responses.

5. **R2 presigned URLs** — Media is private. Upload uses a presigned PUT URL. Playback uses presigned GET URLs (1-hour expiry). Deepgram transcription also fetches via presigned GET.

## Current Known Issues / Pending Work

- `clerk.100lights.com` DNS CNAME not added → sign-in page infinite loading (user needs to add CNAME in Cloudflare: `clerk` → `frontend-api.clerk.dev` or whatever Clerk dashboard specifies)
- Clerk webhook (`/api/webhook/clerk`) needs to be configured in Clerk dashboard with `user.created` event
- `CLERK_WEBHOOK_SECRET` needs to be added to Vercel env vars after webhook is configured
- No annual plan yet (could be added via Stripe MCP + lookup_key pattern)
- `/projects/demo` 404s — demo route removed; live demo deferred until product is more polished
- No project count limit for free users (only transcription/AI generation are gated)

## What the Owner Wants

Brae is building this as a low-maintenance SaaS. They want:
- Revenue-focused polish (conversion, retention, upgrade flows)
- Automated Stripe/billing wherever possible (Claude can use Stripe MCP)
- Minimal manual steps required from them
- Clean, dark, professional UI (existing color system via CSS variables)
- No unnecessary complexity — ship features that make money

## Environment Variables (all in Vercel + .env.local)

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk live keys
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard` / `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard`
- `CLERK_WEBHOOK_SECRET` — from Clerk dashboard after webhook setup
- `DATABASE_URL` — Neon pooler connection string
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `DEEPGRAM_API_KEY`
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`
