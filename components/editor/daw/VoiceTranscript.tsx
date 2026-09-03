'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Sparkles, Keyboard } from 'lucide-react'
import { transcript, clearTranscript, onTranscript, type TranscriptEntry } from '@/lib/voice/transcript'

/**
 * The conversation so far: what you said, what Light said, what Light did.
 *
 * Brae: "Let's create a voice control transcript / log. It would say what the
 * user said, what Light responded with, and what Light did."
 *
 * ⚠️ WHAT IT DID IS A SEPARATE LIST, NOT PART OF THE REPLY. The reply is what
 * Light claimed; the actions are what changed. Most of the time they agree.
 * The times they do not are the whole reason to have this — "Moved to bar 5"
 * beside "Start a low pass on bar 5" is a wrong turn you can see without
 * opening a log file.
 */

const PATH_LABEL: Record<TranscriptEntry['path'], string> = {
  rules: 'built-in', learned: 'learned', shared: 'learned by others', macro: 'macro',
  assistant: 'assistant', failed: 'failed', browse: 'browsing',
}
const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function VoiceTranscript({ C }: { C: Record<string, string> }) {
  const [, bump] = useState(0)
  useEffect(() => onTranscript(() => bump(n => n + 1)), [])
  const rows = transcript()
  const end = useRef<HTMLDivElement | null>(null)
  // Newest at the bottom, and kept in view as it grows — a conversation is
  // read downwards.
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [rows.length])

  const muted = C.textMuted ?? '#8b8b8b'
  const accent = C.accent ?? '#7ab5f7'
  const border = C.border ?? '#333'

  return (
    <div data-voice-transcript style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: muted }}>TRANSCRIPT</div>
        <div style={{ fontSize: 10, color: muted }}>{rows.length ? `${rows.length} exchange${rows.length === 1 ? '' : 's'}` : ''}</div>
        <div style={{ flex: 1 }} />
        {rows.length > 0 && (
          <button
            onClick={clearTranscript}
            style={{ border: `1px solid ${border}`, background: 'transparent', color: muted, borderRadius: 4, fontSize: 10, padding: '2px 7px', cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div style={{ fontSize: 11.5, color: muted, lineHeight: 1.5 }}>
          Nothing yet. Everything you say, what Light answers, and what it changes in the song will be listed here.
        </div>
      )}

      {rows.map((r, i) => (
        <div key={`${r.at}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8, borderBottom: `1px solid ${border}` }}>
          {/* You */}
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            <span style={{ color: muted, marginTop: 2, flex: '0 0 auto' }}>
              {r.source === 'typed' ? <Keyboard size={11} /> : <Mic size={11} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: muted }}>
                YOU <span style={{ fontWeight: 500, letterSpacing: 0 }}>· {when(r.at)}</span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.4, color: C.textPrimary }}>{r.said}</div>
            </div>
          </div>
          {/* Light */}
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            <span style={{ color: r.problem ? '#e0776b' : accent, marginTop: 2, flex: '0 0 auto' }}><Sparkles size={11} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: r.problem ? '#e0776b' : accent }}>
                LIGHT <span style={{ fontWeight: 500, letterSpacing: 0, color: muted }}>· {PATH_LABEL[r.path]}</span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.4, color: r.problem ? '#ffb4b4' : C.textPrimary }}>
                {r.reply || (r.problem ? 'Could not do that.' : '—')}
              </div>
              {r.did.length > 0 ? (
                <ul style={{ margin: '4px 0 0', paddingLeft: 14, fontSize: 11, lineHeight: 1.45, color: muted }}>
                  {r.did.map((d, k) => <li key={k}>{d}</li>)}
                </ul>
              ) : (
                <div style={{ marginTop: 3, fontSize: 10.5, color: muted, fontStyle: 'italic' }}>
                  {r.problem ? 'Nothing changed.' : 'No change to the song.'}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}
