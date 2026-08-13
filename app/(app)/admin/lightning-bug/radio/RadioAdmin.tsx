'use client'
import { useState } from 'react'
import { STATIONS } from '@/lib/stations'
import { Radio, Search, ExternalLink, ChevronDown } from 'lucide-react'

interface Track { title: string; artist?: string; url: string; license?: string }
interface JTrack { id: string; title: string; artist: string; audio: string; license: string; album?: string; duration?: number; shareurl?: string }

const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')
const inp = { padding: '8px 11px', borderRadius: 9, fontSize: 13, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)' } as const

export default function RadioAdmin() {
  // ---- station playlists ----
  const [open, setOpen] = useState<string | null>(null)
  const [pl, setPl] = useState<Track[]>([])
  const [plSource, setPlSource] = useState('')
  const [plLoading, setPlLoading] = useState(false)
  const loadPlaylist = async (slug: string) => {
    if (open === slug) { setOpen(null); return }
    setOpen(slug); setPlLoading(true); setPl([])
    try { const r = await fetch(`/api/broadcast/playlist?station=${slug}`); const d = await r.json(); setPl(d.tracks || []); setPlSource(d.source || '') } finally { setPlLoading(false) }
  }

  // ---- Jamendo search ----
  const [q, setQ] = useState('')
  const [tagMode, setTagMode] = useState(false)
  const [results, setResults] = useState<JTrack[]>([])
  const [sLoading, setSLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const search = async () => {
    if (!q.trim()) return
    setSLoading(true); setSearched(true); setMsg(null)
    try {
      const param = tagMode ? `tags=${encodeURIComponent(q.trim().replace(/\s+/g, '+'))}` : `q=${encodeURIComponent(q.trim())}`
      const r = await fetch(`/api/admin/jamendo?${param}`)
      const d = await r.json()
      if (d.error) { setMsg(d.message || d.error); setResults([]) } else setResults(d.tracks || [])
    } catch { setResults([]) } finally { setSLoading(false) }
  }

  const row = (title: string, sub: string, audio: string, right?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      <audio controls preload="none" src={audio} style={{ height: 30, flex: '1 1 220px', maxWidth: 320 }} />
      {right}
    </div>
  )

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 18px 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}><Radio size={22} /> Lightning Bug — Radio</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        See + listen to what's in each station's playlist, and search Jamendo's catalogue by name or tag — all in here, no need for Jamendo's site.
      </p>
      <p style={{ fontSize: 12.5, margin: '0 0 22px' }}>
        <a href="/admin/lightning-bug" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>← Background library</a>
      </p>

      {/* Station playlists */}
      <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-secondary)', margin: '0 0 10px' }}>Station playlists</h2>
      <div style={{ display: 'grid', gap: 10, marginBottom: 32 }}>
        {STATIONS.map(s => (
          <div key={s.slug} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', padding: '12px 16px' }}>
            <button type="button" onClick={() => loadPlaylist(s.slug)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{s.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.tagline} · <code>{s.slug}</code></div>
              </div>
              <ChevronDown size={18} style={{ color: 'var(--text-muted)', transform: open === s.slug ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {open === s.slug && (
              <div style={{ marginTop: 10 }}>
                {plLoading ? <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading playlist…</p>
                  : pl.length ? (
                    <>
                      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 4px' }}>{pl.length} tracks · source: {plSource}</p>
                      <div style={{ maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
                        {pl.map((t, i) => row(t.title, `${t.artist || ''}${t.license ? ` · ${t.license.replace('http://creativecommons.org/licenses/', 'CC ').replace(/\/$/, '')}` : ''}`, t.url))}
                      </div>
                    </>
                  ) : <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No tracks — drop files in public/broadcast/{s.slug}/ or check the Jamendo tags/key.</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Jamendo search */}
      <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-secondary)', margin: '0 0 10px' }}>Search Jamendo</h2>
      <form onSubmit={e => { e.preventDefault(); search() }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tagMode ? 'tags (e.g. ambient cinematic drone)' : 'song or artist name'} style={{ ...inp, flex: '1 1 260px', minWidth: 200 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={tagMode} onChange={e => setTagMode(e.target.checked)} /> by tag
        </label>
        <button type="submit" disabled={sLoading || !q.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#0e0d12', opacity: sLoading || !q.trim() ? 0.5 : 1 }}><Search size={14} /> {sLoading ? 'Searching…' : 'Search'}</button>
        {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>{msg}</span>}
      </form>
      {searched && !sLoading && (
        results.length ? (
          <div style={{ maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
            {results.map(t => row(
              t.title,
              `${t.artist}${t.album ? ` · ${t.album}` : ''}${t.duration ? ` · ${dur(t.duration)}` : ''}`,
              t.audio,
              t.shareurl ? <a href={t.shareurl} target="_blank" rel="noreferrer" title="Open on Jamendo" style={{ color: 'var(--text-muted)', flexShrink: 0 }}><ExternalLink size={15} /></a> : null,
            ))}
          </div>
        ) : <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No results — try different words, or toggle “by tag”.</p>
      )}
    </main>
  )
}
