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
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { Caption, Output } from '@/lib/types'
import type { ModuleKey } from '@/lib/editor-types'
import { ALL_MODULE_KEYS, MODULE_DEFS, DEFAULT_ADJUSTMENTS } from '@/lib/editor-types'
import type { CfProjFile } from '@/lib/project-serializer'

// ── All editors are lazy. None load until their module is active. ─────────

const VideoEditor = dynamic(
  () => import('./VideoEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading video editor…" /> }
)

const ContentEditor = dynamic(
  () => import('./ContentEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading content editor…" /> }
)

const AudioEditor = dynamic(
  () => import('./AudioEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading audio editor…" /> }
)

const TranscriptEditor = dynamic(
  () => import('./TranscriptEditor'),
  { ssr: false, loading: () => <EditorSpinner label="Loading transcript editor…" /> }
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
  /** Which modules to load. For new projects this comes from the picker.
   *  For saved projects it is overridden by whatever the API returns.
   *  undefined = wait for API (shows loading until response arrives). */
  modules?: ModuleKey[]
  allowImport?: boolean
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

// ── Main component ────────────────────────────────────────────

export default function ProjectEditor({ projectId, projectName, modules: moduleProp, allowImport }: ProjectEditorProps) {
  // For a new project (no projectId), use the picker-provided modules immediately.
  // For a saved project, start in loading state; the API response sets the real modules.
  const isNewProject = !projectId
  const [activeModules, setActiveModules] = useState<ModuleKey[] | null>(
    isNewProject ? (moduleProp ?? ['video']) : null   // null = "not yet determined"
  )
  const [captions, setCaptions]   = useState<Caption[]>([])
  const [outputs, setOutputs]     = useState<Output[]>([])
  const [savedData, setSavedData] = useState<CfProjFile | null>(null)
  const [localName, setLocalName] = useState(projectName)
  const [currentTime, setCurrentTime] = useState(0)
  const savedProjectId = useRef(projectId ?? crypto.randomUUID())

  // ── Load project from API ──────────────────────────────────
  useEffect(() => {
    if (isNewProject) return
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: CfProjFile | null) => {
        if (!data) { setActiveModules(['video']); return }
        setSavedData(data)
        setLocalName(data.name)
        setCaptions(data.captions ?? [])
        setOutputs(deserializeOutputs(data.outputs))
        // Old projects have no modules field → keep them working as video projects
        setActiveModules(data.modules ?? ['video'])
      })
      .catch(() => setActiveModules(['video']))
  }, [projectId]) // eslint-disable-line

  // ── Save (non-video editors call this) ────────────────────
  async function save(patch: { name?: string; outputs?: Output[]; captions?: Caption[]; modules?: ModuleKey[] }) {
    const name    = patch.name    ?? localName
    const outs    = patch.outputs ?? outputs
    const caps    = patch.captions ?? captions
    const mods    = patch.modules ?? activeModules ?? ['video']

    const project: CfProjFile = {
      _type: '100lights-project',
      version: 1,
      id: savedProjectId.current,
      name,
      savedAt: new Date().toISOString(),
      tracks:      savedData?.tracks      ?? [],
      clips:       savedData?.clips       ?? [],
      adjustments: savedData?.adjustments ?? DEFAULT_ADJUSTMENTS,
      zoomLevel:   savedData?.zoomLevel   ?? 1,
      captions:    caps,
      outputs:     outs.map(o => ({
        id: o.id, type: o.type, title: o.title, content: o.content,
        wordCount: o.wordCount, createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
        captions: o.captions,
      })),
      media:   savedData?.media ?? [],
      modules: mods,
    }

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    })
    if (!res.ok) throw new Error('Save failed')
    setLocalName(name)
    if (patch.outputs)  setOutputs(outs)
    if (patch.captions) setCaptions(caps)
  }

  function commitName(name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed === localName) return
    setLocalName(trimmed)
    save({ name: trimmed }).catch(() => {})
    if (projectId) {
      fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      }).catch(() => {})
    }
  }

  // ── Loading state (saved project, API not yet responded) ───
  if (activeModules === null) {
    return <EditorSpinner label="Opening project…" />
  }

  // ── Module flags ──────────────────────────────────────────
  const hasVideo      = activeModules.includes('video')
  const hasAudio      = activeModules.includes('audio')
  const hasContent    = activeModules.includes('content')
  const hasTranscript = activeModules.includes('transcript')

  // ── Video: VideoEditor handles all combos that include video ─
  // Everything video-related (timeline, color, audio tab, etc.) lives there.
  if (hasVideo) {
    return (
      <VideoEditor
        projectId={projectId}
        projectName={localName}
        videoUrl={null}
        captions={captions}
        clips={[]}
        outputs={outputs}
        allowImport={allowImport}
        modules={activeModules}
      />
    )
  }

  // ── Non-video layouts — only what the active modules need ──

  const contentProps = {
    projectId,
    projectName: localName,
    captions,
    initialOutputs: outputs,
    onSave: async (docs: Output[]) => save({ outputs: docs }),
    onProjectNameCommit: commitName,
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
  }

  const audioProps = {
    projectId,
    projectName: localName,
    captions,
    currentTime,
    onTimeChange: setCurrentTime,
    onProjectNameCommit: commitName,
    onSave: async () => save({}),
  }

  // Transcript + Content — side by side, transcript feeds content AI generation
  if (hasTranscript && hasContent && !hasAudio) {
    return (
      <SplitLayout
        left={<TranscriptEditor {...transcriptProps} />}
        right={<ContentEditor   {...contentProps}    />}
      />
    )
  }

  // Audio + Transcript + Content — audio on top, transcript + content side by side below
  if (hasAudio && hasTranscript && hasContent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: '0 0 50%', overflow: 'hidden' }}>
          <AudioEditor {...audioProps} />
        </div>
        <div style={{ flex: '0 0 50%', overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
          <SplitLayout
            left={<TranscriptEditor {...transcriptProps} hideHeader />}
            right={<ContentEditor   {...contentProps}    hideHeader />}
          />
        </div>
      </div>
    )
  }

  // Audio + Transcript — audio top, live-synced transcript below
  if (hasAudio && hasTranscript) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: '0 0 55%', overflow: 'hidden' }}>
          <AudioEditor {...audioProps} />
        </div>
        <div style={{ flex: '0 0 45%', overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
          <TranscriptEditor {...transcriptProps} hideHeader currentTime={currentTime} />
        </div>
      </div>
    )
  }

  // Audio + Content — waveform left, writing space right
  if (hasAudio && hasContent) {
    return (
      <SplitLayout
        defaultSplit={480}
        left={<AudioEditor   {...audioProps}   />}
        right={<ContentEditor {...contentProps} />}
      />
    )
  }

  // Single module
  if (hasContent)    return <ContentEditor    {...contentProps}    />
  if (hasAudio)      return <AudioEditor      {...audioProps}      />
  if (hasTranscript) return <TranscriptEditor {...transcriptProps} />

  // Storyboard without video is not meaningful on its own yet
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-base)', gap: 12, color: 'var(--text-muted)', fontSize: 13 }}>
      <p>Add the Video module to use Storyboard view.</p>
    </div>
  )
}
