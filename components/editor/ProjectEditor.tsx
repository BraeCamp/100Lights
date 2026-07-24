'use client'

/**
 * ProjectEditor — module routing shell.
 *
 * Rules:
 * - NOTHING is imported statically. Every editor is lazy via next/dynamic so
 *   its bundle is only downloaded when that module is actually active.
 * - When `projectId` is provided the API response owns the module list.
 *   The `modules` prop is only the initial fallback while loading.
 * - When no `projectId` (new project): `modules` prop is the source of truth.
 * - Old projects without a saved `modules` field fall back to ['video'] so
 *   they keep working exactly as before.
 * - AudioEditor tracks are uploaded to R2 and stored in `audioMedia[]`.
 *   When video module is activated with new/updated audio tracks, a sync
 *   modal prompts the user to merge them into the video media library.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@clerk/nextjs'
import dynamic from 'next/dynamic'
import type { Caption, Output } from '@/lib/types'
import type { ModuleKey, AudioTrackInit } from '@/lib/editor-types'
import { ALL_MODULE_KEYS, MODULE_DEFS, DEFAULT_ADJUSTMENTS } from '@/lib/editor-types'
import type { CfProjFile, SerializedAudioMedia, SerializedMedia } from '@/lib/project-serializer'
import type { DawProject } from '@/lib/daw-types'
import { SmallScreenGate } from './SmallScreenGate'
import StudioGuide from './StudioGuide'
import SuggestionsReview from './SuggestionsReview'
import type { AudioTrack } from './AudioEditor'

// ── All editors are lazy. None load until their module is active. ─────────

const VideoEditor = dynamic(
  () => import('./VideoEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading video editor…" /> }
)


const AudioEditor = dynamic(
  () => import('./AudioEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading audio editor…" /> }
)

const TranscriptEditor = dynamic(
  () => import('./TranscriptEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading transcript editor…" /> }
)

const ImageEditor = dynamic(
  () => import('./ImageEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading image editor…" /> }
)

// ── Shared spinner ────────────────────────────────────────────

function EditorSpinner({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-base)', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
      {label}
    </div>
  )
}

// ── Types ────────────────────────────────────────────────────

export interface ProjectEditorProps {
  projectId?: string
  projectName: string
  modules?: ModuleKey[]
  allowImport?: boolean
  /** Community starter item id — its shared dawProject seeds this new project. */
  starterId?: string
  /** Load a committed demo project from /tutorial/_fixtures/<id>.json as the
   *  starting state (used by the tutorial capture pipeline for a realistic
   *  WIP backdrop). Static, same-origin, id-restricted — safe. */
  fixtureId?: string
  audioMode?: 'music' | 'podcast'
}

interface SyncItem {
  audioMedia: SerializedAudioMedia
  status: 'new' | 'updated'
}

// ── Helpers ──────────────────────────────────────────────────

function deserializeOutputs(raw: CfProjFile['outputs'] = []): Output[] {
  return raw.map(o => ({
    id: o.id,
    type: o.type as Output['type'],
    title: o.title,
    content: o.content,
    wordCount: o.wordCount,
    createdAt: new Date(o.createdAt),
    captions: o.captions,
  }))
}

async function resolveAudioMediaToTracks(items: SerializedAudioMedia[]): Promise<AudioTrack[]> {
  return Promise.all(items.map(async (am) => {
    let url = ''
    try {
      const res = await fetch(`/api/media/signed-url?key=${encodeURIComponent(am.r2Key)}`)
      if (res.ok) {
        const { url: signed } = await res.json() as { url: string }
        url = signed
      }
    } catch { }
    return {
      id: am.id,
      name: am.name,
      url,
      duration: am.duration,
      contentType: am.contentType,
      r2Key: am.r2Key,
      uploadStatus: 'uploaded' as const,
      savedAt: am.savedAt,
    }
  }))
}

function computeSyncItems(audioMedia: SerializedAudioMedia[], videoMedia: SerializedMedia[]): SyncItem[] {
  const result: SyncItem[] = []
  for (const am of audioMedia) {
    if (!am.r2Key) continue
    const existing = videoMedia.find(m => m.name === am.name)
    if (!existing) {
      result.push({ audioMedia: am, status: 'new' })
    } else if (existing.r2Key !== am.r2Key) {
      result.push({ audioMedia: am, status: 'updated' })
    }
  }
  return result
}

// ── Resizable split-pane ──────────────────────────────────────

function SplitLayout({ left, right, defaultSplit = 360 }: {
  left: React.ReactNode
  right: React.ReactNode
  defaultSplit?: number
}) {
  const [leftW, setLeftW] = useState(defaultSplit)

  const onDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    let last = e.clientX
    const onMove = (ev: PointerEvent) => { setLeftW(w => Math.max(240, Math.min(720, w + ev.clientX - last))); last = ev.clientX }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: leftW, flexShrink: 0, overflow: 'hidden', minWidth: 0 }}>{left}</div>
      <div
        onPointerDown={onDrag}
        style={{ width: 4, cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid var(--border)', flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--accent)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      />
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>{right}</div>
    </div>
  )
}

// ── Audio → Video sync modal ──────────────────────────────────

function AudioSyncModal({
  items,
  onConfirm,
  onSkip,
}: {
  items: SyncItem[]
  onConfirm: (selected: SerializedAudioMedia[]) => Promise<void>
  onSkip: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map(i => i.audioMedia.id)))
  const [saving, setSaving] = useState(false)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function confirm() {
    setSaving(true)
    const picked = items.filter(i => selected.has(i.audioMedia.id)).map(i => i.audioMedia)
    await onConfirm(picked)
  }

  const MODULE_COLOR = MODULE_DEFS.find(m => m.key === 'audio')!.color

  return (
    <div
className="electron-nodrag"
style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 28, maxWidth: 440, width: '90%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: MODULE_COLOR, flexShrink: 0 }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Sync Audio to Video
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
          Your Audio module has tracks that aren't in the Video module yet. Add them to the Video media library so you can place them on the timeline.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
          {items.map(item => (
            <label
              key={item.audioMedia.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 7,
                border: `1px solid ${selected.has(item.audioMedia.id) ? 'var(--accent)' : 'var(--border)'}`,
                background: selected.has(item.audioMedia.id) ? 'var(--accent-subtle)' : 'var(--bg-card)',
                cursor: 'pointer', transition: 'border-color 0.1s, background 0.1s',
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(item.audioMedia.id)}
                onChange={() => toggle(item.audioMedia.id)}
                style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.audioMedia.name}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: item.status === 'new' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                color: item.status === 'new' ? '#10b981' : '#f59e0b',
                flexShrink: 0, letterSpacing: '0.06em',
              }}>
                {item.status === 'new' ? 'NEW' : 'UPDATED'}
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onSkip}
            disabled={saving}
            style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}
          >
            Skip
          </button>
          <button
            onClick={confirm}
            disabled={saving || selected.size === 0}
            style={{
              padding: '9px 18px', borderRadius: 7, border: 'none',
              background: selected.size === 0 ? 'var(--border)' : 'var(--accent)',
              color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: selected.size === 0 || saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {saving && <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />}
            Add to Video Library
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────

export default function ProjectEditor({ projectId, projectName, modules: moduleProp, allowImport, audioMode: audioModeProp, starterId, fixtureId }: ProjectEditorProps) {
  const isNewProject = !projectId
  const [activeModules, setActiveModules] = useState<ModuleKey[] | null>(
    isNewProject ? (moduleProp ?? ['video']) : null
  )
  const [captions, setCaptions]         = useState<Caption[]>([])
  const [outputs, setOutputs]           = useState<Output[]>([])
  const [savedData, setSavedData]       = useState<CfProjFile | null>(null)
  const [starterProject, setStarterProject] = useState<DawProject | null>(null)
  const [starterLoading, setStarterLoading] = useState(!!starterId || !!fixtureId)
  useEffect(() => {
    if (!starterId) return
    let alive = true
    fetch(`/api/community/${starterId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { item?: { kind?: string; payload?: { dawProject?: DawProject } } } | null) => {
        if (!alive) return
        if (d?.item?.kind === 'project' && d.item.payload?.dawProject) setStarterProject(d.item.payload.dawProject)
        setStarterLoading(false)
      })
      .catch(() => { if (alive) setStarterLoading(false) })
    return () => { alive = false }
  }, [starterId])
  useEffect(() => {
    if (!fixtureId || !/^[a-z0-9-]+$/.test(fixtureId)) return
    let alive = true
    fetch(`/tutorial-fixtures/${fixtureId}.json`)
      .then(r => r.ok ? r.json() : null)
      .then((p: DawProject | null) => { if (alive && p) setStarterProject(p); if (alive) setStarterLoading(false) })
      .catch(() => { if (alive) setStarterLoading(false) })
    return () => { alive = false }
  }, [fixtureId])
  const [localName, setLocalName]       = useState(projectName)
  const [currentTime, setCurrentTime]   = useState(0)
  const [audioMedia, setAudioMedia]     = useState<SerializedAudioMedia[]>([])
  const [moduleSavedAt, setModuleSavedAt] = useState<Partial<Record<ModuleKey, string>>>({})
  const [initAudioTracks, setInitAudioTracks] = useState<AudioTrack[]>([])
  const [audioMode, setAudioMode]           = useState<'music' | 'podcast' | undefined>(audioModeProp)
  const [podcastMeta, setPodcastMeta]       = useState<import('@/lib/project-serializer').PodcastMeta | undefined>(undefined)
  const [pendingModules, setPendingModules] = useState<ModuleKey[] | null>(null)
  const [syncItems, setSyncItems]       = useState<SyncItem[] | null>(null)
  const savedProjectId = useRef(projectId ?? crypto.randomUUID())
  // Becomes the real id after the first save of a /new session, so id-gated
  // features (collab room, Share) come alive without a remount
  const [liveProjectId, setLiveProjectId] = useState<string | undefined>(projectId)
  // False when this project was opened via an invite link (not the owner):
  // edits sync live through the room, but persistence belongs to the owner.
  const [isOwner, setIsOwner] = useState(true)
  const [viewOnly, setViewOnly] = useState(false)
  // Why the project couldn't load — never silently fall back to another module
  const [loadError, setLoadError] = useState<'unauthenticated' | 'no-access' | 'error' | null>(null)
  const { isLoaded: authLoaded, isSignedIn } = useAuth()

  // ── Load project from API ──────────────────────────────────
  // Waits for Clerk (a fetch fired before the session token is ready 401s),
  // retries transient failures, and surfaces access problems as a screen —
  // a failed load must never silently open a different module.
  useEffect(() => {
    if (isNewProject || !authLoaded) return
    let alive = true

    async function fetchProject(): Promise<Response> {
      let res = await fetch(`/api/projects/${projectId}`)
      // 401 right after page load is usually the session token still settling
      for (let attempt = 0; !res.ok && res.status === 401 && attempt < 2; attempt++) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
        res = await fetch(`/api/projects/${projectId}`)
      }
      return res
    }

    async function applyLoaded(data: CfProjFile) {
      if (!alive) return
      if ((data as CfProjFile & { _isOwner?: boolean })._isOwner === false) setIsOwner(false)
      if ((data as CfProjFile & { _access?: string })._access === 'view') setViewOnly(true)
      setSavedData(data)
      setLocalName(data.name)
      setCaptions(data.captions ?? [])
      setOutputs(deserializeOutputs(data.outputs))
      setAudioMedia(data.audioMedia ?? [])
      setModuleSavedAt(data.moduleSavedAt ?? {})
      if (data.audioMode) setAudioMode(data.audioMode)
      if (data.podcastMeta) setPodcastMeta(data.podcastMeta)
      // Resolve audio media to playable URLs before AudioEditor mounts
      if (data.audioMedia?.length) {
        const tracks = await resolveAudioMediaToTracks(data.audioMedia)
        if (!alive) return
        setInitAudioTracks(tracks)
      }
      setLoadError(null)
      setActiveModules(data.modules ?? ['video'])
    }

    // A .cfproj opened from disk is stashed here by the projects page. Consume it
    // so local projects — audio DAW included — open without a cloud round-trip
    // (mirrors the video editor path). Hitting Save then persists it to the account.
    try {
      const stashKey = `cf_pending_cfproj_${projectId}`
      const stashed = localStorage.getItem(stashKey)
      if (stashed) {
        localStorage.removeItem(stashKey)
        void applyLoaded(JSON.parse(stashed) as CfProjFile)
        return () => { alive = false }
      }
    } catch { /* fall through to cloud fetch */ }

    fetchProject()
      .then(async r => {
        if (!alive) return
        if (!r.ok) {
          if (r.status === 401 && !isSignedIn) setLoadError('unauthenticated')
          else if (r.status === 401 || r.status === 403 || r.status === 404) setLoadError('no-access')
          else setLoadError('error')
          return
        }
        await applyLoaded(await r.json())
      })
      .catch(() => { if (alive) setLoadError('error') })
    return () => { alive = false }
  }, [projectId, authLoaded]) // eslint-disable-line

  // ── Save ──────────────────────────────────────────────────
  // Demo projects (no projectId, allowImport=false) are read-only — never persisted
  const isDemo = !projectId && !allowImport

  type SavePatch = {
    name?: string
    outputs?: Output[]
    captions?: Caption[]
    modules?: ModuleKey[]
    audioMedia?: SerializedAudioMedia[]
    moduleSavedAt?: Partial<Record<ModuleKey, string>>
    audioMode?: 'music' | 'podcast'
    podcastMeta?: import('@/lib/project-serializer').PodcastMeta
    dawProject?: import('@/lib/daw-types').DawProject
  }
  // The serialized project blob — shared by Save and "Suggest changes".
  function buildCfProj(patch: SavePatch): CfProjFile {
    const outs = patch.outputs ?? outputs
    return {
      _type: '100lights-project',
      version: 1,
      id: savedProjectId.current,
      name: patch.name ?? localName,
      savedAt: new Date().toISOString(),
      tracks:      savedData?.tracks      ?? [],
      clips:       savedData?.clips       ?? [],
      adjustments: savedData?.adjustments ?? DEFAULT_ADJUSTMENTS,
      zoomLevel:   savedData?.zoomLevel   ?? 1,
      captions:    patch.captions ?? captions,
      outputs:     outs.map(o => ({
        id: o.id, type: o.type, title: o.title, content: o.content,
        wordCount: o.wordCount, createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
        captions: o.captions,
      })),
      media:       savedData?.media ?? [],
      audioMedia:  patch.audioMedia ?? audioMedia,
      moduleSavedAt: patch.moduleSavedAt ? { ...moduleSavedAt, ...patch.moduleSavedAt } : moduleSavedAt,
      modules:     patch.modules ?? activeModules ?? ['video'],
      audioMode:   patch.audioMode ?? savedData?.audioMode,
      podcastMeta: patch.podcastMeta ?? savedData?.podcastMeta,
      dawProject:  patch.dawProject ?? savedData?.dawProject,
    }
  }

  async function save(patch: SavePatch) {
    const name    = patch.name    ?? localName
    const outs    = patch.outputs ?? outputs
    const caps    = patch.captions ?? captions
    const mods    = patch.modules ?? activeModules ?? ['video']
    const am      = patch.audioMedia ?? audioMedia
    const msat    = patch.moduleSavedAt ? { ...moduleSavedAt, ...patch.moduleSavedAt } : moduleSavedAt

    const project = buildCfProj(patch)

    if (isDemo) return
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    })
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const body = await res.json()
        if (body?.error) detail = body.error
      } catch { /* ignore parse errors */ }
      throw new Error(detail)
    }
    setLocalName(name)
    if (patch.outputs)      setOutputs(outs)
    if (patch.captions)     setCaptions(caps)
    if (patch.audioMedia)   setAudioMedia(am)
    if (patch.moduleSavedAt) setModuleSavedAt(msat)
    // Keep savedData.media in sync so subsequent saves don't overwrite with stale data
    if (patch.audioMedia || patch.modules) {
      setSavedData(prev => prev ? { ...prev, audioMedia: am, modules: mods, moduleSavedAt: msat } : prev)
    }
    if (patch.dawProject) {
      setSavedData(prev => prev ? { ...prev, dawProject: patch.dawProject } : prev)
    }

    // First save of a /new session: put the project's real URL in the bar so
    // refreshing or sharing the link lands on the saved project. No remount —
    // just the address (the editor keeps its in-memory state).
    if (!projectId && typeof window !== 'undefined' && window.location.pathname === '/new') {
      window.history.replaceState(null, '', `/projects/${savedProjectId.current}`)
    }
    if (!projectId) setLiveProjectId(savedProjectId.current)
  }

  function commitName(name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed === localName) return
    setLocalName(trimmed)
    if (!isOwner) return  // collaborators rename locally only
    save({ name: trimmed }).catch(() => {})
    if (projectId) {
      fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      }).catch(() => {})
    }
  }

  // ── Module change handler (all editors) ───────────────────
  async function handleModulesChange(newModules: ModuleKey[]) {
    const hadVideo = (activeModules ?? []).includes('video')
    const willHaveVideo = newModules.includes('video')

    // When transitioning into video and there are audio tracks to sync, show modal
    if (!hadVideo && willHaveVideo && audioMedia.length > 0) {
      const currentVideoMedia = savedData?.media ?? []
      const toSync = computeSyncItems(audioMedia, currentVideoMedia)
      if (toSync.length > 0) {
        setPendingModules(newModules)
        setSyncItems(toSync)
        return   // modal takes over — don't switch yet
      }
    }

    // Normal module change: save new modules and switch
    setActiveModules(newModules)
    save({ modules: newModules }).catch(() => {})
  }

  // ── Sync modal callbacks ──────────────────────────────────
  async function handleSyncConfirm(selected: SerializedAudioMedia[]) {
    if (!pendingModules) return
    // Merge selected audio tracks into video media library
    const existingMedia = savedData?.media ?? []
    const merged: SerializedMedia[] = [...existingMedia]
    for (const am of selected) {
      const idx = merged.findIndex(m => m.name === am.name)
      const entry: SerializedMedia = {
        id: am.id,
        name: am.name,
        contentType: 'audio' as import('@/lib/types').ContentType,
        duration: am.duration,
        r2Key: am.r2Key,
      }
      if (idx >= 0) merged[idx] = entry
      else merged.push(entry)
    }
    const now = new Date().toISOString()
    const updatedSavedData: CfProjFile = {
      ...(savedData ?? {
        _type: '100lights-project', version: 1,
        id: savedProjectId.current, name: localName, savedAt: now,
        tracks: [], clips: [], adjustments: DEFAULT_ADJUSTMENTS, zoomLevel: 1,
        captions: [], outputs: [], chapters: [],
      }),
      media: merged,
      audioMedia,
      modules: pendingModules,
      moduleSavedAt: { ...moduleSavedAt, video: now },
    }
    setSavedData(updatedSavedData)
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedSavedData),
    })
    if (!res.ok) console.warn('Sync save failed')
    setActiveModules(pendingModules)
    setPendingModules(null)
    setSyncItems(null)
  }

  function handleSyncSkip() {
    if (!pendingModules) return
    setActiveModules(pendingModules)
    save({ modules: pendingModules }).catch(() => {})
    setPendingModules(null)
    setSyncItems(null)
  }

  // ── VideoEditor data-saved callback ───────────────────────
  // Keeps our savedData cache current so non-video editors don't overwrite
  // VideoEditor's timeline/media with stale data.
  function handleVideoDataSaved(data: CfProjFile) {
    setSavedData(data)
  }

  // ── AudioEditor save callback ──────────────────────────────
  async function handleAudioSave(
    tracks: AudioTrack[],
    meta?: { audioMode?: 'music' | 'podcast'; podcastMeta?: import('@/lib/project-serializer').PodcastMeta; dawProject?: import('@/lib/daw-types').DawProject },
  ) {
    const now = new Date().toISOString()
    const serialized: SerializedAudioMedia[] = tracks
      .filter(t => !!t.r2Key)
      .map(t => ({
        id:          t.id,
        name:        t.name,
        duration:    t.duration,
        contentType: t.contentType ?? 'audio/mpeg',
        r2Key:       t.r2Key!,
        savedAt:     now,
      }))
    if (meta?.audioMode)   setAudioMode(meta.audioMode)
    if (meta?.podcastMeta) setPodcastMeta(meta.podcastMeta)
    await save({
      audioMedia: serialized,
      moduleSavedAt: { audio: now },
      audioMode: meta?.audioMode,
      podcastMeta: meta?.podcastMeta,
      dawProject: meta?.dawProject,
    })
  }

  // A view member proposes edits: serialize just like a save, but POST it as a
  // suggestion the owner can accept instead of writing the project directly.
  async function submitSuggestion(
    note: string,
    tracks: AudioTrack[],
    meta?: { audioMode?: 'music' | 'podcast'; podcastMeta?: import('@/lib/project-serializer').PodcastMeta; dawProject?: import('@/lib/daw-types').DawProject },
  ) {
    if (!liveProjectId) throw new Error('Save the project before suggesting changes.')
    const now = new Date().toISOString()
    const serialized: SerializedAudioMedia[] = tracks
      .filter(t => !!t.r2Key)
      .map(t => ({ id: t.id, name: t.name, duration: t.duration, contentType: t.contentType ?? 'audio/mpeg', r2Key: t.r2Key!, savedAt: now }))
    const data = buildCfProj({ audioMedia: serialized, audioMode: meta?.audioMode, podcastMeta: meta?.podcastMeta, dawProject: meta?.dawProject })
    const res = await fetch(`/api/projects/${liveProjectId}/suggestions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, note }),
    })
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try { const b = await res.json(); if (b?.error) detail = b.error } catch { /* ignore */ }
      throw new Error(detail)
    }
  }

  // ── Load failure: explain, never guess at a module ────────
  if (loadError) {
    const backHref = loadError === 'unauthenticated'
      ? `/sign-in?redirect_url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/dashboard')}`
      : '/dashboard'
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          <div style={{ fontSize: 34 }}>{loadError === 'unauthenticated' ? '🔑' : loadError === 'no-access' ? '🔒' : '⚠️'}</div>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            {loadError === 'unauthenticated' ? 'Sign in to open this project'
              : loadError === 'no-access' ? 'You don\u2019t have access to this project'
              : 'Couldn\u2019t load this project'}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            {loadError === 'unauthenticated'
              ? 'This project link needs an account to open. Sign in (or create a free account) and you\u2019ll come right back here.'
              : loadError === 'no-access'
              ? 'Ask the project owner to share it with you \u2014 they can add your email in the project\u2019s Share settings, or switch the link to public.'
              : 'Something went wrong while loading. Check your connection and try again.'}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            {loadError === 'error' && (
              <button onClick={() => window.location.reload()} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: 'var(--accent-contrast)' }}>
                Try again
              </button>
            )}
            <a href={backHref} style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', background: loadError === 'unauthenticated' ? 'var(--accent)' : 'var(--bg-card)', color: loadError === 'unauthenticated' ? '#fff' : 'var(--text-primary)', border: loadError === 'unauthenticated' ? 'none' : '1px solid var(--border)' }}>
              {loadError === 'unauthenticated' ? 'Sign in' : 'Go to dashboard'}
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading state ─────────────────────────────────────────
  if (activeModules === null) {
    return <EditorSpinner label="Opening project…" />
  }

  // ── Module flags ──────────────────────────────────────────
  const hasVideo      = activeModules.includes('video')
  const hasAudio      = activeModules.includes('audio')
  const hasImage      = (activeModules as string[]).includes('image')
  const hasTranscript = (activeModules as string[]).includes('transcript')

  // ── Props factories ───────────────────────────────────────

  const sharedModuleProps = {
    activeModules,
    onModulesChange: handleModulesChange,
  }


  const transcriptProps = {
    projectId,
    projectName: localName,
    captions,
    currentTime,
    onSeek: setCurrentTime,
    onCaptionsChange: setCaptions,
    onSave: async (caps: Caption[]) => save({ captions: caps }),
    onProjectNameCommit: commitName,
    ...sharedModuleProps,
  }

  const audioProps = {
    projectId: liveProjectId,
    isGuest: authLoaded && !isSignedIn,
    projectName: localName,
    captions,
    currentTime,
    onTimeChange: setCurrentTime,
    onProjectNameCommit: commitName,
    onSave: isOwner ? handleAudioSave : undefined,
    onSuggest: viewOnly && liveProjectId ? submitSuggestion : undefined,
    initialTracks: initAudioTracks,
    initialDawProject: starterProject ?? savedData?.dawProject,
    readOnly: viewOnly,
    audioMode,
    initialPodcastMeta: podcastMeta,
    ...sharedModuleProps,
  }

  // ── Video: VideoEditor handles all combos that include video ─
  if (hasVideo) {
    return (
      <>
        <SmallScreenGate />
        <VideoEditor
          projectId={projectId}
          projectName={localName}
          videoUrl={null}
          captions={captions}
          clips={[]}
          outputs={outputs}
          allowImport={allowImport}
          modules={activeModules}
          onModulesChange={handleModulesChange}
          onDataSaved={handleVideoDataSaved}
        />
        {syncItems && (
          <AudioSyncModal
            items={syncItems}
            onConfirm={handleSyncConfirm}
            onSkip={handleSyncSkip}
          />
        )}
      </>
    )
  }

  // ── Non-video layouts — only what the active modules need ──

  // Audio + Transcript — audio top, live-synced transcript below
  if (hasAudio && hasTranscript) {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: '0 0 55%', overflow: 'hidden' }}>
            <><SmallScreenGate />{starterLoading ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>Opening starter…</div> : <AudioEditor {...audioProps} />}</>
          </div>
          <div style={{ flex: '0 0 45%', overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
            <TranscriptEditor {...transcriptProps} hideHeader currentTime={currentTime} />
          </div>
        </div>
        {syncItems && (
          <AudioSyncModal items={syncItems} onConfirm={handleSyncConfirm} onSkip={handleSyncSkip} />
        )}
      </>
    )
  }

  if (hasAudio)      return (
    <>
      <StudioGuide />
      <><SmallScreenGate />{starterLoading ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>Opening starter…</div> : <AudioEditor {...audioProps} />}</>
      {syncItems && <AudioSyncModal items={syncItems} onConfirm={handleSyncConfirm} onSkip={handleSyncSkip} />}
      {isOwner && liveProjectId && <SuggestionsReview projectId={liveProjectId} currentDaw={savedData?.dawProject} />}
    </>
  )
  if (hasTranscript) return (
    <>
      <TranscriptEditor {...transcriptProps} />
      {syncItems && <AudioSyncModal items={syncItems} onConfirm={handleSyncConfirm} onSkip={handleSyncSkip} />}
    </>
  )

  if (hasImage) return (
    <ImageEditor
      projectId={projectId}
      projectName={localName}
      onProjectNameCommit={commitName}
    />
  )

  // Storyboard without video is not meaningful on its own yet
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-base)', gap: 12, color: 'var(--text-muted)', fontSize: 13 }}>
      <p>Add the Video module to use Storyboard view.</p>
    </div>
  )
}
