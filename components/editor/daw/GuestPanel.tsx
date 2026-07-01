'use client'

import { useState, useEffect, useCallback } from 'react'
import { UserPlus, Copy, Check, Radio, Upload, PlusCircle, Trash2, Clock } from 'lucide-react'
import type { GuestSession } from '@/lib/guest-sessions'

interface Props {
  projectId: string
  onPullTrack: (url: string, guestName: string, timelineOffsetMs: number) => void
}

const APP_URL = (typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL) ?? ''

const STATUS_LABEL: Record<string, string> = {
  pending:   'Link sent',
  waiting:   'Guest joined',
  ready:     'Session started',
  uploaded:  'Recording ready',
  pulled:    'Added to project',
}

const STATUS_COLOR: Record<string, string> = {
  pending:   '#71717a',
  waiting:   '#f59e0b',
  ready:     '#8b5cf6',
  uploaded:  '#10b981',
  pulled:    '#3f3f46',
}

export default function GuestPanel({ projectId, onPullTrack }: Props) {
  const [sessions, setSessions] = useState<GuestSession[]>([])
  const [creating, setCreating] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [pulling, setPulling] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    const res = await fetch(`/api/guest/invite?projectId=${projectId}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json() as GuestSession[]
    setSessions(data)
  }, [projectId])

  useEffect(() => {
    loadSessions()
    const id = setInterval(loadSessions, 4000)
    return () => clearInterval(id)
  }, [loadSessions])

  async function invite() {
    setCreating(true)
    const res = await fetch('/api/guest/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    setCreating(false)
    if (res.ok) await loadSessions()
  }

  async function copyLink(token: string) {
    const link = `${APP_URL}/guest/${token}`
    await navigator.clipboard.writeText(link).catch(() => {})
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  async function startSession(token: string) {
    setStarting(token)
    await fetch(`/api/guest/${token}/start`, { method: 'POST' })
    setStarting(null)
    await loadSessions()
  }

  async function pullTrack(token: string) {
    setPulling(token)
    const res = await fetch(`/api/guest/${token}/pull`, { method: 'POST' })
    if (res.ok) {
      const { url, guestName, timelineOffsetMs } = await res.json() as {
        url: string; guestName: string; timelineOffsetMs: number
      }
      onPullTrack(url, guestName, timelineOffsetMs)
    }
    setPulling(null)
    await loadSessions()
  }

  async function removeSession(token: string) {
    await fetch(`/api/guest/${token}`, { method: 'DELETE' })
    await loadSessions()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserPlus size={14} color="var(--text-muted)" />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Guest Recording
          </span>
        </div>
        <button
          onClick={invite}
          disabled={creating}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600,
            opacity: creating ? 0.6 : 1,
          }}
        >
          <PlusCircle size={11} /> {creating ? 'Creating…' : 'Invite guest'}
        </button>
      </div>

      {sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            No guest sessions yet. Invite a guest to get a shareable recording link.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map(s => (
            <div key={s.token} style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[s.status] ?? '#71717a', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {s.guestName ?? 'Waiting for guest…'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: STATUS_COLOR[s.status] ?? 'var(--text-muted)' }}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <button
                    onClick={() => removeSession(s.token)}
                    style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', opacity: 0.5 }}
                    title="Remove"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Copy link — always available until uploaded */}
                {(s.status === 'pending' || s.status === 'waiting') && (
                  <button
                    onClick={() => copyLink(s.token)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, flex: 1,
                      padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--bg-card)', color: 'var(--text-secondary)',
                      fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    {copiedToken === s.token ? <Check size={11} color="var(--success)" /> : <Copy size={11} />}
                    {copiedToken === s.token ? 'Copied!' : 'Copy link'}
                  </button>
                )}

                {/* Start session — available when guest has joined */}
                {s.status === 'waiting' && (
                  <button
                    onClick={() => startSession(s.token)}
                    disabled={starting === s.token}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, flex: 1,
                      padding: '5px 10px', borderRadius: 6, border: 'none',
                      background: '#8b5cf6', color: '#fff',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      opacity: starting === s.token ? 0.6 : 1,
                    }}
                  >
                    <Radio size={11} /> {starting === s.token ? 'Starting…' : 'Start session'}
                  </button>
                )}

                {/* Waiting for guest to record */}
                {s.status === 'ready' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, padding: '5px 10px' }}>
                    <Clock size={11} color="#8b5cf6" />
                    <span style={{ fontSize: 11, color: '#8b5cf6' }}>Waiting for guest to record…</span>
                  </div>
                )}

                {/* Pull into project */}
                {s.status === 'uploaded' && (
                  <button
                    onClick={() => pullTrack(s.token)}
                    disabled={pulling === s.token}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, flex: 1,
                      padding: '5px 10px', borderRadius: 6, border: 'none',
                      background: '#10b981', color: '#fff',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      opacity: pulling === s.token ? 0.6 : 1,
                    }}
                  >
                    <Upload size={11} /> {pulling === s.token ? 'Pulling…' : `Pull in ${s.guestName ?? 'guest'}'s track`}
                  </button>
                )}

                {s.status === 'pulled' && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '5px 0' }}>
                    ✓ Track added to project
                  </span>
                )}
              </div>

              {/* Offset info after upload */}
              {s.timelineOffsetMs !== null && s.timelineOffsetMs !== undefined && (
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
                  Timeline offset: {(s.timelineOffsetMs / 1000).toFixed(2)}s from session start
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
        Guests open the link in any browser — no account needed. Their recording is automatically aligned to your timeline using a sync reference at session start.
      </p>
    </div>
  )
}
