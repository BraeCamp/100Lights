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
  '/legal/(.*)',
  '/community(.*)',
  '/inspector',
  '/assistant',
  '/api/community(.*)',
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
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jte|ttf|woff2?|png|jpg|jpeg|gif|svg|ico|webp)).*)',
    '/(api|trpc)(.*)',
  ],
}
