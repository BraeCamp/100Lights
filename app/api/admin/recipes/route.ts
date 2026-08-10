import { isAdmin } from '@/lib/admin-auth'
import { logAdmin } from '@/lib/admin-audit'
import { listRecipes, addCandidate, integrateRecipe, unintegrateRecipe, deleteRecipe, type DawRecipe } from '@/lib/daw-recipes'

export const runtime = 'nodejs'

// Admin-only management of the "Test Recipes" pipeline. Every action is gated on the admin email
// (braedancampbell@gmail.com) — only Brae sees or edits the candidate list.

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ recipes: await listRecipes() })
}

export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { action?: string; id?: string; recipe?: Omit<DawRecipe, 'status' | 'createdAt' | 'integratedAt'> }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, id, recipe } = body
  try {
    switch (action) {
      case 'add':
        if (!recipe?.id || !recipe.spec) return Response.json({ error: 'Missing recipe id/spec' }, { status: 400 })
        await addCandidate(recipe)
        break
      case 'integrate':
        if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
        await integrateRecipe(id)
        await logAdmin('recipe.integrate', id)
        break
      case 'unintegrate':
        if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
        await unintegrateRecipe(id)
        await logAdmin('recipe.unintegrate', id)
        break
      case 'delete':
        if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
        await deleteRecipe(id)
        await logAdmin('recipe.delete', id)
        break
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
  return Response.json({ recipes: await listRecipes() })
}
