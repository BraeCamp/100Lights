'use client'

/**
 * ProjectEditor — module routing shell.
 *
 * When the project includes the video module, VideoEditor handles everything
 * (it already manages multi-module combos internally).
 *
 * For non-video projects, this component loads the project data from the API
 * once, then routes to the appropriate isolated or combined editor layout.
 * Shared state (captions, outputs, currentTime) lives here and is passed down.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { Caption, Output } from '@/lib/types'
import type { ModuleKey } from '@/lib/editor-types'
import { ALL_MODULE_KEYS, MODULE_DEFS, DEFAULT_ADJUSTMENTS } from '@/lib/editor-types'
import type { CfProjFile } from '@/lib/project-serializer'
import { deserialize } from '@/lib/project-serializer'
import ContentEditor    from './ContentEditor'
import AudioEditor      from './AudioEditor'
import TranscriptEditor from './TranscriptEditor'

// Video editor is large — keep it lazy-loaded
const VideoEditor = dynamic(() => import('./VideoEditor'), { ssr: false })

// ── Types ────────────────────────────────────────────────────

export interface ProjectEditorProps {
  projectId?: string
  projectName: string
  modules: ModuleKey[]
  allowImport?: boolean
}

// ── Helpers ──────────────────────────────────────────────────

function deserializeOutputs(raw: CfProjFile['outputs']): Output[] {
  return (raw ?? []).map(o => ({
    id: o.id,
    type: o.type as Output['type'],
    title: o.title,
    content: o.content,
    wordCount: o.wordCount,
    createdAt: new Date(o.createdAt),
    captions: o.captions,
  }))
}

// ── Split-pane layout helper ──────────────────────────────────

function SplitLayout({ left, right, defaultSplit = 340 }: {
  left: React.ReactNode
  right: React.ReactNode
  defaultSplit?: number
}) {
  const [leftW, setLeftW] = useState(defaultSplit)
  const containerRef = useRef<HTMLDivElement>(null)

  const onDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    let last = e.clientX
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - last
      last = ev.clientX
      setLeftW(w => Math.max(240, Math.min(720, w + delta)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  return (
    <div ref={containerRef} style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: leftW, flexShrink: 0, overflow: 'hidden' }}>{left}</div>
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
  const [activeModules, setActiveModules] = useState<ModuleKey[]>(moduleProp)
  const [captions, setCaptions]           = useState<Caption[]>([])
  const [outputs, setOutputs]             = useState<Output[]>([])
  const [isLoading, setIsLoading]         = useState(!!projectId)
  const [savedData, setSavedData]         = useState<CfProjFile | null>(null)
  const [localName, setLocalName]         = useState(projectName)
  const [currentTime, setCurrentTime]     = useState(0)
  const savedProjectId = useRef(projectId ?? crypto.randomUUID())

  // ── Load project from API ──────────────────────────────────
  useEffect(() => {
    if (!projectId) { setIsLoading(false); return }
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: CfProjFile | null) => {
        if (!data) return
        setSavedData(data)
        setLocalName(data.name)
        setCaptions(data.captions ?? [])
        setOutputs(deserializeOutputs(data.outputs ?? []))
        setActiveModules(data.modules ?? ALL_MODULE_KEYS)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [projectId])

  // ── Save project (non-video editors) ──────────────────────
  async function save(patch: { name?: string; outputs?: Output[]; captions?: Caption[] }) {
    const name      = patch.name    ?? localName
    const outs      = patch.outputs ?? outputs
    const caps      = patch.captions ?? captions

    const project: CfProjFile = {
      _type: '100lights-project',
      version: 1,
      id: savedProjectId.current,
      name,
      savedAt: new Date().toISOString(),
      tracks: savedData?.tracks ?? [],
      clips: savedData?.clips ?? [],
      adjustments: savedData?.adjustments ?? DEFAULT_ADJUSTMENTS,
      zoomLevel: savedData?.zoomLevel ?? 1,
      captions: caps,
      outputs: outs.map(o => ({
        id: o.id, type: o.type, title: o.title, content: o.content,
        wordCount: o.wordCount, createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
        captions: o.captions,
      })),
      media: savedData?.media ?? [],
      modules: activeModules,
    }
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    })
    setLocalName(name)
    if (patch.outputs) setOutputs(outs)
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

  // ── Loading state ─────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-base)', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
        Opening project…
      </div>
    )
  }

  // ── Module routing ─────────────────────────────────────────
  const hasVideo      = activeModules.includes('video')
  const hasAudio      = activeModules.includes('audio')
  const hasContent    = activeModules.includes('content')
  const hasTranscript = activeModules.includes('transcript')
  const hasStoryboard = activeModules.includes('storyboard')

  // Video handles its own multi-module combos (timeline, audio tab, storyboard, etc.)
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

  // ── Non-video layouts ──────────────────────────────────────

  const sharedContentProps = {
    projectId,
    projectName: localName,
    captions,
    initialOutputs: outputs,
    onSave: async (docs: Output[]) => { await save({ outputs: docs }) },
    onProjectNameCommit: commitName,
  }

  const sharedTranscriptProps = {
    projectId,
    projectName: localName,
    captions,
    currentTime,
    onSeek: setCurrentTime,
    onCaptionsChange: setCaptions,
    onSave: async (caps: Caption[]) => { await save({ captions: caps }) },
    onProjectNameCommit: commitName,
  }

  const sharedAudioProps = {
    projectId,
    projectName: localName,
    captions,
    currentTime,
    onTimeChange: setCurrentTime,
    onProjectNameCommit: commitName,
    onSave: async () => { await save({}) },
  }

  // Transcript + Content — side by side, transcript drives seek for content context
  if (hasTranscript && hasContent) {
    return (
      <SplitLayout
        left={<TranscriptEditor {...sharedTranscriptProps} hideHeader={false} />}
        right={<ContentEditor {...sharedContentProps} hideHeader={false} />}
      />
    )
  }

  // Audio + Transcript — audio on top, transcript panel below (shared time)
  if (hasAudio && hasTranscript) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: '0 0 60%', overflow: 'hidden' }}>
          <AudioEditor {...sharedAudioProps} onTimeChange={setCurrentTime} />
        </div>
        <div style={{ flex: '0 0 40%', overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
          <TranscriptEditor {...sharedTranscriptProps} hideHeader currentTime={currentTime} />
        </div>
      </div>
    )
  }

  // Audio + Content
  if (hasAudio && hasContent) {
    return (
      <SplitLayout
        left={<AudioEditor {...sharedAudioProps} hideHeader={false} />}
        right={<ContentEditor {...sharedContentProps} hideHeader={false} />}
        defaultSplit={480}
      />
    )
  }

  // Individual modules
  if (hasContent)    return <ContentEditor    {...sharedContentProps} />
  if (hasAudio)      return <AudioEditor      {...sharedAudioProps} />
  if (hasTranscript) return <TranscriptEditor {...sharedTranscriptProps} />

  // Storyboard standalone — for now show a placeholder (needs video clips to be useful)
  if (hasStoryboard) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-base)', gap: 12, color: 'var(--text-muted)' }}>
        <p style={{ fontSize: 13 }}>Add the Video module to use Storyboard view.</p>
      </div>
    )
  }

  // Fallback
  return <ContentEditor {...sharedContentProps} />
}
