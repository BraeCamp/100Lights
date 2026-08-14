'use client'
// Broadcasts dashboard — the control-plane cockpit. Shows every broadcast's live status (reported by
// the worker agents), lets you Start/Stop each (sets desired-live; agents reconcile within seconds),
// and lists the connected worker boxes. Reads /api/admin/broadcast/dashboard on a short poll.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Radio, Play, Square, Cpu, Circle, RefreshCw, AlertTriangle } from 'lucide-react'

type Status = 'starting' | 'live' | 'error' | 'offline'
interface RuntimeRow { slug: string; title: string; enabled: boolean; desiredLive: boolean; status: Status; workerId: string | null; fps: number | null; error: string | null; lastHeartbeat: string | null; stale: boolean }
interface AgentRow { workerId: string; lastSeen: string; capacity: number; running: number; stale: boolean }

const STATUS_COLOR: Record<Status, string> = { live: '#34d399', starting: '#fbbf24', error: '#f87171', offline: '#6b7280' }
const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}
const btn = (bg: string, fg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: bg === 'transparent' ? '1px solid var(--border)' : 'none', background: bg, color: fg })

export default function BroadcastsDashboard() {
  const [runtime, setRuntime] = useState<RuntimeRow[]>([])
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [agentConfigured, setAgentConfigured] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/admin/broadcast/dashboard'); const d = await r.json(); if (Array.isArray(d.runtime)) setRuntime(d.runtime); if (Array.isArray(d.agents)) setAgents(d.agents); setAgentConfigured(d.agentConfigured !== false) } catch {} finally { setLoaded(true) }
  }, [])
  useEffect(() => { load(); timer.current = setInterval(load, 5000); return () => { if (timer.current) clearInterval(timer.current) } }, [load])

  const setLive = async (slug: string, live: boolean) => {
    setBusy(slug)
    try { const r = await fetch('/api/admin/broadcast/dashboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, live }) }); const d = await r.json(); if (Array.isArray(d.runtime)) setRuntime(d.runtime) } finally { setBusy(null) }
  }

  const liveCount = runtime.filter(r => r.status === 'live').length
  const wantCount = runtime.filter(r => r.desiredLive).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 6px' }}>
        <h2 style={{ fontSize: 16, fontWeight: 850, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Radio size={18} /> Broadcasts</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{liveCount} live · {wantCount} wanted · {agents.filter(a => !a.stale).length} worker{agents.filter(a => !a.stale).length === 1 ? '' : 's'} online</span>
        <button type="button" onClick={load} title="Refresh" style={{ ...btn('transparent', 'var(--text-secondary)'), padding: '5px 9px', marginLeft: 'auto' }}><RefreshCw size={13} /></button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 14px', maxWidth: 720 }}>
        Start/Stop sets a broadcast’s <strong>desired state</strong>; the worker boxes reconcile to it within a few seconds and stream 24/7 (your devices off). Status is what the workers report back.
      </p>

      {!agentConfigured && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--bg-card)', marginBottom: 16 }}>
          <AlertTriangle size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            No worker agents configured yet. Set <code>BROADCAST_AGENT_TOKEN</code> in the app env and run the
            <code> broadcast-streamer</code> in agent mode on an always-on box (Oracle Always-Free VM, etc.). Then Start a broadcast here and it goes live. Until then, Start just records intent.
          </div>
        </div>
      )}

      {/* Workers */}
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 6px' }}>Workers</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {agents.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No workers have checked in.</span>}
        {agents.map(a => (
          <div key={a.workerId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', opacity: a.stale ? 0.55 : 1 }}>
            <Cpu size={15} style={{ color: a.stale ? '#6b7280' : '#34d399' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{a.workerId} {a.stale && <span style={{ fontSize: 10.5, color: '#f87171' }}>· offline</span>}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.running}/{a.capacity} streams · seen {ago(a.lastSeen)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Broadcasts */}
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 6px' }}>Streams</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {loaded && runtime.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No broadcasts yet — create one in the Radio tab.</span>}
        {runtime.map(r => (
          <div key={r.slug} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', opacity: r.enabled ? 1 : 0.5 }}>
            <Circle size={11} fill={STATUS_COLOR[r.status]} stroke="none" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 160, flex: '1 1 220px' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{r.title} {!r.enabled && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· disabled</span>}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                <code>{r.slug}</code> · <span style={{ color: STATUS_COLOR[r.status], fontWeight: 700, textTransform: 'capitalize' }}>{r.status}</span>
                {r.status === 'live' && r.fps != null && ` · ${Math.round(r.fps)} fps`}
                {r.workerId && ` · ${r.workerId}`}
                {r.status !== 'offline' && r.lastHeartbeat && ` · ${ago(r.lastHeartbeat)}`}
              </div>
              {r.error && <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>{r.error}</div>}
            </div>
            {r.desiredLive
              ? <button type="button" disabled={busy === r.slug} onClick={() => setLive(r.slug, false)} style={btn('transparent', '#f87171')}><Square size={14} /> Stop</button>
              : <button type="button" disabled={busy === r.slug || !r.enabled} onClick={() => setLive(r.slug, true)} style={{ ...btn('var(--accent)', '#0e0d12'), opacity: r.enabled ? 1 : 0.5 }}><Play size={14} /> Go live</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
