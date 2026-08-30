'use client'

// In-editor AI assistant chat. Calls /api/ai/assist (auth + usage-billed), then EXECUTES the actions the
// model returns by calling the host editor's own functions — passed in as `execute`. Because it drives
// the editor directly (not the dev-only window.__video hook), it works in production. Self-contained,
// theme-aware, floating panel.
import { useRef, useState, useEffect } from 'react'
import { Sparkles, X, Send, Loader2 } from 'lucide-react'
import { LUMENS_NAME } from '@/lib/credit-tiers'

export interface AssistAction { name: string; input: Record<string, unknown> }
type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'Make a music video of a rainy city night',
  'Add some calm ocean b-roll and auto-edit it',
  'Give every clip a cinematic film look',
  'Cut between the cameras when someone talks',
]

export default function AiAssistant({ module, stateSummary, execute, onClose }: {
  module: string
  stateSummary: () => string
  execute: (action: AssistAction) => Promise<string | void>
  onClose?: () => void
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy])

  async function send(text: string) {
    const t = text.trim(); if (!t || busy) return
    setInput(''); setErr('')
    const next = [...messages, { role: 'user' as const, content: t }]
    setMessages(next); setBusy(true)
    try {
      const r = await fetch('/api/ai/assist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: next, module, stateSummary: stateSummary() }) })
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as { error?: string; needCredits?: boolean }))
        setErr(e.needCredits ? `Out of ${LUMENS_NAME} — top up to continue.` : (e.error || `Error ${r.status}`))
        setBusy(false); return
      }
      const data = await r.json() as { message?: string; actions?: AssistAction[] }
      const results: string[] = []
      for (const a of data.actions ?? []) {
        try { const s = await execute(a); if (s) results.push(s) } catch (e) { results.push('⚠ ' + (e as Error).message) }
      }
      const reply = [data.message?.trim(), results.map(x => '✓ ' + x).join('\n')].filter(Boolean).join('\n\n') || '(done)'
      setMessages(m => [...m, { role: 'assistant', content: reply }])
    } catch { setErr('Couldn’t reach the assistant.') }
    setBusy(false)
  }

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 80, width: 360, maxWidth: 'calc(100vw - 32px)', height: 500, maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column', background: 'var(--bg-card, #16161c)', border: '1px solid var(--border, #2a2a33)', borderRadius: 14, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--border, #2a2a33)' }}>
        <Sparkles size={16} color="var(--accent, #7c3aed)" />
        <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary, #f5f5f7)' }}>AI assistant</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted, #6b6b76)', marginLeft: 2 }}>· {module}</span>
        <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--text-secondary, #a1a1aa)', cursor: 'pointer' }}><X size={16} /></button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto 0', textAlign: 'center', padding: '8px 4px' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #a1a1aa)', lineHeight: 1.6, margin: '0 0 14px' }}>Tell me what to make — I’ll add footage, edit to the beat, apply looks, and more.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} style={{ textAlign: 'left', padding: '8px 11px', borderRadius: 9, fontSize: 12.5, cursor: 'pointer', border: '1px solid var(--border, #2a2a33)', background: 'var(--bg-surface, #1c1c24)', color: 'var(--text-secondary, #a1a1aa)' }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: m.role === 'user' ? 'var(--accent, #7c3aed)' : 'var(--bg-surface, #1c1c24)', color: m.role === 'user' ? '#0e0d12' : 'var(--text-primary, #f5f5f7)', border: m.role === 'user' ? 'none' : '1px solid var(--border, #2a2a33)', fontWeight: m.role === 'user' ? 600 : 400 }}>{m.content}</div>
        ))}
        {busy && <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', fontSize: 12.5, color: 'var(--text-muted, #6b6b76)' }}><Loader2 size={14} className="animate-spin" /> Working…</div>}
        {err && <div style={{ alignSelf: 'stretch', padding: '8px 12px', borderRadius: 10, fontSize: 12.5, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>{err}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--border, #2a2a33)' }}>
        <input
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
          placeholder="Ask the assistant to make or edit…" disabled={busy}
          style={{ flex: 1, padding: '9px 12px', borderRadius: 10, fontSize: 13, outline: 'none', border: '1px solid var(--border, #2a2a33)', background: 'var(--bg-surface, #1c1c24)', color: 'var(--text-primary, #f5f5f7)' }}
        />
        <button onClick={() => send(input)} disabled={busy || !input.trim()} aria-label="Send" style={{ display: 'grid', placeItems: 'center', width: 38, borderRadius: 10, border: 'none', cursor: busy || !input.trim() ? 'default' : 'pointer', background: 'var(--accent, #7c3aed)', color: '#0e0d12', opacity: busy || !input.trim() ? 0.5 : 1 }}><Send size={16} /></button>
      </div>
    </div>
  )
}
