'use client'

import type { Dispatch, RefObject } from 'react'
import { RoomProvider } from '@/lib/liveblocks.config'
import { CollabBridge, CollabAvatars, CollabSelfPresence } from './CollabPresence'
import { CollabInvite } from './CollabInvite'
import type { DawAction } from '@/lib/daw-state'
import type { DawView } from '@/lib/daw-types'

// Everything Liveblocks lives behind this component so the collab bundle is
// only fetched for saved projects (AudioEditor imports it via dynamic()).

interface Props {
  projectId: string
  broadcastRef: RefObject<((action: DawAction) => void) | null>
  rawDispatch: Dispatch<DawAction>
  isRemoteRef: RefObject<boolean>
  selectedTrackId: string | null
  selectedClipId: string | null
  view: DawView
}

export default function CollabLayer({
  projectId, broadcastRef, rawDispatch, isRemoteRef,
  selectedTrackId, selectedClipId, view,
}: Props) {
  return (
    <RoomProvider
      id={`project-${projectId}`}
      initialPresence={{ name: '', color: '#3d8fef', imageUrl: null, selectedTrackId: null, selectedClipId: null, view: 'arrangement' }}
    >
      <CollabBridge broadcastRef={broadcastRef} rawDispatch={rawDispatch} isRemoteRef={isRemoteRef} />
      <CollabSelfPresence
        selectedTrackId={selectedTrackId}
        selectedClipId={selectedClipId}
        view={view}
      />
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 8, padding: '4px 10px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', minHeight: 32, flexShrink: 0,
      }}>
        <CollabAvatars />
        <CollabInvite projectId={projectId} />
      </div>
    </RoomProvider>
  )
}
