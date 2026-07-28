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

export default function TaxForm({ token, classes, storeTin, existing }: {
  token: string
  classes: string[]
  storeTin: boolean
  existing: { legalName: string | null; businessName: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; taxClass: string | null; w9Received: boolean }
}) {
  const [f, setF] = useState({
    legalName: existing.legalName ?? '', businessName: existing.businessName ?? '',
    address: existing.address ?? '', city: existing.city ?? '', state: existing.state ?? '', zip: existing.zip ?? '',
    taxClass: existing.taxClass ?? classes[0], tin: '',
  })
  const [state, setState] = useState<'idle' | 'saving' | 'done'>(existing.w9Received ? 'done' : 'idle')
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setState('saving'); setErr(null)
    try {
      const res = await fetch(`/api/creators/tax/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setState('done')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); setState('idle') }
  }

  if (state === 'done') {
    return (
      <div style={{ textAlign: 'center', padding: '36px 24px', borderRadius: 16, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>Details received</h3>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, maxWidth: 400, marginInline: 'auto', lineHeight: 1.6 }}>
          Thanks — you&apos;re all set to be paid. You can re-open this link anytime to update your info.
        </p>
        <button onClick={() => setState('idle')} style={{ marginTop: 16, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>Update details</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div><label style={labelStyle}>Legal name *</label><input required value={f.legalName} onChange={set('legalName')} placeholder="Your full legal name" style={inputStyle} /></div>
        <div><label style={labelStyle}>Business name <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(if any)</span></label><input value={f.businessName} onChange={set('businessName')} placeholder="LLC / DBA" style={inputStyle} /></div>
      </div>
      <div><label style={labelStyle}>Federal tax classification</label>
        <select value={f.taxClass} onChange={set('taxClass')} style={inputStyle}>{classes.map(c => <option key={c} value={c}>{c}</option>)}</select>
      </div>
      <div><label style={labelStyle}>Mailing address *</label><input required value={f.address} onChange={set('address')} placeholder="Street address" style={inputStyle} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div><label style={labelStyle}>City</label><input value={f.city} onChange={set('city')} style={inputStyle} /></div>
        <div><label style={labelStyle}>State</label><input value={f.state} onChange={set('state')} maxLength={2} placeholder="CA" style={inputStyle} /></div>
        <div><label style={labelStyle}>ZIP</label><input value={f.zip} onChange={set('zip')} style={inputStyle} /></div>
      </div>

      {storeTin ? (
        <div>
          <label style={labelStyle}>SSN or EIN (TIN) *</label>
          <input value={f.tin} onChange={set('tin')} inputMode="numeric" placeholder="XXX-XX-XXXX" autoComplete="off" style={inputStyle} />
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>Encrypted and used only to issue your year-end 1099. Never shown again.</p>
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, padding: '10px 12px', borderRadius: 9, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          We&apos;ll request your SSN/EIN securely through our tax-filing service closer to year-end — no need to enter it here.
        </p>
      )}

      {err && <p style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{err}</p>}
      <button type="submit" disabled={state === 'saving'} style={{
        justifySelf: 'start', padding: '12px 24px', borderRadius: 11, fontSize: 15, fontWeight: 700,
        cursor: state === 'saving' ? 'default' : 'pointer', border: 'none', background: 'var(--accent, #7c3aed)', color: '#fff', opacity: state === 'saving' ? 0.65 : 1,
      }}>{state === 'saving' ? 'Saving…' : 'Save my details'}</button>
    </form>
  )
}
