'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Download, Film } from 'lucide-react'

interface Short { name: string; slug: string; duration: number; caption: string }
interface Data { folder: string; count: number; shorts: Short[] }

// Admin-only export pass: lists the shorts in the account's "Shorts › Tests" folder and downloads
// them as a zip (each short's mp4 + its ready-to-post caption). The zip is built server-side from
// the already-rendered R2 videos — see lib/shorts-export.ts + /api/admin/shorts-export.
export default function ShortsExportPanel() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const [dl, setDl] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [folder, setFolder] = useState('Tests')

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/shorts-export?folder=${encodeURIComponent(folder)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData(d)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function downloadZip() {
    setDl(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/shorts-export?zip=1&folder=${encodeURIComponent(folder)}`)
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`) }
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `shorts-${folder.toLowerCase()}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Download failed') } finally { setDl(false) }
  }

  const btn = (bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 8,
    border: 'none', background: bg, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Folder:&nbsp;
          <input value={folder} onChange={e => setFolder(e.target.value)}
            style={{ fontSize: 12.5, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', width: 120 }} />
        </label>
        <button onClick={() => void load()} disabled={busy} style={btn('var(--bg-card)')}>
          <RefreshCw size={14} style={{ animation: busy ? 'spin 1s linear infinite' : undefined }} /> Refresh
        </button>
        <button onClick={() => void downloadZip()} disabled={dl || !data?.count} style={btn('#3b82f6')}>
          <Download size={14} /> {dl ? 'Zipping…' : `Download all${data?.count ? ` (${data.count})` : ''}`}
        </button>
      </div>

      {err && <div style={{ fontSize: 12.5, color: '#f87171' }}>{err}</div>}

      {data && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {data.count} short{data.count === 1 ? '' : 's'} in <b style={{ color: 'var(--text-primary)' }}>{data.folder}</b> — each exports as an mp4 + a caption .txt, ready to post.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {(data?.shorts ?? []).map(s => (
          <div key={s.slug} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <Film size={16} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{s.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(s.duration)}s</span>
              </div>
              <pre style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{s.caption}</pre>
            </div>
          </div>
        ))}
        {data && data.count === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No shorts found. Build some with <code>scripts/build-shorts.mjs</code>.</div>}
      </div>
    </div>
  )
}
