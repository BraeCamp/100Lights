'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { STATIONS } from '@/lib/stations'
import { Radio, Copy, Check, Play, ListMusic } from 'lucide-react'

type LauncherStation = { slug: string; title: string; tagline: string }

// Launcher for the 24/7 broadcast stations: preview each, and copy the OBS Browser-Source URL.
export default function BroadcastLauncher() {
  const [origin, setOrigin] = useState('https://100lights.com')
  const [copied, setCopied] = useState<string | null>(null)
  const [credits, setCredits] = useState<string | null>(null)
  // Enabled stations come from the DB (edited in the radio admin); the code list is the fallback.
  const [stations, setStations] = useState<LauncherStation[]>(() => STATIONS.map(s => ({ slug: s.slug, title: s.title, tagline: s.tagline })))
  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => {
    fetch('/api/broadcast/stations').then(r => r.json()).then(d => { if (Array.isArray(d.stations) && d.stations.length) setStations(d.stations) }).catch(() => {})
  }, [])

  const url = (slug: string) => `${origin}/lightningbug?station=${slug}&broadcast=1`
  const copy = async (slug: string) => {
    try { await navigator.clipboard.writeText(url(slug)); setCopied(slug); setTimeout(() => setCopied(c => (c === slug ? null : c)), 1600) } catch { /* clipboard blocked */ }
  }
  // Build the full attribution block for the video description from the station's ACTUAL playlist
  // (covers every track regardless of shuffle order). Works for KM/static, Jamendo, or local files.
  const copyCredits = async (slug: string, title: string) => {
    try {
      const r = await fetch(`/api/broadcast/playlist?station=${slug}`)
      const d = await r.json()
      const tracks: { title: string; artist?: string; attribution?: string; license?: string }[] = d.tracks || []
      if (!tracks.length) { setCredits(slug); setTimeout(() => setCredits(c => (c === slug ? null : c)), 1600); return }
      const lines = [...new Set(tracks.map(t => t.attribution || `${t.title}${t.artist ? ` — ${t.artist}` : ''}`))]
      const anyCC = tracks.some(t => (t.license || '').toUpperCase().includes('CC'))
      const text = [
        `♪ Music in this stream — ${title}:`,
        ...lines.map(l => `• ${l}`),
        '',
        anyCC ? 'Licensed under Creative Commons: By Attribution 3.0 — https://creativecommons.org/licenses/by/3.0/' : '',
        'Visuals: Lightning Bug (100lights.com).',
      ].filter(Boolean).join('\n')
      await navigator.clipboard.writeText(text)
      setCredits(slug); setTimeout(() => setCredits(c => (c === slug ? null : c)), 1600)
    } catch { /* clipboard/network blocked */ }
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '28px 18px 60px' }}>
      <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 8px' }}>Lightning Bug · Broadcast</p>
      <h1 style={{ fontSize: 30, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Radio stations</h1>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 24px', lineHeight: 1.5, maxWidth: 620 }}>
        Each station is a visual scene + a playlist, ready to stream 24/7. <strong>Open</strong> to preview it full-frame,
        or <strong>Copy OBS URL</strong> and paste it into an OBS Browser Source (1920×1080). Setup + music sources are in
        <code style={{ padding: '1px 5px', margin: '0 3px', borderRadius: 5, background: 'var(--bg-card)', fontSize: 12.5 }}>BROADCAST.md</code>.
      </p>

      <div style={{ display: 'grid', gap: 12 }}>
        {stations.map(s => (
          <div key={s.slug} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '16px 18px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: 'var(--accent)', color: '#0e0d12' }}><Radio size={22} /></span>
            <div style={{ minWidth: 180, flex: '1 1 260px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{s.tagline}</div>
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>?station={s.slug}</code>
            </div>
            <a href={url(s.slug)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800, textDecoration: 'none', background: 'var(--accent)', color: '#0e0d12' }}><Play size={15} /> Open</a>
            <button type="button" onClick={() => copy(s.slug)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>
              {copied === s.slug ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy OBS URL</>}
            </button>
            <button type="button" onClick={() => copyCredits(s.slug, s.title)} title="Copy the full track credits for the YouTube description" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>
              {credits === s.slug ? <><Check size={15} /> Copied</> : <><ListMusic size={15} /> Copy credits</>}
            </button>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12.5, margin: '20px 0 0', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Link href="/admin/lightning-bug/radio" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>Radio admin →</Link>
        <a href="/admin/lightning-bug" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>Background library admin →</a>
      </p>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>Radio admin: create/edit stations (look, audio source, playlist) live — no redeploy. Background admin: curate Pexels. (Owner + admin code.)</p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.6 }}>
        Edit stations in the <a href="/admin/lightning-bug/radio" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>radio admin</a>.
        For the most reliable 24/7 audio, drop licensed files into <code style={{ padding: '1px 5px', borderRadius: 5, background: 'var(--bg-card)', fontSize: 11.5 }}>public/broadcast/&lt;slug&gt;/</code>;
        otherwise set a Jamendo tag on the station (needs <code style={{ padding: '1px 5px', borderRadius: 5, background: 'var(--bg-card)', fontSize: 11.5 }}>JAMENDO_CLIENT_ID</code>).
      </p>
    </main>
  )
}
