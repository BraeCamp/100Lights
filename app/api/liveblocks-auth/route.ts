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
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const [user, body] = await Promise.all([currentUser(), request.json()])
  const room: string = body?.room ?? ''
  if (!room) return new Response('Missing room', { status: 400 })

  const session = liveblocks.prepareSession(userId, {
    userInfo: {
      name: user?.fullName ?? user?.username ?? 'Collaborator',
      color: userColor(userId),
      imageUrl: user?.imageUrl ?? null,
    },
  })

  session.allow(room, session.FULL_ACCESS)
  const { body: token, status } = await session.authorize()
  return new Response(token, { status })
}
