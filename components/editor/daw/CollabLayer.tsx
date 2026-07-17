'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Dispatch, RefObject } from 'react'
import { RoomProvider } from '@/lib/liveblocks.config'
import { CollabBridge, CollabAvatars, CollabSelfPresence, CollabOthersBridge } from './CollabPresence'
import { CollabInvite } from './CollabInvite'
import CollabChat from './CollabChat'
import type { DawAction } from '@/lib/daw-state'
import type { DawView, CollabPeer, DawProject } from '@/lib/daw-types'

// Everything Liveblocks lives behind this component so the collab bundle is
// only fetched for saved projects (AudioEditor imports it via dynamic()).

interface Props {
  projectId: string
  broadcastRef: RefObject<((action: DawAction) => void) | null>
  rawDispatch: Dispatch<DawAction>
  isRemoteRef: RefObject<boolean>
  projectRef: RefObject<DawProject>
  selectedTrackId: string | null
  selectedClipId: string | null
  editingClipId: string | null
  view: DawView
  onOthers: (peers: CollabPeer[]) => void
}

// Portals the avatars + invite button into the transport row's collab slot
// (Transport renders #transport-collab-slot at its right end) so collab UI
// shares the transport bar instead of occupying its own row.
function CollabTransportSlot({ projectId }: { projectId: string }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const find = () => {
      const el = document.getElementById('transport-collab-slot')
      if (el) setSlot(el)
      return !!el
    }
    if (find()) return
    // Transport may mount after this lazy-loaded layer — retry briefly
    const t = setInterval(() => { if (find()) clearInterval(t) }, 200)
    return () => clearInterval(t)
  }, [])

  if (!slot) return null
  return createPortal(
    <>
      <CollabAvatars />
      <CollabInvite projectId={projectId} />
    </>,
    slot,
  )
}

export default function CollabLayer({
  projectId, broadcastRef, rawDispatch, isRemoteRef, projectRef,
  selectedTrackId, selectedClipId, editingClipId, view, onOthers,
}: Props) {
  return (
    <RoomProvider
      id={`project-${projectId}`}
      initialPresence={{ name: '', color: '#3d8fef', imageUrl: null, selectedTrackId: null, selectedClipId: null, editingClipId: null, view: 'arrangement' }}
    >
      <CollabBridge broadcastRef={broadcastRef} rawDispatch={rawDispatch} isRemoteRef={isRemoteRef} projectRef={projectRef as React.MutableRefObject<DawProject>} />
      <CollabOthersBridge onOthers={onOthers} />
      <CollabChat />
      <CollabSelfPresence
        selectedTrackId={selectedTrackId}
        selectedClipId={selectedClipId}
        editingClipId={editingClipId}
        view={view}
      />
      <CollabTransportSlot projectId={projectId} />
    </RoomProvider>
  )
}
