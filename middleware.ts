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
  '/projects(.*)',
  '/apps/(.*)',
  '/settings',
  '/trash',
  '/download',
  '/learn(.*)',
  '/tools(.*)',
  '/api/learn-audio',
  '/legal/(.*)',
  '/community(.*)',
  '/inspector',
  '/assistant',
  '/api/community(.*)',
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
