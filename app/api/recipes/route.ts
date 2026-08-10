import { getIntegratedSpecs } from '@/lib/daw-recipes'

export const runtime = 'nodejs'

// Public read of the INTEGRATED recipes (admin-promoted from the Test Recipes panel). The client
// Sound Library merges these into its catalog like the built-in / community recipes. Candidates are
// NOT exposed here — only what an admin has explicitly integrated. Fails soft to an empty list.
export async function GET() {
  const recipes = await getIntegratedSpecs()
  return Response.json({ recipes }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } })
}
