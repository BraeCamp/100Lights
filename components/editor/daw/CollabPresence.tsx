'use client'

import { useEffect, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import {
  useOthers,
  useSelf,
  useBroadcastEvent,
  useEventListener,
  useUpdateMyPresence,
  type CollabPresence,
} from '@/lib/liveblocks.config'
import type { DawAction } from '@/lib/daw-state'
import type { DawProject } from '@/lib/daw-types'

// ── CollabBridge ─────────────────────────────────────────────────────────────
// Null-rendering component that wires Liveblocks broadcast ↔ local reducer.
// Must live inside RoomProvider.
//
// Late-join sync: broadcast events are fire-and-forget, so a client joining
// mid-session only has the last DB save. On join we broadcast SYNC_REQUEST;
// the connected peer with the lowest connectionId answers with SYNC_STATE
// carrying the full project, which the joiner applies as LOAD_PROJECT.

const SYNC_WINDOW_MS = 8000        // joiner accepts SYNC_STATE this long after mount
const SYNC_MAX_BYTES = 900_000     // stay under the broadcast payload limit
const FP_INTERVAL_MS = 20_000      // divergence check cadence
const FP_QUIET_MS    = 5_000       // only compare fingerprints when nobody is mid-edit

// Cheap structural fingerprint: enough to notice a dropped broadcast (missing
// clip, wrong note count, moved clip) without hashing every byte.
function projectFingerprint(p: DawProject): string {
  let h = 5381
  const mix = (s: string) => { for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0 }
  mix(String(p.tracks.length))
  for (const t of p.tracks) mix(t.id)
  mix(String(p.arrangementClips.length))
  for (const c of p.arrangementClips) {
    mix(`${c.id}:${c.startBeat}:${c.durationBeats}:${'notes' in c ? (c as { notes: unknown[] }).notes.length : 'a'}`)
  }
  // Content-level FX hash: a lost UPDATE_CLIP_EFFECT (params, duration,
  // automation graph) must trip the self-heal, not just count changes
  for (const e of p.clipEffects ?? []) {
    mix(`${e.id}:${e.startBeat}:${e.durationBeats}:${JSON.stringify(e.params)}:${e.automation ? JSON.stringify(e.automation.points) : ''}`)
  }
  mix(JSON.stringify(p.tempoMarkers ?? []))
  mix(JSON.stringify(p.sections ?? []))
  mix(JSON.stringify(p.comments ?? []))
  return h.toString(36)
}

interface BridgeProps {
  broadcastRef: React.MutableRefObject<((action: DawAction) => void) | null>
  rawDispatch: React.Dispatch<DawAction>
  isRemoteRef: React.MutableRefObject<boolean>
  projectRef: React.MutableRefObject<DawProject>
}

export function CollabBridge({ broadcastRef, rawDispatch, isRemoteRef, projectRef }: BridgeProps) {
  const broadcast = useBroadcastEvent()
  const self = useSelf()
  const others = useOthers()

  const selfIdRef = useRef<number | null>(null)
  const otherIdsRef = useRef<number[]>([])
  useEffect(() => { selfIdRef.current = self?.connectionId ?? null }, [self])
  useEffect(() => { otherIdsRef.current = others.map(o => o.connectionId) }, [others])

  // Accept a state snapshot only during the join window
  const awaitingSyncUntil = useRef<number>(0)
  useEffect(() => { awaitingSyncUntil.current = Date.now() + SYNC_WINDOW_MS }, [])

  // Self-healing: broadcasts are lossy — a dropped packet silently diverges a
  // client until reload. Peers exchange cheap state fingerprints during quiet
  // moments; a client that disagrees twice in a row re-requests the state.
  const lastActivityRef = useRef(0)
  const fpMismatchesRef = useRef(new Map<number, number>())

  useEffect(() => {
    broadcastRef.current = (action: DawAction) => {
      lastActivityRef.current = Date.now()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      broadcast({ type: 'ACTION', action } as any)
    }
    return () => { broadcastRef.current = null }
  }, [broadcast, broadcastRef])

  useEffect(() => {
    const jitter = Math.random() * 4000
    const iv = setInterval(() => {
      if (selfIdRef.current === null) return
      if (otherIdsRef.current.length === 0) return
      if (Date.now() - lastActivityRef.current < FP_QUIET_MS) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      broadcast({ type: 'STATE_FP', from: selfIdRef.current, fp: projectFingerprint(projectRef.current) } as any)
    }, FP_INTERVAL_MS + jitter)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Announce ourselves so an existing peer can send the live state.
  // Delay slightly so our connectionId and the peer list have settled.
  useEffect(() => {
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
      lastActivityRef.current = Date.now()
      // Dev-only fault injection so divergence recovery is testable:
      // set window.__collabDropNextAction = true and the next remote action
      // is silently discarded, exactly like a dropped packet.
      if (process.env.NODE_ENV !== 'production' && (window as unknown as { __collabDropNextAction?: boolean }).__collabDropNextAction) {
        ;(window as unknown as { __collabDropNextAction?: boolean }).__collabDropNextAction = false
        return
      }
      isRemoteRef.current = true
      rawDispatch(e.action)
      isRemoteRef.current = false
      return
    }

    if (e.type === 'STATE_FP' && typeof (e as { from?: number }).from === 'number') {
      const from = (e as { from: number }).from
      const theirFp = (e as { fp?: string }).fp
      const me = selfIdRef.current
      if (me === null || from === me) return
      if (Date.now() - lastActivityRef.current < FP_QUIET_MS) return
      const mine = projectFingerprint(projectRef.current)
      if (mine === theirFp) {
        fpMismatchesRef.current.delete(from)
        return
      }
      const misses = (fpMismatchesRef.current.get(from) ?? 0) + 1
      fpMismatchesRef.current.set(from, misses)
      // Two consecutive disagreements with a senior peer → we resync from the
      // room's authority (lowest connectionId answers SYNC_REQUEST).
      if (misses >= 2 && me > from) {
        fpMismatchesRef.current.delete(from)
        awaitingSyncUntil.current = Date.now() + SYNC_WINDOW_MS
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        broadcast({ type: 'SYNC_REQUEST', requesterId: me } as any)
      }
      return
    }

    // A new client joined: exactly one peer answers — the lowest connectionId
    // among everyone except the requester.
    if (e.type === 'SYNC_REQUEST' && typeof e.requesterId === 'number') {
      const me = selfIdRef.current
      if (me === null || me === e.requesterId) return
      const candidates = [me, ...otherIdsRef.current.filter(id => id !== e.requesterId)]
      if (Math.min(...candidates) !== me) return
      try {
        const json = JSON.stringify(projectRef.current)
        if (json.length > SYNC_MAX_BYTES) return  // too large for a broadcast — joiner keeps the DB state
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        broadcast({ type: 'SYNC_STATE', to: e.requesterId, project: JSON.parse(json) } as any)
      } catch { /* non-serializable state — skip */ }
      return
    }

    if (e.type === 'SYNC_STATE' && e.project && e.to === selfIdRef.current) {
      if (Date.now() > awaitingSyncUntil.current) return  // stale — we've been editing already
      awaitingSyncUntil.current = 0  // apply at most once
      // Looping is per-client — keep ours instead of adopting the sender's
      const mine = projectRef.current
      const project = { ...e.project, loopStart: mine.loopStart, loopEnd: mine.loopEnd, loopEnabled: mine.loopEnabled }
      isRemoteRef.current = true
      rawDispatch({ type: 'LOAD_PROJECT', project })
      isRemoteRef.current = false
    }
  })

  return null
}

// ── CollabSelfPresence ────────────────────────────────────────────────────────
// Syncs local Clerk user info + current UI state into Liveblocks presence.

export function CollabSelfPresence({ selectedTrackId, selectedClipId, editingClipId, view, getPlayhead }: {
  selectedTrackId: string | null
  selectedClipId: string | null
  editingClipId: string | null
  view: string
  getPlayhead?: () => number | null
}) {
  const { user } = useUser()
  const updatePresence = useUpdateMyPresence()

  // Playhead ghost: share where our transport is while playing (null = stopped).
  // 400ms is smooth enough for a "they're listening here" line without spam.
  useEffect(() => {
    if (!getPlayhead) return
    let last: number | null = null
    const iv = setInterval(() => {
      const beat = getPlayhead()
      if (beat === last) return
      last = beat
      updatePresence({ playheadBeat: beat })
    }, 400)
    return () => clearInterval(iv)
  }, [getPlayhead, updatePresence])

  // Sync user identity once on mount / user change
  useEffect(() => {
    if (!user) return
    updatePresence({
      name: user.fullName ?? user.username ?? 'You',
      color: userColorFromId(user.id),
      imageUrl: user.imageUrl ?? null,
    })
  }, [user, updatePresence])

  // Sync selection/view on change
  useEffect(() => {
    updatePresence({ selectedTrackId, selectedClipId, editingClipId, view })
  }, [selectedTrackId, selectedClipId, editingClipId, view, updatePresence])

  return null
}

// ── CollabOthersBridge ────────────────────────────────────────────────────────
// Mirrors other users' presence into plain React state so components outside
// the RoomProvider (clips, track heads) can render who is holding what.

export function CollabOthersBridge({ onOthers }: {
  onOthers: (peers: import('@/lib/daw-types').CollabPeer[]) => void
}) {
  const others = useOthers()
  useEffect(() => {
    onOthers(others.map(o => {
      const p = o.presence as CollabPresence
      return {
        connectionId: o.connectionId,
        name: p?.name || 'Collaborator',
        color: p?.color || '#a78bfa',
        selectedTrackId: p?.selectedTrackId ?? null,
        selectedClipId: p?.selectedClipId ?? null,
        editingClipId: p?.editingClipId ?? null,
        playheadBeat: p?.playheadBeat ?? null,
      }
    }))
  }, [others, onOthers])
  // Clear on unmount (room left)
  useEffect(() => () => onOthers([]), [onOthers])
  return null
}

// ── CollabAvatars ─────────────────────────────────────────────────────────────
// Stacked avatar row showing connected collaborators.

export function CollabAvatars() {
  const others = useOthers()
  const self = useSelf()

  if (others.length === 0) return null

  const all = [
    ...(self ? [{ id: self.id, presence: self.presence as CollabPresence }] : []),
    ...others.map(o => ({ id: o.id, presence: o.presence as CollabPresence })),
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      {all.slice(0, 5).map(({ id, presence }) => (
        <Avatar key={id} presence={presence} isSelf={id === self?.id} />
      ))}
      {all.length > 5 && (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', fontSize: 9, fontWeight: 700,
          background: '#333', color: '#999', border: '1.5px solid #444',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          +{all.length - 5}
        </div>
      )}
    </div>
  )
}

function Avatar({ presence, isSelf }: { presence: CollabPresence; isSelf: boolean }) {
  const name = presence?.name ?? '?'
  const color = presence?.color ?? '#555'
  const imageUrl = presence?.imageUrl

  return (
    <div title={name + (isSelf ? ' (you)' : '')} style={{ position: 'relative', flexShrink: 0 }}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl} alt={name}
          style={{
            width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
            border: `2px solid ${isSelf ? 'var(--accent)' : color}`,
            opacity: isSelf ? 0.7 : 1,
          }}
        />
      ) : (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', fontSize: 9, fontWeight: 700,
          background: color, color: '#fff', border: `2px solid ${isSelf ? 'var(--accent)' : color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: isSelf ? 0.7 : 1,
        }}>
          {name.slice(0, 2).toUpperCase()}
        </div>
      )}
    </div>
  )
}

function userColorFromId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 65%, 58%)`
}
