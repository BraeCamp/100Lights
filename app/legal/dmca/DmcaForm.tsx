'use client'

import { useState } from 'react'

const input: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14,
  border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none',
}
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }

export default function DmcaForm() {
  const [f, setF] = useState({ complainantName: '', email: '', workDescription: '', infringingUrl: '', signature: '' })
  const [goodFaith, setGoodFaith] = useState(false)
  const [accuracy, setAccuracy] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setState('sending'); setErr(null)
    try {
      const res = await fetch('/api/legal/dmca', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, goodFaith, accuracy }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setState('done')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); setState('idle') }
  }

  if (state === 'done') {
    return (
      <div style={{ padding: '28px 22px', borderRadius: 14, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>✓</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>Notice received</h3>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>We review takedown notices promptly and will act on valid ones, contacting you at the email you provided if we need more information.</p>
      </div>
    )
  }

  const cbRow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div><label style={label}>Your name *</label><input required value={f.complainantName} onChange={set('complainantName')} style={input} /></div>
        <div><label style={label}>Contact email *</label><input required type="email" value={f.email} onChange={set('email')} style={input} /></div>
      </div>
      <div><label style={label}>The copyrighted work being infringed *</label>
        <textarea required rows={2} value={f.workDescription} onChange={set('workDescription')} placeholder="Describe or identify your original work" style={{ ...input, resize: 'vertical' }} /></div>
      <div><label style={label}>Where it appears on 100Lights *</label>
        <input required value={f.infringingUrl} onChange={set('infringingUrl')} placeholder="https://100lights.com/community/…" style={input} /></div>

      <label style={cbRow}><input type="checkbox" checked={goodFaith} onChange={e => setGoodFaith(e.target.checked)} style={{ marginTop: 3 }} />
        I have a good-faith belief that the use described is not authorized by the copyright owner, its agent, or the law.</label>
      <label style={cbRow}><input type="checkbox" checked={accuracy} onChange={e => setAccuracy(e.target.checked)} style={{ marginTop: 3 }} />
        Under penalty of perjury, the information in this notice is accurate and I am the copyright owner or authorized to act on their behalf.</label>

      <div><label style={label}>Electronic signature (type your full name) *</label>
        <input required value={f.signature} onChange={set('signature')} style={input} /></div>

      {err && <p style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{err}</p>}
      <button type="submit" disabled={state === 'sending' || !goodFaith || !accuracy} style={{
        justifySelf: 'start', padding: '11px 22px', borderRadius: 10, fontSize: 14.5, fontWeight: 700, border: 'none',
        background: 'var(--accent)', color: '#fff', cursor: state === 'sending' ? 'default' : 'pointer', opacity: (state === 'sending' || !goodFaith || !accuracy) ? 0.55 : 1,
      }}>{state === 'sending' ? 'Submitting…' : 'Submit takedown notice'}</button>
    </form>
  )
}
