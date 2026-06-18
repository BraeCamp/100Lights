'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Cloud, CheckCircle2, ChevronDown, FileText, Newspaper, AlignLeft,
  PlaySquare, MessageSquare, Mail, BookOpen, Quote, Plus, Trash2, Copy, Check,
  Download, Wand2, ChevronRight, X, Loader2, Plus as PlusIcon,
} from 'lucide-react'
import type { Output, Caption } from '@/lib/types'
import type { ModuleKey } from '@/lib/editor-types'
import { useUpgradeModal } from '@/components/UpgradeModal'
import ModuleSwitcher from './ModuleSwitcher'
import posthog from 'posthog-js'

// ── Types ────────────────────────────────────────────────────

type GenStatus = 'idle' | 'working' | 'done' | 'error'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface ContentDoc {
  id: string
  type: string
  title: string
  body: string
  wordCount: number
  createdAt: string
}

const GEN_TYPES = [
  { id: 'article',          label: 'Article',           icon: FileText,    desc: 'Long-form editorial' },
  { id: 'blog_post',        label: 'Blog Post',         icon: Newspaper,   desc: 'SEO-friendly post' },
  { id: 'show_notes',       label: 'Show Notes',        icon: AlignLeft,   desc: 'Podcast notes' },
  { id: 'summary',          label: 'Summary',           icon: BookOpen,    desc: 'Concise TL;DR' },
  { id: 'youtube_desc',     label: 'YouTube Desc',      icon: PlaySquare,  desc: 'With chapters & tags' },
  { id: 'social_caption',   label: 'Social Captions',   icon: MessageSquare, desc: 'Twitter · LinkedIn · IG' },
  { id: 'email_newsletter', label: 'Newsletter',        icon: Mail,        desc: 'Email-ready format' },
  { id: 'key_quotes',       label: 'Key Quotes',        icon: Quote,       desc: 'Shareable moments' },
] as const

function outputToDoc(o: Output): ContentDoc {
  return { id: o.id, type: o.type, title: o.title, body: o.content, wordCount: o.wordCount ?? 0, createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt) }
}

function docToOutput(d: ContentDoc): Output {
  return { id: d.id, type: d.type as Output['type'], title: d.title, content: d.body, wordCount: d.wordCount, createdAt: new Date(d.createdAt) }
}

export interface ContentEditorProps {
  projectId?: string
  projectName: string
  captions: Caption[]
  initialOutputs?: Output[]
  onSave?: (docs: Output[]) => Promise<void>
  onNameChange?: (name: string) => void
  onProjectNameCommit?: (name: string) => void
  /** Override project name editing for combined layouts */
  hideHeader?: boolean
  activeModules?: ModuleKey[]
  onModulesChange?: (modules: ModuleKey[]) => void
}

// ── Auto-resizing textarea ────────────────────────────────────
function AutoTextarea({ value, onChange, placeholder, className, style }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={{ resize: 'none', overflow: 'hidden', ...style }}
    />
  )
}

// ── Main component ────────────────────────────────────────────

export default function ContentEditor({
  projectId, projectName: initialName, captions, initialOutputs = [],
  onSave, onNameChange, onProjectNameCommit, hideHeader,
  activeModules, onModulesChange,
}: ContentEditorProps) {
  const { showUpgrade } = useUpgradeModal()

  const [localName, setLocalName]     = useState(initialName)
  const [editingName, setEditingName] = useState(false)
  const [docs, setDocs]               = useState<ContentDoc[]>(() => initialOutputs.map(outputToDoc))
  const [selectedId, setSelectedId]   = useState<string | null>(() => initialOutputs[0]?.id ?? null)
  const [genStatus, setGenStatus]     = useState<Record<string, GenStatus>>({})
  const [saveStatus, setSaveStatus]   = useState<SaveStatus>('idle')
  const [isDirty, setIsDirty]         = useState(false)
  const [copied, setCopied]           = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep name in sync with parent
  useEffect(() => { setLocalName(initialName) }, [initialName])

  // Keep docs in sync when initial outputs change (project loaded)
  useEffect(() => {
    if (initialOutputs.length > 0) {
      setDocs(initialOutputs.map(outputToDoc))
      setSelectedId(prev => prev ?? initialOutputs[0].id)
    }
  }, [initialOutputs]) // eslint-disable-line

  const selectedDoc = docs.find(d => d.id === selectedId) ?? null

  function patchDoc(id: string, patch: Partial<ContentDoc>) {
    setDocs(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
    setIsDirty(true)
    // Auto-save 20s after last change
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { triggerSave() }, 20_000)
  }

  function newDoc() {
    const doc: ContentDoc = {
      id: crypto.randomUUID(),
      type: 'article',
      title: 'New Document',
      body: '',
      wordCount: 0,
      createdAt: new Date().toISOString(),
    }
    setDocs(prev => [doc, ...prev])
    setSelectedId(doc.id)
    setIsDirty(true)
  }

  function deleteDoc(id: string) {
    setDocs(prev => prev.filter(d => d.id !== id))
    if (selectedId === id) {
      setSelectedId(docs.find(d => d.id !== id)?.id ?? null)
    }
    setIsDirty(true)
  }

  async function triggerSave() {
    if (!onSave) return
    setSaveStatus('saving')
    try {
      await onSave(docs.map(docToOutput))
      setIsDirty(false)
      setSaveStatus('saved')
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current)
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
    } catch {
      setSaveStatus('error')
    }
  }

  async function callAi(prompt: string, system: string): Promise<string> {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system }),
    })
    if (res.status === 429) {
      posthog.capture('upgrade_shown', { trigger: 'ai_limit' })
      showUpgrade('You\'ve used your free AI generations this month. Upgrade to Pro for 100/month.')
      throw new Error('limit')
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { content: string }
    posthog.capture('ai_content_generated', { trigger: 'content_editor' })
    return data.content
  }

  async function generate(type: typeof GEN_TYPES[number]['id']) {
    if (!captions.length) return
    setGenStatus(s => ({ ...s, [type]: 'working' }))
    try {
      const transcript    = captions.map(c => c.text).join(' ')
      const timedTranscript = captions.map(c => `[${c.start.toFixed(0)}s] ${c.text}`).join('\n')
      const prompts: Record<string, { system: string; prompt: string }> = {
        article:          { system: 'You are a professional content writer.',         prompt: `Write a comprehensive article based on this transcript. Include an engaging title (as a # heading), introduction, main points with ## subheadings, and conclusion.\n\nTranscript:\n${transcript}` },
        blog_post:        { system: 'You are an SEO-savvy blog writer.',               prompt: `Write an SEO-friendly blog post based on this transcript. Use an engaging hook, ## subheadings, bullet points for key takeaways, and a CTA.\n\nTranscript:\n${transcript}` },
        show_notes:       { system: 'You are a podcast producer writing show notes.',  prompt: `Write podcast show notes for this transcript. Include a 2–3 sentence summary, key topics (bullet list), 2–3 notable quotes with timestamps, and a resources section.\n\nTranscript:\n${timedTranscript}` },
        summary:          { system: 'You are an expert at summarising spoken content.',prompt: `Write a structured summary of this transcript. Include a TL;DR sentence, 5 key points as bullets, and the main conclusion. Keep it under 300 words.\n\nTranscript:\n${transcript}` },
        youtube_desc:     { system: 'You are a YouTube creator maximising search CTR.',prompt: `Write a YouTube description for this transcript: punchy 2-sentence hook, summary paragraph, chapters section with timestamps (MM:SS format), 5–10 hashtags, subscribe CTA.\n\nTranscript:\n${timedTranscript}` },
        social_caption:   { system: 'You are a social media strategist.',              prompt: `Write 3 platform-native captions from this transcript:\n1. Twitter/X (max 280 chars, 2 hashtags)\n2. LinkedIn (professional, 3–5 sentences, 3 hashtags)\n3. Instagram (storytelling hook, emojis, 5 hashtags)\n\nTranscript:\n${transcript}` },
        email_newsletter: { system: 'You are an email newsletter writer.',             prompt: `Write an email newsletter. Include: Subject: line, greeting, 3–5 key takeaways with short descriptions, a featured quote, and a closing CTA. Short paragraphs.\n\nTranscript:\n${transcript}` },
        key_quotes:       { system: 'You are a content strategist finding quotable moments.', prompt: `Extract 5–8 most impactful quotes from this transcript. Format each:\n[M:SS] "Quote text"\n↳ One sentence of context\n\nTranscript:\n${timedTranscript}` },
      }
      const { system, prompt } = prompts[type]
      const body = await callAi(prompt, system)
      const title = body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') ?? GEN_TYPES.find(t => t.id === type)!.label
      const doc: ContentDoc = {
        id: crypto.randomUUID(),
        type,
        title,
        body,
        wordCount: body.split(/\s+/).filter(Boolean).length,
        createdAt: new Date().toISOString(),
      }
      setDocs(prev => [doc, ...prev])
      setSelectedId(doc.id)
      setIsDirty(true)
      setGenStatus(s => ({ ...s, [type]: 'done' }))
    } catch {
      setGenStatus(s => ({ ...s, [type]: 'error' }))
    }
  }

  async function copyDoc() {
    if (!selectedDoc) return
    await navigator.clipboard.writeText(selectedDoc.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadDoc(format: 'txt' | 'md') {
    if (!selectedDoc) return
    const blob = new Blob([selectedDoc.body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: `${selectedDoc.title}.${format}` })
    a.click(); URL.revokeObjectURL(url)
  }

  const hasTranscript = captions.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* ── Header ──────────────────────────────────────────── */}
      {!hideHeader && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px',
          height: 40, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
          flexShrink: 0,
        }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 12, textDecoration: 'none', flexShrink: 0 }}>
            <ArrowLeft size={12} /> Dashboard
          </Link>
          <div style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />

          {editingName ? (
            <input
              autoFocus
              value={localName}
              onChange={e => { setLocalName(e.target.value); onNameChange?.(e.target.value) }}
              onBlur={() => { setEditingName(false); onProjectNameCommit?.(localName) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { setEditingName(false); onProjectNameCommit?.(localName) } }}
              style={{ fontSize: 12, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', color: 'var(--text-primary)', maxWidth: 220 }}
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title="Click to rename"
            >
              {localName}
            </button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {saveStatus === 'saving' && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saving…</span>}
            {saveStatus === 'saved'  && <span style={{ fontSize: 11, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={11} /> Saved</span>}
            {isDirty && saveStatus === 'idle' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />}
            <button
              onClick={triggerSave}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <Cloud size={11} /> Save
            </button>
            {activeModules && onModulesChange && (
              <ModuleSwitcher activeModules={activeModules} onModulesChange={onModulesChange} />
            )}
          </div>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Left sidebar ──────────────────────────────────── */}
        <div style={{
          width: sidebarCollapsed ? 44 : 240, flexShrink: 0,
          borderRight: '1px solid var(--border)', background: 'var(--bg-surface)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          transition: 'width 0.15s',
        }}>
          {/* Sidebar header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {!sidebarCollapsed && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Documents</span>}
            <button onClick={() => setSidebarCollapsed(v => !v)} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, marginLeft: sidebarCollapsed ? 'auto' : 0 }}>
              <ChevronRight size={13} style={{ transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.15s' }} />
            </button>
          </div>

          {!sidebarCollapsed && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

              {/* Document list */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '6px 0' }}>
                <button
                  onClick={newDoc}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-light)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  <Plus size={11} /> New document
                </button>
                {docs.length === 0 && (
                  <div style={{ padding: '12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    No documents yet. Generate one below or click "New document".
                  </div>
                )}
                {docs.map(doc => (
                  <div key={doc.id} style={{ position: 'relative' }}>
                    <button
                      onClick={() => setSelectedId(doc.id)}
                      style={{
                        display: 'block', width: '100%', padding: '6px 12px 6px 12px',
                        textAlign: 'left', background: selectedId === doc.id ? 'var(--accent-subtle)' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        borderLeft: `2px solid ${selectedId === doc.id ? 'var(--accent)' : 'transparent'}`,
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 500, color: selectedId === doc.id ? 'var(--accent-light)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                        {doc.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {doc.wordCount} words
                      </div>
                    </button>
                    {selectedId === doc.id && (
                      <button
                        onClick={() => deleteDoc(doc.id)}
                        title="Delete document"
                        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 3 }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Generate section */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0 8px', flexShrink: 0 }}>
                <div style={{ padding: '0 12px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Wand2 size={10} /> Generate
                </div>
                {!hasTranscript && (
                  <div style={{ padding: '4px 12px 6px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Load the Transcript module and transcribe a video or audio file to generate content.
                  </div>
                )}
                {GEN_TYPES.map(({ id, label, icon: Icon, desc }) => {
                  const status = genStatus[id] ?? 'idle'
                  return (
                    <button
                      key={id}
                      onClick={() => generate(id)}
                      disabled={!hasTranscript || status === 'working'}
                      title={desc}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                        padding: '5px 12px', fontSize: 11, textAlign: 'left',
                        background: 'transparent', border: 'none',
                        color: !hasTranscript ? 'var(--border-light)' : status === 'working' ? 'var(--accent-light)' : 'var(--text-secondary)',
                        cursor: !hasTranscript || status === 'working' ? 'not-allowed' : 'pointer',
                      }}
                      onMouseEnter={e => { if (hasTranscript && status !== 'working') e.currentTarget.style.color = 'var(--text-primary)' }}
                      onMouseLeave={e => { if (hasTranscript && status !== 'working') e.currentTarget.style.color = 'var(--text-secondary)' }}
                    >
                      {status === 'working'
                        ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Icon size={11} />
                      }
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Document editor ───────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px 60px', background: 'var(--bg-base)' }}>
          {!selectedDoc ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-muted)' }}>
              <FileText size={36} strokeWidth={1} />
              <p style={{ fontSize: 13, textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
                Create a new document or generate one from a transcript using the sidebar.
              </p>
              <button
                onClick={newDoc}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 7, background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}
              >
                <Plus size={13} /> New document
              </button>
            </div>
          ) : (
            <div style={{ width: '100%', maxWidth: 740 }}>

              {/* Document toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
                <button
                  onClick={copyDoc}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '5px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: copied ? '#4ade80' : 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                </button>
                <button
                  onClick={() => downloadDoc('md')}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '5px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  <Download size={11} /> .md
                </button>
                <button
                  onClick={() => downloadDoc('txt')}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '5px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  <Download size={11} /> .txt
                </button>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {selectedDoc.wordCount} words
                </span>
              </div>

              {/* Title */}
              <AutoTextarea
                value={selectedDoc.title}
                onChange={v => patchDoc(selectedDoc.id, { title: v })}
                placeholder="Document title"
                style={{
                  width: '100%', fontSize: 28, fontWeight: 700,
                  color: 'var(--text-primary)', background: 'transparent',
                  border: 'none', outline: 'none', lineHeight: 1.3,
                  marginBottom: 20, padding: 0, fontFamily: 'inherit',
                }}
              />

              {/* Body */}
              <AutoTextarea
                value={selectedDoc.body}
                onChange={v => {
                  const wc = v.split(/\s+/).filter(Boolean).length
                  patchDoc(selectedDoc.id, { body: v, wordCount: wc })
                }}
                placeholder="Start writing, or generate content from a transcript using the sidebar…"
                style={{
                  width: '100%', minHeight: 480,
                  fontSize: 15, lineHeight: 1.8,
                  color: 'var(--text-primary)', background: 'transparent',
                  border: 'none', outline: 'none', padding: 0,
                  fontFamily: 'inherit',
                }}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
