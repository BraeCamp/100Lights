'use client'

import type { Dispatch, RefObject } from 'react'
import { RoomProvider } from '@/lib/liveblocks.config'
import { CollabBridge, CollabAvatars, CollabSelfPresence, CollabOthersBridge } from './CollabPresence'
import { CollabInvite } from './CollabInvite'
import type { DawAction } from '@/lib/daw-state'
import type { DawView, CollabPeer } from '@/lib/daw-types'

// Everything Liveblocks lives behind this component so the collab bundle is
// only fetched for saved projects (AudioEditor imports it via dynamic()).

interface Props {
  projectId: string
  broadcastRef: RefObject<((action: DawAction) => void) | null>
  rawDispatch: Dispatch<DawAction>
  isRemoteRef: RefObject<boolean>
  selectedTrackId: string | null
  selectedClipId: string | null
  editingClipId: string | null
  view: DawView
  onOthers: (peers: CollabPeer[]) => void
}

export default function CollabLayer({
  projectId, broadcastRef, rawDispatch, isRemoteRef,
  selectedTrackId, selectedClipId, editingClipId, view, onOthers,
}: Props) {
  return (
    <RoomProvider
      id={`project-${projectId}`}
      initialPresence={{ name: '', color: '#3d8fef', imageUrl: null, selectedTrackId: null, selectedClipId: null, editingClipId: null, view: 'arrangement' }}
    >
      <CollabBridge broadcastRef={broadcastRef} rawDispatch={rawDispatch} isRemoteRef={isRemoteRef} />
      <CollabOthersBridge onOthers={onOthers} />
      <CollabSelfPresence
        selectedTrackId={selectedTrackId}
        selectedClipId={selectedClipId}
        editingClipId={editingClipId}
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
