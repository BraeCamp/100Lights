'use client'
// Always-On Studio — user surface of the offline-live platform (bright product design). Real: live
// status + owner start/stop. The job catalog + plans show where it's headed (multi-tenant is next).
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Radio, Play, Square, Clapperboard, Sparkles, Scissors, Users, Bell, Cloud, Infinity as Inf, SlidersHorizontal } from 'lucide-react'

type Status = 'starting' | 'live' | 'error' | 'offline'
interface Channel { slug: string; title: string; live: boolean; status: Status; wanted: boolean }
const DOT: Record<Status, string> = { live: '#17a673', starting: '#c98a12', error: '#d64550', offline: '#9aa0ac' }

const JOBS = [
  { icon: Radio, name: 'Live music-visual channel', tag: 'Live now', live: true, desc: 'A 24/7 radio-with-visuals broadcast to YouTube/Twitch — audio + reactive visuals in the cloud.' },
  { icon: Clapperboard, name: 'Cloud render & export', tag: 'Planned', live: false, desc: 'Long video / audio exports run on a worker so your laptop is free — get a link when it’s done.' },
  { icon: Sparkles, name: 'Auto-generate & post', tag: 'Planned', live: false, desc: 'The AI makes a fresh track or clip on a schedule and posts it — a self-running content channel.' },
  { icon: Scissors, name: 'Highlight / clip bot', tag: 'Planned', live: false, desc: 'Watch a stream or session, auto-cut the best moments, and share them to socials.' },
  { icon: Users, name: 'Always-on listening room', tag: 'Planned', live: false, desc: 'A jam space or listening party that stays live for your community around the clock.' },
  { icon: Bell, name: 'Watch & notify', tag: 'Planned', live: false, desc: 'Keep an eye on a release, a mention, or a chart, and ping you the moment it changes.' },
]
const PLANS: [string, string, string, boolean][] = [
  ['Hobby', 'Free', '1 channel · 720p', false],
  ['Creator', '$12/mo', '3 channels · 1080p', true],
  ['Studio', '$39/mo', 'Unlimited · priority', false],
]

const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px' }

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
      if (r.status === 401) { setNote('Starting channels is owner-only for now — per-account channels are coming.'); return }
      await load()
    } finally { setBusy(null) }
  }
  const liveOnes = channels.filter(c => c.live)

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-base)', paddingBottom: 80 }}>
      {/* hero */}
      <section style={{ textAlign: 'center', padding: '72px 22px 36px', maxWidth: 720, margin: '0 auto' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)', padding: '6px 14px', borderRadius: 999 }}><Cloud size={14} /> Always-On Studio</span>
        <h1 style={{ fontSize: 'clamp(34px,6vw,54px)', fontWeight: 850, letterSpacing: '-.03em', lineHeight: 1.04, margin: '20px 0 0', backgroundImage: 'linear-gradient(90deg, var(--text-primary), var(--accent))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Your channel, live 24/7.<br />Your computer, off.</h1>
        <p style={{ fontSize: 18, color: 'var(--text-secondary)', margin: '20px auto 0', maxWidth: 520, lineHeight: 1.5 }}>Design it once, hand it to the cloud, and it runs around the clock. No OBS, no machine left humming.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
          <Link href="/admin/lightning-bug?tab=radio" style={{ padding: '13px 26px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 15, fontWeight: 850, textDecoration: 'none', boxShadow: '0 8px 22px color-mix(in srgb, var(--accent) 35%, transparent)' }}>Start a channel — free</Link>
          {liveOnes[0] && <a href={`${origin}/apps/lightningbug?station=${liveOnes[0].slug}&broadcast=1`} target="_blank" rel="noreferrer" style={{ padding: '13px 22px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>▷ See it live</a>}
        </div>
        {note && <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', marginTop: 14 }}>{note}</p>}
      </section>

      <div style={{ maxWidth: 940, margin: '0 auto', padding: '0 22px' }}>
        {/* live-now strip */}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 30 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 850, color: liveOnes.length ? '#17a673' : 'var(--text-muted)' }}><span style={{ width: 9, height: 9, borderRadius: 9, background: liveOnes.length ? '#17a673' : 'var(--text-muted)' }} /> {liveOnes.length} LIVE NOW</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 14, minWidth: 0, flex: 1 }}>{liveOnes.length ? liveOnes.map(c => c.title.split('—')[0].trim()).join(' · ') + ' — streaming right now' : 'No channels live — start one to see it here.'}</span>
          {liveOnes[0] && <a href={`${origin}/apps/lightningbug?station=${liveOnes[0].slug}&broadcast=1`} target="_blank" rel="noreferrer" style={{ padding: '8px 16px', borderRadius: 999, border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)', color: 'var(--accent)', fontWeight: 800, fontSize: 13, textDecoration: 'none' }}>Watch</a>}
        </div>

        {/* value cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 34 }}>
          {[[SlidersHorizontal, 'Make it yours', 'Every visual, palette, and playlist — designed in the studio you already know.'], [Cloud, 'Runs in the cloud', 'We spin up a worker, stream it, and scale the fleet. You do nothing.'], [Inf, 'Never sleeps', '24/7 and self-healing. Turn everything off; it keeps broadcasting.']].map(([Ic, t, d]) => (
            <div key={t as string} style={card}>
              <div style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', marginBottom: 12 }}>{(() => { const I = Ic as typeof Cloud; return <I size={20} /> })()}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 5 }}>{t as string}</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{d as string}</div>
            </div>
          ))}
        </div>

        {/* your channels (real) */}
        <h2 style={{ fontSize: 18, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 12px' }}>Your channels</h2>
        <div style={{ display: 'grid', gap: 10, marginBottom: 40 }}>
          {channels.length === 0 && <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>No channels yet — <a href="/admin/lightning-bug?tab=radio" style={{ color: 'var(--accent)' }}>create one</a>.</p>}
          {channels.map(c => (
            <div key={c.slug} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
              <span style={{ width: 10, height: 10, borderRadius: 9, background: DOT[c.status], flexShrink: 0 }} />
              <div style={{ flex: '1 1 200px', minWidth: 150 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{c.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{c.wanted && !c.live ? 'starting…' : c.status}</div>
              </div>
              <a href={`${origin}/apps/lightningbug?station=${c.slug}&broadcast=1`} target="_blank" rel="noreferrer" style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>Preview</a>
              {c.wanted
                ? <button type="button" disabled={busy === c.slug} onClick={() => setLive(c.slug, false)} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: '#d64550', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}><Square size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Stop</button>
                : <button type="button" disabled={busy === c.slug} onClick={() => setLive(c.slug, true)} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontWeight: 850, fontSize: 13, cursor: 'pointer' }}><Play size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Go live</button>}
            </div>
          ))}
        </div>

        {/* what you can run */}
        <h2 style={{ fontSize: 18, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 4px' }}>What you can run</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 16px', maxWidth: 620 }}>The offline-live engine isn’t only radios — anything that needs to keep running while you’re away can live here.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16, marginBottom: 40 }}>
          {JOBS.map(j => (
            <div key={j.name} style={{ ...card, border: `1px solid ${j.live ? 'var(--accent)' : 'var(--border)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <j.icon size={20} style={{ color: j.live ? 'var(--accent)' : 'var(--text-muted)' }} />
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, border: '1px solid var(--border)', color: j.live ? '#17a673' : 'var(--text-muted)' }}>{j.tag}</span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{j.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{j.desc}</div>
            </div>
          ))}
        </div>

        {/* plans (vision) */}
        <h2 style={{ fontSize: 18, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 4px' }}>Plans</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 16px' }}>Preview — self-serve billing lands with per-account channels.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
          {PLANS.map(([n, p, d, hi]) => (
            <div key={n} style={{ ...card, border: hi ? '2px solid var(--accent)' : card.border, position: 'relative' }}>
              {hi && <span style={{ position: 'absolute', top: -11, left: 20, background: 'var(--accent)', color: '#0e0d12', fontSize: 11, fontWeight: 850, padding: '3px 10px', borderRadius: 999 }}>POPULAR</span>}
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{n}</div>
              <div style={{ fontSize: 26, fontWeight: 850, color: 'var(--text-primary)', margin: '6px 0 2px' }}>{p}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
