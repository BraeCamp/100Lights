'use client'

import { useEffect, useRef } from 'react'
import { RoomProvider, useBroadcastEvent, useEventListener, useOthers, useSelf } from '@/lib/liveblocks.config'
import { reducer, type DawAction } from '@/lib/daw-state'
import type { DawProject } from '@/lib/daw-types'

/**
 * Live audio→video link. Joins the project's existing DAW collab room
 * (`project-<id>`) as a silent peer, keeps a faithful DawProject replica by
 * applying the same broadcast actions through the same reducer the DAW uses,
 * and tells the video editor whenever the audio changed — which debounces
 * into a re-bounce of the linked DAW-mix track. Speaks the room's full sync
 * protocol (SYNC_REQUEST on join, answers as authority when lowest id) so it
 * never degrades the DAW peers' own consistency machinery.
 *
 * Loaded dynamically by VideoEditor only when the project carries a
 * dawProject, mirroring how AudioEditor lazy-loads its CollabLayer.
 */

// Mirrors CollabPresence's protocol constants.
const SYNC_WINDOW_MS = 8000
const SYNC_MAX_BYTES = 900_000

interface Props {
  projectId: string
  getProject: () => DawProject | null
  /** Called with the updated replica. `live` is false for the initial full-state adoption. */
  onProject: (project: DawProject, live: boolean) => void
}

function SyncBridge({ getProject, onProject }: Omit<Props, 'projectId'>) {
  const broadcast = useBroadcastEvent()
  const selfId = useSelf(me => me.connectionId)
  const otherIds = useOthers(others => others.map(o => o.connectionId))

  const selfIdRef = useRef<number | null>(null)
  const otherIdsRef = useRef<number[]>([])
  const awaitingSyncUntil = useRef(0)
  useEffect(() => { selfIdRef.current = selfId ?? null }, [selfId])
  useEffect(() => { otherIdsRef.current = otherIds }, [otherIds])

  // Announce ourselves so a live DAW peer can hand us its CURRENT (possibly
  // unsaved) state — fresher than the cfproj we loaded from the database.
  useEffect(() => {
    awaitingSyncUntil.current = Date.now() + SYNC_WINDOW_MS
    const t = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      broadcast({ type: 'SYNC_REQUEST', requesterId: selfIdRef.current } as any)
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEventListener(({ event }) => {
    const e = event as { type?: string; action?: DawAction; requesterId?: number; to?: number; project?: DawProject }

    if (e.type === 'ACTION' && e.action) {
      const current = getProject()
      if (!current) return
      try {
        onProject(reducer(current, e.action), true)
      } catch { /* unknown/hostile action — replica keeps its last good state */ }
      return
    }

    // A new client joined: exactly one peer answers — the lowest connectionId
    // among everyone except the requester (same rule as the DAW peers).
    if (e.type === 'SYNC_REQUEST' && typeof e.requesterId === 'number') {
      const me = selfIdRef.current
      if (me === null || me === e.requesterId) return
      const candidates = [me, ...otherIdsRef.current.filter(id => id !== e.requesterId)]
      if (Math.min(...candidates) !== me) return
      const project = getProject()
      if (!project) return
      try {
        const json = JSON.stringify(project)
        if (json.length > SYNC_MAX_BYTES) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        broadcast({ type: 'SYNC_STATE', to: e.requesterId, project: JSON.parse(json) } as any)
      } catch { /* non-serializable — skip */ }
      return
    }

    if (e.type === 'SYNC_STATE' && e.project && e.to === selfIdRef.current) {
      if (Date.now() > awaitingSyncUntil.current) return
      awaitingSyncUntil.current = 0
      onProject(e.project, false)
    }
  })

  return null
}

export default function DawMixSync({ projectId, getProject, onProject }: Props) {
  return (
    <RoomProvider
      id={`project-${projectId}`}
      initialPresence={{ name: '', color: 'var(--accent)', imageUrl: null, selectedTrackId: null, selectedClipId: null, editingClipId: null, view: 'video' }}
    >
      <SyncBridge getProject={getProject} onProject={onProject} />
    </RoomProvider>
  )
}
