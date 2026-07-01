import { getFlags } from '@/lib/platform-flags'

export const runtime = 'nodejs'
// Cache 60s so every page load isn't a DB hit
export const revalidate = 60

export async function GET() {
  const flags = await getFlags()
  return Response.json(flags)
}
