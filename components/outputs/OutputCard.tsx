'use client'

import { useState } from 'react'
import { Copy, Check, FileText, Mic, Newspaper, AlignLeft, Scissors, PlaySquare, MessageSquare, Mail, BookOpen, Quote } from 'lucide-react'
import CaptionViewer from '@/components/captions/CaptionViewer'
import ClipCard from '@/components/clips/ClipCard'
import type { Output, OutputType } from '@/lib/types'

const outputMeta: Record<OutputType, { label: string; icon: React.ElementType; color: string }> = {
  article:          { label: 'Article',           icon: FileText,      color: '#8b5cf6' },
  blog_post:        { label: 'Blog Post',          icon: Newspaper,     color: '#3b82f6' },
  show_notes:       { label: 'Show Notes',         icon: AlignLeft,     color: '#10b981' },
  clips:            { label: 'Clips',              icon: Scissors,      color: '#f59e0b' },
  transcript:       { label: 'Transcript',         icon: AlignLeft,     color: '#6b7280' },
  summary:          { label: 'Summary',            icon: BookOpen,      color: '#ec4899' },
  youtube_desc:     { label: 'YouTube Description',icon: PlaySquare,    color: '#ef4444' },
  social_caption:   { label: 'Social Captions',    icon: MessageSquare, color: '#0ea5e9' },
  email_newsletter: { label: 'Email Newsletter',   icon: Mail,          color: '#f59e0b' },
  key_quotes:       { label: 'Key Quotes',          icon: Quote,         color: '#a78bfa' },
}

interface Props {
  output: Output
}

export default function OutputCard({ output }: Props) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const meta = outputMeta[output.type]
  const Icon = meta.icon

  if (output.type === 'clips' && output.clips) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}18` }}>
            <Icon size={15} color={meta.color} />
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{output.title}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {meta.label} · {output.clips.length} clips with caption tracks
            </div>
          </div>
        </div>
        {output.clips.map((clip, i) => (
          <ClipCard key={clip.id} clip={clip} index={i} />
        ))}
      </div>
    )
  }

  if (output.type === 'transcript' && output.captions) {
    return (
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}18` }}>
            <Icon size={15} color={meta.color} />
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{output.title}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {meta.label}{output.wordCount ? ` · ${output.wordCount.toLocaleString()} words` : ''}
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <CaptionViewer captions={output.captions} filename="transcript" maxHeight="360px" />
        </div>
      </div>
    )
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(output.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const preview = output.content.slice(0, 320)
  const hasMore = output.content.length > 320

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}18` }}>
            <Icon size={15} color={meta.color} />
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{output.title}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {meta.label}{output.wordCount ? ` · ${output.wordCount.toLocaleString()} words` : ''}
            </div>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: copied ? 'rgba(16, 185, 129, 0.12)' : 'var(--border)',
            color: copied ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="px-5 py-4">
        <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
          {expanded ? output.content : preview}
          {!expanded && hasMore && '…'}
        </div>
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 text-xs font-medium"
            style={{ color: 'var(--accent-light)' }}
          >
            {expanded ? 'Show less' : 'Read full content'}
          </button>
        )}
      </div>
    </div>
  )
}
