'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Sparkles, RotateCcw } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const QUICK_PROMPTS = [
  { label: 'Growth analysis', prompt: 'Analyze my current metrics and tell me what the most important thing to focus on right now is to grow 100Lights.' },
  { label: 'Marketing plan', prompt: 'Give me a 90-day marketing plan to grow 100Lights users, given I\'m a solo founder with limited time. Focus on the highest-ROI channels.' },
  { label: 'Conversion rate', prompt: 'My free-to-pro conversion rate — is it good or bad for a SaaS at this stage? What specific changes to pricing, feature gating, or UX would most improve it?' },
  { label: 'Podcast SEO', prompt: 'How should I position and market the podcast editor feature of 100Lights to grow users in that niche? What are the best SEO keywords and content strategies?' },
  { label: 'Compliance audit', prompt: 'Walk me through the key compliance requirements I need to meet: GDPR, Stripe\'s terms, Apple/Spotify podcast requirements, and any other applicable regulations for a SaaS creative tool.' },
  { label: 'Pricing strategy', prompt: 'Should I change my pricing? Consider my conversion rate, feature set, and target users. What pricing models or tiers would maximize revenue?' },
  { label: 'Acquisition channels', prompt: 'What are the top 5 user acquisition channels I should be investing in right now for 100Lights, ranked by expected ROI for a solo bootstrap founder?' },
  { label: 'Churn & retention', prompt: 'Based on the dormant free user count, what retention and activation tactics should I implement to move more free users toward paid?' },
]

export default function AdvisorPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const pinnedRef    = useRef(true) // true = auto-scroll to bottom

  // Scroll the chat container (not the page) only when pinned
  useEffect(() => {
    if (!pinnedRef.current) return
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function onContainerScroll() {
    const el = containerRef.current
    if (!el) return
    // Unpin if user scrolled up more than 60px from bottom
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    pinnedRef.current = true // re-pin on every new send
    const userMsg: Message = { role: 'user', content: trimmed }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch('/api/admin/advisor', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ messages: history }),
      })

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: '⚠️ Failed to get a response. Please try again.' }
          return next
        })
        return
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''
      let fullText  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const event = JSON.parse(raw) as {
              type: string
              delta?: { type: string; text?: string }
            }
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              fullText += event.delta.text
              setMessages(prev => {
                const next = [...prev]
                next[next.length - 1] = { role: 'assistant', content: fullText }
                return next
              })
            }
          } catch {}
        }
      }
    } finally {
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--text-primary)',
    outline: 'none',
    resize: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    minHeight: 44,
    maxHeight: 140,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Intro */}
      {messages.length === 0 && (
        <div style={{
          padding: '18px 20px',
          borderRadius: 12,
          background: 'rgba(139,92,246,0.06)',
          border: '1px solid rgba(139,92,246,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Sparkles size={14} color="var(--accent-light)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)' }}>AI Business Advisor</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            Powered by Claude Sonnet with live access to your platform metrics — users, MRR, conversion, and usage data. Ask about marketing, growth, compliance, pricing, or anything else.
          </p>
        </div>
      )}

      {/* Quick prompts */}
      {messages.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {QUICK_PROMPTS.map(({ label, prompt }) => (
            <button
              key={label}
              onClick={() => void send(prompt)}
              disabled={streaming}
              style={{
                fontSize: 11,
                padding: '5px 12px',
                borderRadius: 20,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-light)'; e.currentTarget.style.color = 'var(--accent-light)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Chat messages */}
      {messages.length > 0 && (
        <div
          ref={containerRef}
          onScroll={onContainerScroll}
          style={{
            display: 'flex', flexDirection: 'column', gap: 16,
            maxHeight: 600, overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              gap: 10, alignItems: 'flex-start',
            }}>
              {/* Avatar dot */}
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: msg.role === 'user' ? 'rgba(139,92,246,0.25)' : 'rgba(249,115,22,0.2)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(139,92,246,0.4)' : 'rgba(249,115,22,0.35)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700,
                color: msg.role === 'user' ? 'var(--accent-light)' : '#f97316',
              }}>
                {msg.role === 'user' ? 'B' : 'AI'}
              </div>

              {/* Bubble */}
              <div style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: 10,
                background: msg.role === 'user' ? 'rgba(139,92,246,0.1)' : 'var(--bg-card)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(139,92,246,0.2)' : 'var(--border)'}`,
                fontSize: 12,
                color: 'var(--text-primary)',
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content || (streaming && i === messages.length - 1 ? (
                  <span style={{ color: 'var(--text-muted)' }}>▍</span>
                ) : '')}
                {streaming && i === messages.length - 1 && msg.content && (
                  <span style={{ color: 'var(--text-muted)', animation: 'none' }}>▍</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about marketing, growth, compliance, pricing…"
          rows={1}
          style={inputStyle}
          disabled={streaming}
        />
        <button
          onClick={() => void send(input)}
          disabled={streaming || !input.trim()}
          style={{
            width: 40, height: 40, borderRadius: 8, flexShrink: 0,
            border: 'none',
            background: streaming || !input.trim() ? 'var(--bg-card)' : 'var(--accent)',
            color: streaming || !input.trim() ? 'var(--text-muted)' : '#fff',
            cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
          }}
        >
          {streaming ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />}
        </button>
      </div>

      {/* Reset */}
      {messages.length > 0 && !streaming && (
        <button
          onClick={() => setMessages([])}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 11, padding: 0,
            alignSelf: 'flex-start',
          }}
        >
          <RotateCcw size={11} /> New conversation
        </button>
      )}
    </div>
  )
}
