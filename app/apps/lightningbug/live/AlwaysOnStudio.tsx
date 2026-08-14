'use client'
// Always-On Studio — the user-facing surface of the offline-live platform. The system that streams a
// 24/7 channel generalizes to "run a program in the cloud so your device can be off". This page shows
// what's running, lets the owner start/stop channels, and lays out the wider job catalog (what else
// this can run). Multi-tenant self-serve is the next phase; today the controls act for the owner.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Radio, Cloud, Play, Square, Circle, Clapperboard, Sparkles, Scissors, Users, Bell, ArrowRight, Power } from 'lucide-react'

type Status = 'starting' | 'live' | 'error' | 'offline'
interface Channel { slug: string; title: string; live: boolean; status: Status; wanted: boolean }

const STATUS_COLOR: Record<Status, string> = { live: '#34d399', starting: '#fbbf24', error: '#f87171', offline: '#6b7280' }

const JOBS = [
  { icon: Radio, name: 'Live music-visual channel', tag: 'Live now', live: true, desc: 'A 24/7 radio-with-visuals broadcast to YouTube/Twitch — audio + reactive visuals, rendered in the cloud. Your computer stays off.' },
  { icon: Clapperboard, name: 'Cloud render & export', tag: 'Planned', live: false, desc: 'Long video / audio exports run on a cloud worker so your laptop is free — get a link when it’s done.' },
  { icon: Sparkles, name: 'Auto-generate & post', tag: 'Planned', live: false, desc: 'The AI makes a fresh track or clip on a schedule and posts it — a self-running content channel.' },
  { icon: Scissors, name: 'Highlight / clip bot', tag: 'Planned', live: false, desc: 'Watch a stream or session, auto-cut the best moments, and share them to socials.' },
  { icon: Users, name: 'Always-on listening room', tag: 'Planned', live: false, desc: 'A jam space or listening party that stays live for your community around the clock.' },
  { icon: Bell, name: 'Watch & notify', tag: 'Planned', live: false, desc: 'Keep an eye on a release, a mention, or a chart, and ping you the moment it changes.' },
]

const btn = (bg: string, fg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', textDecoration: 'none', border: bg === 'transparent' ? '1px solid var(--border)' : 'none', background: bg, color: fg })

export default function AlwaysOnStudio() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [origin, setOrigin] = useState('https://100lights.com')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const load = useCallback(async () => {
    try { const r = await fetch('/api/broadcast/live'); const d = await r.json(); if (Array.isArray(d.channels)) setChannels(d.channels) } catch {}
  }, [])
  useEffect(() => { load(); timer.current = setInterval(load, 5000); return () => { if (timer.current) clearInterval(timer.current) } }, [load])

  const setLive = async (slug: string, live: boolean) => {
    setBusy(slug); setNote(null)
    try {
      const r = await fetch('/api/admin/broadcast/dashboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, live }) })
      if (r.status === 401) { setNote('Starting channels is owner-only for now — per-account channels are the next phase.'); return }
      await load()
    } finally { setBusy(null) }
  }

  const liveCount = channels.filter(c => c.live).length

  return (
    <main style={{ maxWidth: 940, margin: '0 auto', padding: '30px 18px 70px' }}>
      {/* hero */}
      <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 7 }}><Cloud size={15} /> Always-On Studio</p>
      <h1 style={{ fontSize: 'clamp(28px,5vw,42px)', fontWeight: 850, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.05, maxWidth: 640 }}>Run your creations live 24/7 — with your computer off.</h1>
      <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 0 22px', maxWidth: 620, lineHeight: 1.5 }}>
        Start something in 100Lights, hand it to the cloud, and it keeps running around the clock — a broadcast, a render, a bot — no OBS, no machine left on. This is the same always-on engine behind the radio channels, opened up.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <a href="/admin/lightning-bug?tab=radio" style={btn('var(--accent)', '#0e0d12')}><Sparkles size={15} /> Create a channel</a>
        <a href="/admin/lightning-bug?tab=broadcasts" style={btn('transparent', 'var(--text-secondary)')}><Power size={15} /> Control room</a>
      </div>
      {note && <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', margin: '10px 0 0' }}>{note}</p>}

      {/* how it works */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, margin: '30px 0 40px' }}>
        {[['1', 'Set it up', 'Design a channel (or pick a job) right here in 100Lights.'], ['2', 'Hand it off', 'A cloud worker picks it up and starts it — no install, no OBS.'], ['3', 'It stays live', 'It runs 24/7 and self-heals. Turn your devices off; it keeps going.']].map(([n, t, d]) => (
          <div key={n} style={{ padding: '16px 18px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>{n}</div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 3 }}>{t}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>{d}</div>
          </div>
        ))}
      </div>

      {/* live channels */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 12px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Your channels</h2>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{liveCount} live now</span>
      </div>
      <div style={{ display: 'grid', gap: 8, marginBottom: 44 }}>
        {channels.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No channels yet — <a href="/admin/lightning-bug?tab=radio" style={{ color: 'var(--accent)' }}>create one</a>.</p>}
        {channels.map(c => (
          <div key={c.slug} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 15px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <Circle size={11} fill={STATUS_COLOR[c.status]} stroke="none" />
            <div style={{ flex: '1 1 200px', minWidth: 150 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)' }}>{c.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{c.wanted && !c.live ? 'starting…' : c.status}{c.status === 'offline' && c.wanted ? ' · waiting for a worker' : ''}</div>
            </div>
            <a href={`${origin}/apps/lightningbug?station=${c.slug}&broadcast=1`} target="_blank" rel="noreferrer" style={{ ...btn('transparent', 'var(--text-secondary)'), padding: '7px 12px' }}>Preview</a>
            {c.wanted
              ? <button type="button" disabled={busy === c.slug} onClick={() => setLive(c.slug, false)} style={{ ...btn('transparent', '#f87171'), padding: '7px 12px' }}><Square size={14} /> Stop</button>
              : <button type="button" disabled={busy === c.slug} onClick={() => setLive(c.slug, true)} style={{ ...btn('var(--accent)', '#0e0d12'), padding: '7px 12px' }}><Play size={14} /> Go live</button>}
          </div>
        ))}
      </div>

      {/* job catalog — the generalization */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 4px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>What you can run</h2>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 16px', maxWidth: 620 }}>The offline-live engine isn’t only radios. Anything that needs to keep running while you’re away can live here.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
        {JOBS.map(j => (
          <div key={j.name} style={{ padding: '16px 18px', borderRadius: 14, border: `1px solid ${j.live ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-card)', opacity: j.live ? 1 : 0.9 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <j.icon size={20} style={{ color: j.live ? 'var(--accent)' : 'var(--text-muted)' }} />
              <span style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, border: '1px solid var(--border)', color: j.live ? '#34d399' : 'var(--text-muted)' }}>{j.tag}</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{j.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{j.desc}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '34px 0 0', lineHeight: 1.6, maxWidth: 640 }}>
        Under the hood: a control plane in 100Lights decides what should be running; lightweight cloud workers do the work and report back; the fleet scales itself. It runs on cheap, bandwidth-friendly hosts — not a machine of yours. <a href="/apps/lightningbug/broadcast" style={{ color: 'var(--accent)', fontWeight: 700 }}>Broadcast setup <ArrowRight size={11} style={{ verticalAlign: 'middle' }} /></a>
      </p>
    </main>
  )
}
