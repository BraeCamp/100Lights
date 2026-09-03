'use client'
// Everything Light can do, in one window.
//
// Brae: "please create a library of functions that can be done through Light,
// the vocal control program so that users can see what they can do. It will be
// a long list. That's okay. We'll add a help button in the voice control window
// that pulls up another window for it. When the user hovers over one, it shows
// a summary of that function."
//
// ⚠️ A SEPARATE window, not another view inside the voice card. The card is
// small because it sits in the transport and has to stay out of the way; a list
// of seventy-seven things read inside it would be a keyhole. And you read this
// WHILE talking to the studio — closing the thing you are talking to in order
// to find out what to say is exactly backwards.
//
// The list is generated from the command registry, so it cannot promise
// anything the parser does not actually resolve. A hand-written list of what a
// program can do is out of date the day after it is written, and wrong in the
// direction that matters.

import React, { useMemo, useState } from 'react'
import { X, Search } from 'lucide-react'
import { commandHelp, type HelpItem } from '@/lib/voice/commands'

export interface VoiceLibraryColors {
  bgSurface: string
  border: string
  textPrimary: string
  textMuted: string
  accent: string
}

export default function VoiceLibrary({
  onClose,
  colors: C,
  embedded = false,
}: {
  onClose: () => void
  colors: VoiceLibraryColors
  /**
   * Fill the container it is given instead of floating over the studio.
   *
   * Brae: "When this or any other of the buttons in the voice control window
   * are selected, they will open in a bar next to voice control so that voice
   * control stays on screen." The list is the same either way; only where it
   * sits changes.
   */
  embedded?: boolean
}) {
  const [find, setFind] = useState('')
  // Hover shows the summary; clicking PINS it, so it survives the pointer
  // moving away — which it has to, because the summary is often longer than the
  // row and you read it after looking away from the list.
  const [hovered, setHovered] = useState<HelpItem | null>(null)
  const [pinned, setPinned] = useState<HelpItem | null>(null)
  const shown = hovered ?? pinned

  const groups = useMemo(() => {
    const needle = find.trim().toLowerCase()
    const all = commandHelp()
    if (!needle) return all
    // Matched on the description and every phrasing, not just the first one:
    // half the time you know what you want to happen and not what to call it,
    // and the other half you remember one wording out of five.
    return all
      .map(g => ({
        ...g,
        items: g.items.filter(i =>
          i.what.toLowerCase().includes(needle)
          || i.summary.toLowerCase().includes(needle)
          || i.phrasings.some(p => p.toLowerCase().includes(needle))),
      }))
      .filter(g => g.items.length)
  }, [find])

  const total = useMemo(() => commandHelp().reduce((n, g) => n + g.items.length, 0), [])
  const showing = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div
      role="dialog"
      aria-label="What Light can do"
      data-voice-library
      style={embedded
        // In the bar beside the voice card: no chrome of its own, it fills
        // what it is given.
        ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, color: C.textPrimary }
        : {
          position: 'fixed', top: '8vh', left: '50%', transform: 'translateX(-50%)',
          width: 'min(860px, 94vw)', height: 'min(76vh, 720px)',
          // ⚠️ Above the voice card, which is also 80. Equal z-index means the
          // later element in the tree wins, and the card was rendering over the
          // list you had just opened to read — the window appeared to be empty
          // apart from its summary column.
          zIndex: 90,
          display: 'flex', flexDirection: 'column',
          background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 12,
          boxShadow: '0 24px 70px rgba(0,0,0,.6)', color: C.textPrimary,
        }}
      onClick={e => e.stopPropagation()}
    >
      {/* ── Title ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}>WHAT LIGHT CAN DO</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          {showing === total ? `${total} things` : `${showing} of ${total}`}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{ position: 'absolute', left: 8, top: 7, color: C.textMuted, pointerEvents: 'none' }}
          />
          <input
            autoFocus
            value={find}
            onChange={e => setFind(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose() }}
            placeholder="Search — or describe what you want"
            aria-label="Search what Light can do"
            style={{
              width: 260, height: 26, padding: '0 8px 0 24px', boxSizing: 'border-box',
              background: '#141414', border: `1px solid ${C.border}`, borderRadius: 5,
              color: C.textPrimary, fontSize: 11, outline: 'none',
            }}
          />
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ display: 'inline-flex', border: 'none', background: 'transparent', color: C.textMuted, cursor: 'pointer', padding: 3 }}
        ><X size={14} /></button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, flexDirection: embedded ? 'column' : 'row' }}>
        {/* ── The list ────────────────────────────────────────────────── */}
        <div
          style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}
          onMouseLeave={() => setHovered(null)}
        >
          {groups.length === 0 && (
            <div style={{ padding: 20, fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
              Nothing matches “{find}”. The assistant can still try it — this list is
              only what the studio understands on its own, without spending anything.
            </div>
          )}
          {groups.map(g => (
            <div key={g.group}>
              <div style={{
                position: 'sticky', top: 0, zIndex: 1,
                padding: '7px 14px 5px', background: C.bgSurface,
                fontSize: 9, fontWeight: 800, letterSpacing: 0.7, color: C.textMuted,
              }}>
                {g.group.toUpperCase()}
              </div>
              {g.items.map(item => {
                const active = shown?.id === item.id
                return (
                  <button
                    key={item.id}
                    onMouseEnter={() => setHovered(item)}
                    onFocus={() => setHovered(item)}
                    onClick={() => setPinned(item)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 14px', border: 'none', cursor: 'pointer',
                      background: active ? 'rgb(255 255 255 / .05)' : 'transparent',
                      borderLeft: `2px solid ${active ? C.accent : 'transparent'}`,
                      color: C.textPrimary,
                    }}
                  >
                    <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                      {item.what}
                      {item.destructive && (
                        <span style={{ marginLeft: 6, fontSize: 9, color: '#e0776b', letterSpacing: 0.4 }}>
                          ASKS FIRST
                        </span>
                      )}
                    </div>
                    {/* The phrasing under the name, because the useful thing to
                        know is not what it is called but what to SAY. */}
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>
                      “{item.say}”
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* ── The summary ─────────────────────────────────────────────── */}
        <div style={embedded
          // Under the list rather than beside it: the bar is narrow, and two
          // columns in 380px is two keyholes.
          ? { flex: '0 0 auto', maxHeight: '38%', borderTop: `1px solid ${C.border}`, padding: 12, overflowY: 'auto', fontSize: 12, lineHeight: 1.5 }
          : {
            width: 300, flexShrink: 0, borderLeft: `1px solid ${C.border}`,
            padding: 14, overflowY: 'auto', fontSize: 12.5, lineHeight: 1.55,
          }}>
          {!shown && (
            <div style={{ color: C.textMuted }}>
              Hover anything to read what it does. Click to keep it here while you
              look away.
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                Everything here works without the assistant, so it is instant and
                costs nothing. With the assistant on you can also just describe
                what you want.
              </div>
            </div>
          )}
          {shown && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 7 }}>{shown.what}</div>
              <div style={{ color: C.textPrimary }}>{shown.summary}</div>
              <div style={{ marginTop: 13, paddingTop: 11, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: C.textMuted, marginBottom: 5 }}>
                  WAYS TO SAY IT
                </div>
                {shown.phrasings.map((p, i) => (
                  <div key={i} style={{ color: C.textMuted, marginBottom: 3 }}>“{p}”</div>
                ))}
              </div>
              {shown.destructive && (
                <div style={{ marginTop: 11, fontSize: 11.5, color: '#e0776b', lineHeight: 1.45 }}>
                  This one removes work, so the studio reads it back and waits for you
                  to agree before doing it.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
