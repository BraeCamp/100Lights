'use client'

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Check, Circle, AlertTriangle, Search } from 'lucide-react'

// Everything the studio can say aloud, and which of it has been paid for.
//
// The point of this panel is the second column. The voice cache is shared
// across every user — a phrase is rendered by whoever says it first and then
// belongs to the product — so "bought" is a permanent, one-time fact, and the
// only real question anyone has here is which sentences still cost money and
// how much. Everything else on the page is in service of that.

interface Phrase {
  text: string
  display: string
  where: string
  kind: 'fixed' | 'shape'
  key: string | null
  bought: boolean
  speakable: boolean
  chars: number | null
  size: number
  modified: string | null
}
interface Spoken { text: string | null; key: string; size: number; modified: string | null }
interface Data {
  voiceId: string
  configured: { elevenlabs: boolean; storage: boolean }
  generated: string
  rate: number
  totals: {
    fixed: number; shapes: number; bought: number; pending: number
    pendingCost: number; spentSoFar: number
    inStorage: number; bytes: number; spokenCount: number; spokenShown: number
  }
  fixed: Phrase[]
  shapes: Phrase[]
  spoken: Spoken[]
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`
}

type Tab = 'fixed' | 'shapes' | 'spoken'

export default function VoicePhrasesPanel() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('fixed')
  const [q, setQ] = useState('')

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/voice-phrases')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData(d)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    const list: (Phrase | Spoken)[] =
      tab === 'fixed' ? data.fixed : tab === 'shapes' ? data.shapes : data.spoken
    if (!needle) return list
    return list.filter(r => {
      const text = 'display' in r ? r.display : (r.text ?? '')
      const where = 'where' in r ? r.where : ''
      return text.toLowerCase().includes(needle) || where.toLowerCase().includes(needle)
    })
  }, [data, tab, q])

  const t = data?.totals

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Reading storage…' : 'Rescan'}
        </button>
        {data && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            voice <code style={{ fontFamily: 'ui-monospace, monospace' }}>{data.voiceId}</code>
            {' · '}phrase list generated {data.generated}
          </span>
        )}
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {/* Why nothing is bought, when nothing is bought. A zero with no
          explanation reads as a broken panel rather than an unset permission. */}
      {data && !data.configured.elevenlabs && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: '1px solid #f59e0b55', background: '#f59e0b14', borderRadius: 10, padding: '10px 12px' }}>
          <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>No voice key configured.</strong>{' '}
            Nothing can be recorded, so the studio uses the browser&rsquo;s own voice everywhere. The key in
            use needs the <code style={{ fontFamily: 'ui-monospace, monospace' }}>text_to_speech</code>{' '}
            permission; no code changes are needed once it has it.
          </div>
        </div>
      )}

      {t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Bought" value={`${t.bought} / ${t.fixed}`}
            sub={t.bought ? `${bytes(t.bytes)} in storage` : 'nothing recorded yet'} accent="#34d399" />
          <Stat label="Still to buy" value={t.pending}
            sub={t.pending ? `about $${t.pendingCost.toFixed(2)}, once` : 'all bought'} accent="#f59e0b" />
          <Stat label="Templated" value={t.shapes}
            sub="carry a name — bought as said" accent="#a78bfa" />
          <Stat label="Said by people" value={t.spokenCount}
            sub={t.spokenCount > t.spokenShown ? `newest ${t.spokenShown} listed` : 'all listed'} accent="#38bdf8" />
        </div>
      )}

      {/* The sentence this whole feature exists to make true. */}
      {t && (
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0 }}>
          Every recording is shared by everyone — a phrase is paid for by whoever says it first and is then
          free forever, for every user there will ever be. Buying the remaining fixed phrases costs about
          <strong style={{ color: 'var(--text-secondary)' }}> ${t.pendingCost.toFixed(2)} </strong>
          in total (at ${data?.rate.toFixed(2)}/1k characters — the published rate; the account&rsquo;s own
          rate can&rsquo;t be read). Run <code style={{ fontFamily: 'ui-monospace, monospace' }}>npm run voice:prerender</code> to
          buy them up front.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['fixed', 'shapes', 'spoken'] as Tab[]).map(id => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${tab === id ? 'var(--accent)' : 'var(--border)'}`,
              background: tab === id ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-card)',
              color: tab === id ? 'var(--accent)' : 'var(--text-secondary)',
            }}>
            {id === 'fixed' ? `Fixed (${data?.totals.fixed ?? 0})`
              : id === 'shapes' ? `Templated (${data?.totals.shapes ?? 0})`
                : `Said by people (${data?.totals.spokenShown ?? 0})`}
          </button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px', background: 'var(--bg-card)' }}>
          <Search size={12} style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter phrases…"
            style={{ fontSize: 12, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', width: 190 }} />
        </div>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
        {tab === 'fixed' && 'Said word-for-word every time, so each one is recorded once and then costs nothing forever.'}
        {tab === 'shapes' && 'These carry a track name, so they have no single recording — each distinct final sentence is bought the first time somebody says it. Names overlap heavily between users, so these converge too.'}
        {tab === 'spoken' && 'Recordings people have actually caused, read back from what was stored alongside each one. The key is a hash of the text, which is what lets two users share a recording without either knowing about the other.'}
      </p>

      {!data && !err && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Reading storage…</p>}

      {data && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r, i) => {
                const isPhrase = 'display' in r
                const text = isPhrase ? r.display : (r.text ?? '(recorded before the text was stored)')
                return (
                  <tr key={isPhrase ? r.text : r.key}
                    style={{ borderTop: i ? '1px solid var(--border)' : 'none', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                    <td className="px-3 py-2" style={{ width: 24 }}>
                      {isPhrase && r.kind === 'fixed'
                        ? (r.bought
                          ? <Check size={13} style={{ color: '#34d399' }} aria-label="bought" />
                          : <Circle size={11} style={{ color: 'var(--text-muted)' }} aria-label="not bought yet" />)
                        : !isPhrase
                          ? <Check size={13} style={{ color: '#38bdf8' }} aria-label="stored" />
                          : <span style={{ fontSize: 10, color: '#a78bfa' }}>◆</span>}
                    </td>
                    <td className="px-2 py-2 text-xs" style={{
                      color: isPhrase && !r.speakable ? 'var(--text-muted)' : 'var(--text-primary)',
                    }}>
                      {text}
                      {isPhrase && !r.speakable && (
                        <span title="Refused by the endpoint's own gate — too long or too odd to speak, so this one always uses the browser voice."
                          style={{ marginLeft: 6, fontSize: 10, color: '#f59e0b' }}>never spoken</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {isPhrase
                        ? (r.kind === 'fixed'
                          ? (r.bought ? bytes(r.size) : r.chars != null ? `$${((r.chars / 1000) * data.rate).toFixed(4)}` : '')
                          : '')
                        : bytes(r.size)}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {isPhrase ? r.where : (r.modified ?? '').slice(0, 10)}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td className="px-4 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {tab === 'spoken' ? 'Nobody has caused a recording yet.' : q ? 'Nothing matches that.' : 'Nothing here.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 750, marginTop: 4, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
