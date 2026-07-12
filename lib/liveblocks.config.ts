'use client'

import { createClient } from '@liveblocks/client'
import { createRoomContext } from '@liveblocks/react'

export type CollabPresence = {
  name: string
  color: string
  imageUrl: string | null
  selectedTrackId: string | null
  selectedClipId: string | null
  /** Clip currently open in this user's piano roll — a soft edit lock */
  editingClipId: string | null
  view: string
}

const client = createClient({
  authEndpoint: '/api/liveblocks-auth',
})

export const {
  RoomProvider,
  useUpdateMyPresence,
  useOthers,
  useBroadcastEvent,
  useEventListener,
  useSelf,
} = createRoomContext<CollabPresence>(client)
