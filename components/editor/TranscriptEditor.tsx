'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, Download, Cloud, CheckCircle2, AlignLeft, ChevronDown } from 'lucide-react'
import type { Caption } from '@/lib/types'
import type { ModuleKey } from '@/lib/editor-types'
import ModuleSwitcher from './ModuleSwitcher'

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`
}

function toSRT(captions: Caption[]) {
  return captions.map((c, i) => {
    const fmt = (t: number) => {
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000)
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`
    }
    return `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`
  }).join('\n\n')
}

function toVTT(captions: Caption[]) {
  const fmt = (t: number) => {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000)
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`
  }
  return 'WEBVTT\n\n' + captions.map(c => `${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`).join('\n\n')
}

function toTXT(captions: Caption[]) {
  return captions.map(c => `[${fmtTime(c.start)}] ${c.text}`).join('\n')
}

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
  projectId, projectName: initialName, captions: initialCaptions,
  currentTime = 0, onSeek, onCaptionsChange, onProjectNameCommit, onSave, hideHeader,
  activeModules, onModulesChange,
}: TranscriptEditorProps) {
  const [localName, setLocalName]       = useState(initialName)
  const [editingName, setEditingName]   = useState(false)
  const [captions, setCaptions]         = useState<Caption[]>(initialCaptions)
  const [search, setSearch]             = useState('')
  const [editingIdx, setEditingIdx]     = useState<number | null>(null)
  const [editText, setEditText]         = useState('')
  const [saveStatus, setSaveStatus]     = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showExport, setShowExport]     = useState(false)
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setLocalName(initialName) }, [initialName])
  useEffect(() => { setCaptions(initialCaptions) }, [initialCaptions])

  // Auto-scroll active caption into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentTime])

  const filtered = captions.filter(c =>
    !search || c.text.toLowerCase().includes(search.toLowerCase()) || c.speaker?.toLowerCase().includes(search.toLowerCase())
  )

  const activeIdx = captions.findIndex(c => currentTime >= c.start && currentTime <= c.end)

  function startEdit(idx: number) {
    setEditingIdx(idx)
    setEditText(captions[idx].text)
  }

  function commitEdit(idx: number) {
    const updated = captions.map((c, i) => i === idx ? { ...c, text: editText } : c)
    setCaptions(updated)
    onCaptionsChange?.(updated)
    setEditingIdx(null)
  }

  function download(fmt: 'srt' | 'vtt' | 'txt') {
    const content = fmt === 'srt' ? toSRT(captions) : fmt === 'vtt' ? toVTT(captions) : toTXT(captions)
    const blob = new Blob([content], { type: 'text/plain' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${localName}.${fmt}` })
    a.click()
    setShowExport(false)
  }

  async function save() {
    if (!onSave) return
    setSaveStatus('saving')
    try { await onSave(captions); setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 3000) }
    catch { setSaveStatus('idle') }
  }

  const speakers = [...new Set(captions.map(c => c.speaker).filter(Boolean))] as string[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* ── Header ──────────────────────────────────────────── */}
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
              <button
                onClick={() => setShowExport(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <Download size={11} /> Export <ChevronDown size={9} />
              </button>
              {showExport && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, minWidth: 120, overflow: 'hidden' }} onMouseLeave={() => setShowExport(false)}>
                  {(['srt', 'vtt', 'txt'] as const).map(fmt => (
                    <button key={fmt} onClick={() => download(fmt)} style={{ display: 'block', width: '100%', padding: '7px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >.{fmt}</button>
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

      {/* ── Search bar ──────────────────────────────────────── */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search transcript…"
            style={{ width: '100%', paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, color: 'var(--text-muted)' }}>
          <span>{captions.length} segments</span>
          {speakers.length > 0 && <span>{speakers.length} speaker{speakers.length > 1 ? 's' : ''}: {speakers.join(', ')}</span>}
          {search && <span>{filtered.length} results</span>}
          <span style={{ marginLeft: 'auto' }}>Click any line to edit</span>
        </div>
      </div>

      {/* ── Caption list ─────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {captions.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <AlignLeft size={36} strokeWidth={1} color="var(--text-muted)" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              No transcript yet. Add the Video module and transcribe a file to generate one.
            </p>
          </div>
        )}
        {filtered.map((caption, i) => {
          const origIdx = captions.indexOf(caption)
          const isActive = origIdx === activeIdx
          const isEditing = editingIdx === origIdx
          return (
            <div
              key={`${caption.start}-${i}`}
              ref={isActive ? activeRef : undefined}
              style={{
                display: 'flex', gap: 12, padding: '6px 16px',
                background: isActive ? 'rgba(139,92,246,0.06)' : 'transparent',
                borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                transition: 'background 0.1s, border-color 0.1s',
              }}
            >
              {/* Timestamp */}
              <button
                onClick={() => onSeek?.(caption.start)}
                style={{ fontSize: 10, fontFamily: 'monospace', color: isActive ? 'var(--accent-light)' : 'var(--text-muted)', background: 'none', border: 'none', cursor: onSeek ? 'pointer' : 'default', flexShrink: 0, whiteSpace: 'nowrap', paddingTop: 2 }}
              >
                {fmtTime(caption.start)}
              </button>
              {/* Speaker */}
              {caption.speaker && (
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent-light)', flexShrink: 0, paddingTop: 2, minWidth: 60 }}>
                  {caption.speaker}
                </span>
              )}
              {/* Text */}
              {isEditing ? (
                <textarea
                  autoFocus
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onBlur={() => commitEdit(origIdx)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(origIdx) } if (e.key === 'Escape') setEditingIdx(null) }}
                  style={{ flex: 1, fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', outline: 'none', resize: 'vertical', minHeight: 56, fontFamily: 'inherit' }}
                />
              ) : (
                <span
                  style={{ flex: 1, fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', cursor: 'text' }}
                  onClick={() => startEdit(origIdx)}
                >
                  {caption.text}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
