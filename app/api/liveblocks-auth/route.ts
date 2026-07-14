import { auth, currentUser } from '@clerk/nextjs/server'
import { Liveblocks } from '@liveblocks/node'

const liveblocks = new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY! })

// Derive a stable hue from a string so each user gets a consistent color
function userColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 65%, 58%)`
}

export async function POST(request: Request) {
  const { userId } = await auth()

  // DEV_OPEN=1 (headless testing, mirrors middleware.ts): allow synthetic
  // collaborators via x-test-user so multi-client tests can join rooms
  // without two Clerk sessions. Never active in production builds.
  const testUser = process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? request.headers.get('x-test-user')
    : null

  if (!userId && !testUser) return new Response('Unauthorized', { status: 401 })

  const [user, body] = await Promise.all([userId ? currentUser() : null, request.json()])
  const room: string = body?.room ?? ''
  if (!room) return new Response('Missing room', { status: 400 })

  const effectiveId = userId ?? `test:${testUser}`
  const session = liveblocks.prepareSession(effectiveId, {
    userInfo: {
      name: user?.fullName ?? user?.username ?? (testUser ? `Test ${testUser}` : 'Collaborator'),
      color: userColor(effectiveId),
      imageUrl: user?.imageUrl ?? null,
    },
  })

  // Room-scoped access: owners and paid members edit, others read,
  // strangers are rejected. Test users keep full access for the harness.
  const projectId = room.startsWith('project-') ? room.slice('project-'.length) : null
  if (testUser && !userId) {
    session.allow(room, session.FULL_ACCESS)
  } else if (projectId) {
    const { getProjectAccess } = await import('@/lib/project-access')
    const { access } = await getProjectAccess(projectId, userId, user?.emailAddresses?.[0]?.emailAddress ?? null)
    if (!access) return new Response('Forbidden', { status: 403 })
    session.allow(room, access === 'view' ? session.READ_ACCESS : session.FULL_ACCESS)
  } else {
    session.allow(room, session.FULL_ACCESS)
  }
  const { body: token, status } = await session.authorize()
  return new Response(token, { status })
}
