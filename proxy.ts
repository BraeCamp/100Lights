import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/share/(.*)',
  '/api/webhooks/(.*)',
  '/api/webhook/(.*)',
  '/api/share/(.*)',
  '/api/platform-flags',
  '/api/guest/:token/time',
  '/api/guest/:token',
  '/api/guest/:token/presign',
  '/api/guest/:token/confirm',
  '/guest/:token',
  '/dashboard',
  '/new',
  '/projects',
  '/projects/(.*)',
  // Canonical pretty project + profile URLs (/@user and /@user/slug-code). These
  // were the only project routes still behind auth (while /projects/(.*) is
  // public), so opening a project via its canonical URL could 404 in production.
  // Access is enforced downstream by /api/projects/[id], same as /projects/{id}.
  '/@(.*)',
  '/apps/(.*)',
  '/settings',
  '/trash',
  '/download',
  '/m',
  '/learn(.*)',
  '/tools(.*)',
  '/audio-check',
  '/api/learn-audio',
  '/legal/(.*)',
  '/community',
  '/community/(.*)',
  '/embed/(.*)',
  '/inspector',
  '/assistant',
  '/api/community',
  '/api/community/(.*)',
  // Broadcast: the streamer boxes + worker agents + the public Always-On page hit these with NO
  // Clerk session, so they must be public. Each still enforces its own gate downstream (playlist/
  // audio/live/stations are genuinely public; agent/sync + provision check BROADCAST_AGENT_TOKEN /
  // CRON_SECRET). Admin broadcast controls live under /api/admin/broadcast/* and stay protected.
  '/api/broadcast/(.*)',
  // Crawler files. Also excluded from the matcher below, so middleware never
  // runs on them — listed here too so they stay public if that changes.
  '/sitemap.xml',
  '/robots.txt',
])

export default clerkMiddleware(async (auth, request) => {
  // DEV_OPEN=1 lets headless tools see the app without a session — never set in production
  if (process.env.DEV_OPEN === '1') return
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // `xml` and `txt` matter: without them /sitemap.xml and /robots.txt fall
    // through to auth.protect() and 404 for signed-out visitors — which means
    // every crawler, so neither file was ever reachable by Google.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jte|ttf|woff2?|png|jpg|jpeg|gif|svg|ico|webp|xml|txt)).*)',
    '/(api|trpc)(.*)',
  ],
}
