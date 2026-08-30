'use client'
// ── The window that opens when you start talking ────────────────────────────
//
// Brae: "create a windowed panel that opens when voice control is activated? It
// will have its settings, what the user says, responses, and anything else that
// should go there."
//
// Until now the voice system spoke through five small popovers that appeared
// beside a button and replaced each other: what it heard, what it did, what it
// wanted to ask, what it refused. Each was right on its own and together they
// were a slideshow — the answer to "what did it just do" had already been
// replaced by the answer to "what is it doing now", and the settings were
// somewhere else entirely.
//
// One window instead, and the thing that makes it worth having is the
// TRANSCRIPT: what you said and what it said back, in order, still there. A
// voice interface with no history is one you cannot check up on, and checking up
// on it is exactly what you want to do while you are learning to trust it.

import React, { useEffect, useRef } from 'react'
import { X, Mic, Settings2, Maximize2 } from 'lucide-react'
import { commandHelp } from '@/lib/voice/interpret'
import { WAKE_WORDS } from '@/lib/voice/attention'

export interface VoiceTurn {
  /** Who said it. */
  by: 'you' | 'light'
  text: string
  at: number
  /** A turn that was heard but deliberately not acted on. */
  ignored?: boolean
}

export interface VoicePanelProps {
  turns: VoiceTurn[]
  listening: boolean
  /** True while a held-open session is taking commands rather than waiting to
   *  be addressed. */
  attentive: boolean
  continuous: boolean
  /** 0–1 input level, for the meter. */
  level: number
  hud: boolean
  onHud: (on: boolean) => void
  onClose: () => void
  onClear: () => void
  /**
   * The settings themselves.
   *
   * The panel OWNS them rather than showing a copy: they used to live in a gear
   * popover, and two places rendering the same controls is how the two of them
   * end up disagreeing about what the setting currently is. The gear now opens
   * this, on this tab.
   */
  mode: 'hold' | 'toggle'
  onMode: (m: 'hold' | 'toggle') => void
  enterRuns: boolean
  onEnterRuns: (on: boolean) => void
  speaks: boolean
  onSpeaks: (on: boolean) => void
  canSpeak: boolean
  /** Which tab to open on. */
  initialTab?: 'talk' | 'settings' | 'help'
  /**
   * What the microphone actually turned out to be.
   *
   * Shown because the commonest cause of bad monitoring while voice is on is
   * not the studio at all — it is a headset that cannot record and play music
   * at the same time and quietly drops to call quality. Printing the rate turns
   * "it sounds like static" into a number that says whose problem it is.
   */
  mic?: { label: string; sampleRate: number | null; echoCancellation: boolean | null; degraded: boolean } | null
  /** The bar the level is judged against, 0–1, drawn on the meter. */
  threshold?: number
  sensitivity: number
  onSensitivity: (v: number) => void
  colors: {
    bgSurface: string
    border: string
    textPrimary: string
    textMuted: string
    accent: string
  }
}

export default function VoicePanel({
  turns, listening, attentive, continuous, level, hud,
  onHud, onClose, onClear, colors: C,
  mode, onMode, enterRuns, onEnterRuns, speaks, onSpeaks, canSpeak,
  initialTab = 'talk', mic, threshold = 0, sensitivity, onSensitivity,
}: VoicePanelProps) {
  const [tab, setTab] = React.useState<'talk' | 'settings' | 'help'>(initialTab)
  React.useEffect(() => { setTab(initialTab) }, [initialTab])
  const log = useRef<HTMLDivElement>(null)

  // Stick to the bottom as it fills, the way every transcript should.
  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length])

  const state = !listening ? 'off'
    : !continuous ? 'listening'
      : attentive ? 'attentive' : 'dormant'

  return (
    <div
      data-voice-panel
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 80,
        width: 380, maxHeight: 460, display: 'flex', flexDirection: 'column',
        background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 8,
        boxShadow: '0 18px 48px rgba(0,0,0,.55)', overflow: 'hidden',
        fontSize: 11, color: C.textPrimary,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* ── Title bar: what it is doing, always visible ──────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,.02)',
      }}>
        <Mic size={13} color={state === 'attentive' || state === 'listening' ? C.accent : C.textMuted} />
        <span style={{ fontWeight: 800, letterSpacing: 0.3, fontSize: 10 }}>
          {state === 'off' && 'VOICE'}
          {state === 'listening' && 'LISTENING'}
          {state === 'attentive' && 'LISTENING — GO AHEAD'}
          {state === 'dormant' && `SAY "${WAKE_WORDS[0].toUpperCase()}" TO WAKE`}
        </span>

        {/* The level meter earns its place: "is it even hearing me" is the
            first question when this goes wrong, and it should never need
            asking twice. */}
        {listening && (
          <div style={{ flex: 1, height: 5, background: '#222', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              width: `${Math.round(Math.min(1, level) * 100)}%`, height: '100%',
              background: level > threshold ? C.accent : C.textMuted,
              transition: 'width 80ms linear',
            }} />
            {/* The bar the level has to cross. A meter without it answers "is
                it hearing something"; the question people actually have is
                whether what it hears is loud enough to count. */}
            {threshold > 0 && threshold < 1 && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${Math.round(threshold * 100)}%`, width: 2,
                background: '#e0776b',
              }} />
            )}
          </div>
        )}
        {!listening && <div style={{ flex: 1 }} />}

        <button
          onClick={() => onHud(!hud)}
          title="HUD — hide everything but the song and the sound visuals"
          style={{
            display: 'flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px',
            borderRadius: 4, cursor: 'pointer', fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
            border: `1px solid ${hud ? C.accent : C.border}`,
            background: hud ? `${C.accent}22` : 'transparent',
            color: hud ? C.accent : C.textMuted,
          }}
        >
          <Maximize2 size={10} />HUD
        </button>
        <button
          onClick={onClose}
          aria-label="Close voice panel"
          style={{
            display: 'flex', alignItems: 'center', height: 20, padding: '0 4px',
            borderRadius: 4, cursor: 'pointer', border: 'none',
            background: 'transparent', color: C.textMuted,
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
        {([
          ['talk', 'Conversation'],
          ['settings', 'Settings'],
          ['help', 'What you can say'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1, padding: '6px 4px', cursor: 'pointer', border: 'none',
              borderBottom: `2px solid ${tab === id ? C.accent : 'transparent'}`,
              background: 'transparent', color: tab === id ? C.textPrimary : C.textMuted,
              fontSize: 10, fontWeight: 700,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {tab === 'talk' && (
          <div ref={log} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {!turns.length && (
              <div style={{ color: C.textMuted, lineHeight: 1.5 }}>
                {continuous && listening
                  ? `Say "${WAKE_WORDS[0]}" and then what you want — "${WAKE_WORDS[0]}, mute the drums". Once it answers you can keep going without saying the name again.`
                  : 'Nothing yet. Hold the button, or switch to click-to-talk in Settings.'}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <span style={{
                  flex: '0 0 34px', fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
                  paddingTop: 1, color: t.by === 'you' ? C.textMuted : C.accent,
                }}>
                  {t.by === 'you' ? 'YOU' : WAKE_WORDS[0].toUpperCase()}
                </span>
                <span style={{
                  flex: 1, lineHeight: 1.45,
                  // A turn that was heard and deliberately not acted on is shown
                  // differently rather than hidden. "It heard me and did
                  // nothing" is a fact worth being able to see — otherwise the
                  // only evidence is that nothing happened.
                  color: t.ignored ? C.textMuted : C.textPrimary,
                  fontStyle: t.ignored ? 'italic' : 'normal',
                }}>
                  {t.text}
                  {t.ignored && <span style={{ color: C.textMuted }}> — not acted on</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ color: C.textMuted, marginBottom: 6, letterSpacing: 0.3, fontSize: 9, fontWeight: 800 }}>
                SPEAKING
              </div>
              {(['hold', 'toggle'] as const).map(m => (
                <label key={m} style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '3px 0', cursor: 'pointer' }}>
                  <input type="radio" name="voice-mode" checked={mode === m} onChange={() => onMode(m)} />
                  {m === 'hold'
                    ? 'Hold the button to speak'
                    : `Click once, then say "${WAKE_WORDS[0]}" and keep going`}
                </label>
              ))}
            </div>

            <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={enterRuns} onChange={e => onEnterRuns(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                Enter starts and runs a command
                <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>
                  Only while you are not typing — Enter keeps its usual job in any field.
                </span>
              </span>
            </label>

            <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: canSpeak ? 'pointer' : 'default' }}>
              <input
                type="checkbox" checked={speaks} disabled={!canSpeak}
                onChange={e => onSpeaks(e.target.checked)} style={{ marginTop: 2 }}
              />
              <span>
                Answer out loud
                <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>
                  {canSpeak
                    ? 'Reads back what it did and asks questions aloud. Stays quiet while the transport is running.'
                    : 'This browser has no speech voices installed.'}
                </span>
              </span>
            </label>

            <div>
              <div style={{ color: C.textMuted, marginBottom: 5, letterSpacing: 0.3, fontSize: 9, fontWeight: 800 }}>
                HOW EASILY IT TRIGGERS
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                {([
                  [0.7, 'Quick', 'picks up quiet speech, and more of the room'],
                  [1, 'Normal', 'the default'],
                  [1.5, 'Firm', 'ignores conversation further away'],
                  [2.2, 'Strict', 'only a clear voice close to the microphone'],
                ] as const).map(([v, label, why]) => (
                  <button
                    key={label}
                    title={why}
                    onClick={() => onSensitivity(v)}
                    style={{
                      flex: 1, padding: '4px 2px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
                      border: `1px solid ${Math.abs(sensitivity - v) < 0.01 ? C.accent : C.border}`,
                      background: Math.abs(sensitivity - v) < 0.01 ? `${C.accent}22` : 'transparent',
                      color: Math.abs(sensitivity - v) < 0.01 ? C.accent : C.textMuted,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ color: C.textMuted, marginTop: 4, lineHeight: 1.45 }}>
                Watch the meter above while you talk and while the room does. The red
                line is the bar — set this so your voice crosses it and the room does not.
              </div>
            </div>

            {mic && (
              <div style={{
                borderTop: `1px solid ${C.border}`, paddingTop: 9, lineHeight: 1.5,
                color: mic.degraded ? '#e0776b' : C.textMuted,
              }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, marginBottom: 3 }}>
                  MICROPHONE
                </div>
                {mic.label || 'default input'}
                {mic.sampleRate ? ` · ${(mic.sampleRate / 1000).toFixed(1)} kHz` : ''}
                {mic.echoCancellation ? ' · echo cancelling' : ' · raw'}
                {mic.degraded && (
                  <div style={{ marginTop: 4 }}>
                    This device dropped to call quality when the microphone opened, which
                    is what makes playback sound grainy. It is the headset switching
                    profiles, not the studio — monitor on something else while voice is on.
                  </div>
                )}
              </div>
            )}

            <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={hud} onChange={e => onHud(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                HUD
                <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>
                  Hides everything but the song and the sound visuals.
                </span>
              </span>
            </label>
          </div>
        )}

        {tab === 'help' && (
          <div>
            {commandHelp().map(group => (
              <div key={group.group} style={{ marginBottom: 9 }}>
                <div style={{
                  color: C.accent, fontSize: 9, fontWeight: 800,
                  letterSpacing: 0.5, marginBottom: 3,
                }}>
                  {group.group.toUpperCase()}
                </div>
                {group.items.map(item => (
                  <div key={item.say} style={{ display: 'flex', gap: 6, padding: '2px 0', lineHeight: 1.35 }}>
                    <span style={{ color: C.textPrimary, flex: '0 0 auto' }}>&ldquo;{item.say}&rdquo;</span>
                    <span style={{ color: C.textMuted, flex: 1, textAlign: 'right' }}>{item.what}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {tab === 'talk' && turns.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '5px 10px', display: 'flex' }}>
          <button
            onClick={onClear}
            style={{
              marginLeft: 'auto', padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
              border: 'none', background: 'transparent', color: C.textMuted, fontSize: 10,
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
