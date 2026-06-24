'use client'

import type { Caption } from '@/lib/types'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'

export interface AudioTrack extends AudioTrackInit {
  url: string
}

export interface AudioEditorProps {
  projectId?: string
  projectName: string
  initialTracks?: AudioTrack[]
  captions?: Caption[]
  currentTime?: number
  onTimeChange?: (t: number) => void
  onProjectNameCommit?: (name: string) => void
  onSave?: (tracks: AudioTrack[]) => Promise<void>
  hideHeader?: boolean
  activeModules?: ModuleKey[]
  onModulesChange?: (modules: ModuleKey[]) => void
}

export default function AudioEditor(_props: AudioEditorProps) {
  return (
    <div style={{ height: '100%', background: 'var(--bg-base)' }} />
  )
}
