'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Cloud, CheckCircle2, ChevronDown } from 'lucide-react'
import type { Caption } from '@/lib/types'
import type { ModuleKey } from '@/lib/editor-types'
import ModuleSwitcher from './ModuleSwitcher'
import CaptionEditor from '@/components/captions/CaptionEditor'
import { downloadCaptions, type EditCaption } from '@/lib/caption-format'

// The video module's transcript panel. Chrome (back link, project name, export, cloud save, module
// switcher) lives here; the actual caption list is the SHARED CaptionEditor — the same component the
// standalone Captions app uses, so the caption system never drifts between the two surfaces.

export interface TranscriptEditorProps {
  projectId?: string
  projectName: string
  captions: Caption[]
  currentTime?: number
  onSeek?: (t: number) => void
  onCaptionsChange?: (captions: Caption[]) => void
  onProjectNameCommit?: (name: string) => void
  onSave?: (captions: Caption[]) => Promise<void>
  hideHeader?: boolean
  activeModules?: ModuleKey[]
  onModulesChange?: (modules: ModuleKey[]) => void
}

export default function TranscriptEditor({
  projectName: initialName, captions: initialCaptions,
  currentTime = 0, onSeek, onCaptionsChange, onProjectNameCommit, onSave, hideHeader,
  activeModules, onModulesChange,
}: TranscriptEditorProps) {
  const [localName, setLocalName]     = useState(initialName)
  const [editingName, setEditingName] = useState(false)
  const [captions, setCaptions]       = useState<Caption[]>(initialCaptions)
  const [saveStatus, setSaveStatus]   = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showExport, setShowExport]   = useState(false)

  useEffect(() => { setLocalName(initialName) }, [initialName])
  useEffect(() => { setCaptions(initialCaptions) }, [initialCaptions])

  const change = (cs: EditCaption[]) => { setCaptions(cs); onCaptionsChange?.(cs) }

  async function save() {
    if (!onSave) return
    setSaveStatus('saving')
    try { await onSave(captions); setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 3000) }
    catch { setSaveStatus('idle') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>
      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 40, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 12, textDecoration: 'none', flexShrink: 0 }}>
            <ArrowLeft size={12} /> Dashboard
          </Link>
          <div style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />
          {editingName ? (
            <input autoFocus value={localName}
              onChange={e => setLocalName(e.target.value)}
              onBlur={() => { setEditingName(false); onProjectNameCommit?.(localName) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { setEditingName(false); onProjectNameCommit?.(localName) } }}
              style={{ fontSize: 12, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', color: 'var(--text-primary)', maxWidth: 220 }}
            />
          ) : (
            <button onClick={() => setEditingName(true)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>
              {localName}
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {saveStatus === 'saved' && <span style={{ fontSize: 11, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={11} /> Saved</span>}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowExport(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <Download size={11} /> Export <ChevronDown size={9} />
              </button>
              {showExport && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, minWidth: 120, overflow: 'hidden' }} onMouseLeave={() => setShowExport(false)}>
                  {(['srt', 'vtt', 'txt'] as const).map(fmt => (
                    <button key={fmt} onClick={() => { downloadCaptions(localName, fmt, captions); setShowExport(false) }}
                      style={{ display: 'block', width: '100%', padding: '7px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}>.{fmt}</button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={save} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <Cloud size={11} /> Save
            </button>
            {activeModules && onModulesChange && (
              <ModuleSwitcher activeModules={activeModules} onModulesChange={onModulesChange} />
            )}
          </div>
        </div>
      )}

      <CaptionEditor
        captions={captions} onChange={change}
        currentTime={currentTime} onSeek={onSeek}
        search
        emptyHint="No transcript yet. Add the Video module and transcribe a file to generate one."
      />
    </div>
  )
}
