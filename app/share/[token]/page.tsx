'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { Zap, FileText, Newspaper, AlignLeft, PlaySquare, MessageSquare, Mail, BookOpen, Copy, Check } from 'lucide-react'
import type { Output, Caption } from '@/lib/types'

const outputIcons: Partial<Record<string, React.ElementType>> = {
  article:          FileText,
  blog_post:        Newspaper,
  show_notes:       AlignLeft,
  transcript:       AlignLeft,
  youtube_desc:     PlaySquare,
  social_caption:   MessageSquare,
  email_newsletter: Mail,
  summary:          BookOpen,
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
      style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--border)', color: copied ? '#10b981' : 'var(--text-secondary)' }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function fmt(t: number) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}

interface ShareData {
  name: string
  outputs: Output[]
  captions: Caption[]
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [data, setData] = useState<ShareData | null>(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'outputs' | 'transcript'>('outputs')

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error) }))
      .then(setData)
      .catch(e => setError(e.message ?? 'Failed to load'))
  }, [token])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Zap size={14} color="#fff" fill="#fff" />
          </div>
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>100Lights</span>
        </div>
        {data && (
          <>
            <div className="w-px h-4" style={{ background: 'var(--border)' }} />
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{data.name}</span>
          </>
        )}
        <div className="ml-auto">
          <a
            href="/sign-up"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Try 100Lights free
          </a>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {error ? (
          <div className="text-center py-20">
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Link not found</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{error}</p>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center py-20">
            <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>{data.name}</h1>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              {([['outputs', 'Outputs'], ['transcript', 'Transcript']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium"
                  style={{
                    background: activeTab === id ? 'var(--accent)' : 'transparent',
                    color: activeTab === id ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'outputs' && (
              <div className="flex flex-col gap-4">
                {data.outputs.filter(o => o.type !== 'clips').length === 0 ? (
                  <p className="text-sm text-center py-12" style={{ color: 'var(--text-muted)' }}>No content outputs yet.</p>
                ) : data.outputs.filter(o => o.type !== 'clips').map(output => {
                  const Icon = outputIcons[output.type] ?? FileText
                  return (
                    <div key={output.id} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-3">
                          <Icon size={15} color="var(--text-muted)" />
                          <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{output.title}</div>
                            {output.wordCount && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{output.wordCount.toLocaleString()} words</div>}
                          </div>
                        </div>
                        <CopyButton text={output.content} />
                      </div>
                      <div className="px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                        {output.content}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                {data.captions.length === 0 ? (
                  <p className="text-sm text-center py-12" style={{ color: 'var(--text-muted)' }}>No transcript available.</p>
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {data.captions.map((cap, i) => (
                      <div key={i} className="flex gap-4 px-5 py-3">
                        <span className="text-xs font-mono shrink-0 pt-0.5" style={{ color: 'var(--text-muted)', minWidth: 36 }}>{fmt(cap.start)}</span>
                        {cap.speaker && <span className="text-xs font-semibold shrink-0 pt-0.5" style={{ color: 'var(--accent-light)', minWidth: 60 }}>{cap.speaker}</span>}
                        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{cap.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
