'use client'

import { useState } from 'react'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: 10, fontSize: 14,
  border: '1px solid var(--border, #252540)', background: 'var(--bg-surface, #131320)',
  color: 'var(--text-primary, #f0effe)', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #b8b3ca)', marginBottom: 6, display: 'block',
}

export default function CreatorsApplyForm() {
  const [f, setF] = useState({ name: '', contact: '', platform: '', audience: '', links: '', note: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending'); setErr(null)
    try {
      const res = await fetch('/api/creators/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong — try again.')
      setState('done')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <div style={{
        textAlign: 'center', padding: '40px 24px', borderRadius: 16,
        border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)',
      }}>
        <div style={{ fontSize: 34, marginBottom: 12 }}>🎉</div>
        <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>You&apos;re in the queue</h3>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, maxWidth: 420, marginInline: 'auto', lineHeight: 1.6 }}>
          Thanks — we review founding-seat applications by hand. If it&apos;s a fit, you&apos;ll get your referral link and a ready-to-post kit by email.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div>
          <label style={labelStyle}>Name or handle *</label>
          <input required value={f.name} onChange={set('name')} placeholder="Jane's Beats" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email or DM handle *</label>
          <input required value={f.contact} onChange={set('contact')} placeholder="you@email.com / @yourhandle" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Main platform</label>
          <select value={f.platform} onChange={set('platform')} style={inputStyle}>
            <option value="">Choose…</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="twitch">Twitch</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Audience size</label>
          <input value={f.audience} onChange={set('audience')} placeholder="e.g. 12k subscribers" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Where can we find your work? *</label>
        <input required value={f.links} onChange={set('links')} placeholder="https://youtube.com/@yourchannel" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Anything you&apos;d like us to know? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
        <textarea value={f.note} onChange={set('note')} rows={3} placeholder="What you make, how you'd share 100Lights…" style={{ ...inputStyle, resize: 'vertical' }} />
      </div>
      {err && <p style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{err}</p>}
      <button type="submit" disabled={state === 'sending'} style={{
        justifySelf: 'start', padding: '12px 24px', borderRadius: 11, fontSize: 15, fontWeight: 700,
        cursor: state === 'sending' ? 'default' : 'pointer', border: 'none',
        background: 'var(--accent, #7c3aed)', color: '#fff', opacity: state === 'sending' ? 0.65 : 1,
      }}>
        {state === 'sending' ? 'Sending…' : 'Apply for a founding seat →'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
        No cost, no commitment. We review each application and reply if it&apos;s a fit.
      </p>
    </form>
  )
}
