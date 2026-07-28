'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Service { name: string; ok: boolean; ms: number; error: string | null }
interface Data { services: Service[]; checkedAt: string; allOk: boolean }

export default function StatusPanel() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/status')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData(d)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  // Email deliverability check
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailResult, setEmailResult] = useState<{ ok: boolean; enabled: boolean; to: string; from: string; error?: string } | null>(null)
  async function sendTest() {
    setEmailBusy(true); setEmailResult(null)
    try {
      const r = await fetch('/api/admin/email-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      setEmailResult(await r.json())
    } catch { setEmailResult({ ok: false, enabled: false, to: '', from: '', error: 'Request failed' }) }
    finally { setEmailBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Probing…' : 'Recheck'}
        </button>
        {data && (
          <span style={{ fontSize: 12, fontWeight: 700, color: data.allOk ? '#34d399' : '#ef4444' }}>
            {data.allOk ? 'All systems operational' : 'Something is down'}
          </span>
        )}
        {data && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>checked {new Date(data.checkedAt).toLocaleTimeString()}</span>}
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {!data && !err && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Probing services…</p>}

      {data && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {data.services.map((s, i) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--border)' : 'none', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.ok ? '#34d399' : '#ef4444', flexShrink: 0, boxShadow: s.ok ? '0 0 8px rgba(52,211,153,0.6)' : '0 0 8px rgba(239,68,68,0.6)' }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                {s.error && <span style={{ fontSize: 11, color: '#f87171', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.error}</span>}
                <span style={{ fontSize: 11.5, fontWeight: 700, color: s.ok ? 'var(--text-secondary)' : '#ef4444', fontVariantNumeric: 'tabular-nums' }}>{s.ok ? `${s.ms} ms` : 'DOWN'}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Probes run live from the server when this tab opens or you hit Recheck. Latency is round-trip from the app.</p>

      {/* Email deliverability */}
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Transactional email</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Sends a test to your admin email to confirm Resend + your sending domain.</div>
          </div>
          <button onClick={() => void sendTest()} disabled={emailBusy} style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(139,92,246,0.2)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.35)', opacity: emailBusy ? 0.6 : 1,
          }}>{emailBusy ? 'Sending…' : 'Send test email'}</button>
        </div>
        {emailResult && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12 }}>
            {emailResult.ok ? (
              <span style={{ color: '#34d399', fontWeight: 700 }}>✓ Sent to {emailResult.to} from {emailResult.from} — check your inbox (and spam).</span>
            ) : !emailResult.enabled ? (
              <span style={{ color: '#f59e0b', fontWeight: 700 }}>Email is off — set RESEND_API_KEY in Vercel and redeploy.</span>
            ) : (
              <span style={{ color: '#ef4444' }}>
                <strong>Failed</strong> — the app tried to send from <strong>{emailResult.from}</strong>. {emailResult.error}
                {/domain/i.test(emailResult.error ?? '') && <><br /><span style={{ color: 'var(--text-secondary)' }}>The domain in that from-address must exactly match a Verified domain in Resend. If it says @100lights.com but you verified send.100lights.com, set EMAIL_FROM in Vercel and redeploy.</span></>}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
