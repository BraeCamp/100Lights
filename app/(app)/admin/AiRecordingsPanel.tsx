'use client'
// Listen to what the studio has bought, one voice at a time.
//
// Brae: "Allow me to hear the recordings from a new AI recordings section of
// Admin. Separate by voice."
//
// ⚠️ THE POINT IS AUDITIONING, not accounting. Voice Phrases already reports
// which sentences have been paid for; this is for hearing whether the voice is
// any good before the rest of a budget goes on it. So the list is the audio,
// and everything else on screen is subordinate to pressing play.

import { useEffect, useRef, useState } from 'react'

interface VoiceRow { voiceId: string; count: number; bytes: number; newest: string }
interface Rec { key: string; phrase: string; url: string; bytes: number; at: string }

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export default function AiRecordingsPanel() {
  const [voices, setVoices] = useState<VoiceRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [rows, setRows] = useState<Rec[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  // ⚠️ One element, reused. A hundred <audio> tags is a hundred media elements
  // the browser keeps alive, and clicking a second play would leave the first
  // one talking over it.
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    setBusy(true)
    fetch('/api/admin/ai-recordings')
      .then(r => r.json())
      .then(d => { setVoices(d.voices ?? []); if (d.error) setError(d.error) })
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false))
  }, [])

  const openVoice = async (voiceId: string) => {
    if (open === voiceId) { setOpen(null); setRows([]); return }
    setOpen(voiceId); setRows([]); setBusy(true); setError('')
    try {
      const d = await (await fetch(`/api/admin/ai-recordings?voice=${encodeURIComponent(voiceId)}`)).json()
      setRows(d.rows ?? [])
      if (d.error) setError(d.error)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  const play = (r: Rec) => {
    if (!r.url) return
    if (!audio.current) audio.current = new Audio()
    const a = audio.current
    if (playing === r.key) { a.pause(); setPlaying(null); return }
    a.src = r.url
    a.onended = () => setPlaying(null)
    void a.play().then(() => setPlaying(r.key)).catch(() => setPlaying(null))
  }

  useEffect(() => () => { audio.current?.pause() }, [])

  const shown = filter
    ? rows.filter(r => r.phrase.toLowerCase().includes(filter.toLowerCase()))
    : rows

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {!busy && !voices.length && !error && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
          Nothing recorded yet. Run <code style={{ fontFamily: 'ui-monospace, monospace' }}>
          npm run voice:prerender -- --voice &lt;id&gt; --credits 10000</code> to buy a voice&rsquo;s
          fixed phrases; they appear here grouped by voice.
        </p>
      )}

      {voices.map(v => (
        <div key={v.voiceId} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
          <button
            onClick={() => void openVoice(v.voiceId)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
              background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700 }}>{open === v.voiceId ? '▾' : '▸'}</span>
            <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{v.voiceId}</code>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {v.count} recording{v.count === 1 ? '' : 's'} · {kb(v.bytes)}
            </span>
          </button>

          {open === v.voiceId && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter phrases…"
                style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7,
                  padding: '7px 10px', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none',
                }}
              />
              {busy && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Reading storage…</p>}
              {shown.map(r => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px' }}>
                  <button
                    onClick={() => play(r)}
                    disabled={!r.url}
                    style={{
                      width: 28, height: 28, flexShrink: 0, borderRadius: '50%', cursor: r.url ? 'pointer' : 'default',
                      border: '1px solid var(--border)', background: playing === r.key ? 'var(--accent)' : 'var(--bg-surface)',
                      color: playing === r.key ? '#fff' : 'var(--text-secondary)', fontSize: 11,
                    }}
                    aria-label={playing === r.key ? 'Stop' : 'Play'}
                  >
                    {playing === r.key ? '■' : '▶'}
                  </button>
                  <span style={{ fontSize: 12.5, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
                    {/* ⚠️ The hash is the filename, so a recording whose metadata
                        is missing has no readable text — say so rather than
                        showing an empty row that looks broken. */}
                    {r.phrase || <em style={{ color: 'var(--text-muted)' }}>(no phrase recorded in metadata)</em>}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{kb(r.bytes)}</span>
                </div>
              ))}
              {!busy && !shown.length && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  {filter ? 'Nothing matches that.' : 'No recordings for this voice.'}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
