import { auth } from '@clerk/nextjs/server'
import { activeAnnouncements } from '@/lib/announcements'
import { getSubscription } from '@/lib/subscription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/announcements — the active banners this viewer should see, filtered
// by plan audience and time window. Cheap and best-effort: any failure returns
// an empty list so the banner never breaks a page.
export async function GET() {
  try {
    const { userId } = await auth()
    let plan: 'free' | 'pro' | null = null
    if (userId) {
      try { plan = (await getSubscription(userId)).plan } catch { plan = 'free' }
    }
    const announcements = await activeAnnouncements(plan)
    return Response.json({ announcements }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ announcements: [] })
  }
}
