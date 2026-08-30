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

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X, Mic, Maximize2, ListChecks, GripVertical } from 'lucide-react'
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
  /** The studio's own recorded voice rather than the browser's. */
  studio: boolean
  onStudio: (on: boolean) => void
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
  /**
   * Commands said but not yet carried out.
   *
   * Shown because the point of collecting is being able to CHECK before
   * committing, and a list you can only hear is a list you cannot check at your
   * own pace.
   */
  /**
   * The last microphone check.
   *
   * A calibration that ends in "your headphones are the problem" is worth ten
   * that end in a progress bar, so what it measured is shown alongside what it
   * concluded — the numbers are the argument.
   */
  calibration?: {
    floor: number; peak: number; headroom: number; heard: string
    accuracy: number; micLabel: string; sampleRate: number | null
    suggested: number; verdict: string
  } | null
  /**
   * Whether the assistant may act without being asked first.
   *
   * The activation, not the default. Confirmation stays on for everybody until
   * somebody deliberately turns this off, because it is the switch that lets a
   * misheard sentence spend money without anybody seeing it first.
   */
  aiAuto?: boolean
  onAiAuto?: (on: boolean) => void
  /** What the last assistant turn cost, and what is left. */
  credits?: { spent: number; left: number } | null
  calibrating?: null | 'room' | 'voice'
  calibrationPhrase?: string
  onCalibrate?: () => void
  queue: { text: string; say: string }[]
  collecting: boolean
  onCollecting: (on: boolean) => void
  onRunQueue: () => void
  onClearQueue: () => void
  onDropQueued: (index: number) => void
  colors: {
    bgSurface: string
    border: string
    textPrimary: string
    textMuted: string
    accent: string
  }
}

const POSITION_KEY = 'beacon.voice.panel-position'

/**
 * Where the card was left.
 *
 * Brae: "let's move the voice dropdown so that it's a card that can be moved."
 *
 * A dropdown is anchored to the button that opened it, which is fine for a menu
 * and wrong for something you read while you work — it sits over the
 * arrangement, in the one place you cannot move it away from. A card goes where
 * it is put and stays there.
 *
 * Remembered per browser, and clamped on load: a position saved on a wide screen
 * would otherwise put the card off the edge of a narrow one, where it cannot be
 * dragged back.
 */
function readPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { x: number; y: number }
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return null
    return p
  } catch { return null }
}

function writePosition(p: { x: number; y: number }): void {
  try { localStorage.setItem(POSITION_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

/** Keep it on screen, whatever screen this turns out to be. */
function clamp(p: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === 'undefined') return p
  const pad = 24
  return {
    x: Math.max(pad - 360, Math.min(window.innerWidth - pad, p.x)),
    y: Math.max(0, Math.min(window.innerHeight - pad * 2, p.y)),
  }
}

export default function VoicePanel({
  turns, listening, attentive, continuous, level, hud,
  onHud, onClose, onClear, colors: C,
  mode, onMode, enterRuns, onEnterRuns, speaks, onSpeaks, canSpeak, studio, onStudio,
  initialTab = 'talk', mic, threshold = 0, sensitivity, onSensitivity,
  queue, collecting, onCollecting, onRunQueue, onClearQueue, onDropQueued,
  calibration, calibrating, calibrationPhrase, onCalibrate, aiAuto, onAiAuto, credits,
}: VoicePanelProps) {
  const [tab, setTab] = React.useState<'talk' | 'settings' | 'help'>(initialTab)
  React.useEffect(() => { setTab(initialTab) }, [initialTab])
  const log = useRef<HTMLDivElement>(null)

  // ── Dragging ─────────────────────────────────────────────────────────────
  //
  // Pointer events on the window rather than on the card, and capture on the
  // title bar, so a fast drag that outruns the element does not drop it — the
  // classic way a hand-rolled drag feels broken.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  /**
   * The position as it is RIGHT NOW.
   *
   * Saving from inside a setPos updater looked tidy and was a race: React defers
   * the updater, so releasing the pointer wrote the old position back AFTER a
   * double-press had just cleared it, and the card would not go home.
   */
  const posRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const saved = readPosition()
    if (saved) { const p = clamp(saved); setPos(p); posRef.current = p }
  }, [])

  /**
   * A double press, detected here rather than by onDoubleClick.
   *
   * Starting a drag calls preventDefault and captures the pointer, and both of
   * those stop a dblclick event ever being dispatched — so the handler that
   * puts the card back never ran. Two presses close together, with the pointer
   * in much the same place, is the same gesture and does not depend on an event
   * the drag has already swallowed.
   */
  const lastPress = useRef(0)

  const onDragStart = useCallback((e: React.PointerEvent) => {
    // Only the title bar itself, never a button inside it.
    if ((e.target as HTMLElement).closest('button')) return
    const now = Date.now()
    if (now - lastPress.current < 350) {
      lastPress.current = 0
      drag.current = null
      setPos(null)
      posRef.current = null
      try { localStorage.removeItem(POSITION_KEY) } catch { /* private mode */ }
      return
    }
    lastPress.current = now
    const card = (e.currentTarget as HTMLElement).parentElement
    if (!card) return
    const box = card.getBoundingClientRect()
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [])

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const next = clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy })
    posRef.current = next
    setPos(next)
  }, [])

  const onDragEnd = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    if (posRef.current) writePosition(posRef.current)
  }, [])

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
        // Fixed once it has been moved, so it stays where it was put rather
        // than following the button that opened it.
        ...(pos
          ? { position: 'fixed' as const, left: pos.x, top: pos.y }
          : { position: 'absolute' as const, top: 'calc(100% + 8px)', right: 0 }),
        zIndex: 80,
        width: 380, maxHeight: 460, display: 'flex', flexDirection: 'column',
        background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 8,
        boxShadow: '0 18px 48px rgba(0,0,0,.55)', overflow: 'hidden',
        fontSize: 11, color: C.textPrimary,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* ── Title bar: what it is doing, always visible ──────────────────── */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        title="Drag to move · double-click to put it back"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,.02)',
          cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <GripVertical size={11} color={C.textMuted} style={{ flex: '0 0 auto' }} />
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

      {tab === 'talk' && queue.length > 0 && (
        <div style={{
          borderBottom: `1px solid ${C.border}`, padding: '8px 10px',
          background: `${C.accent}0e`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
            color: C.accent, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
          }}>
            <ListChecks size={11} />
            {queue.length} CHANGE{queue.length === 1 ? '' : 'S'} READY
          </div>
          {queue.map((q, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '2px 0', lineHeight: 1.4 }}>
              <span style={{ color: C.textMuted, flex: '0 0 12px' }}>{i + 1}</span>
              <span style={{ flex: 1 }}>{q.say || q.text}</span>
              <button
                onClick={() => onDropQueued(i)}
                aria-label={`Remove ${q.say || q.text}`}
                style={{
                  border: 'none', background: 'transparent', color: C.textMuted,
                  cursor: 'pointer', padding: 0, lineHeight: 1,
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            <button
              onClick={onRunQueue}
              style={{
                flex: 1, height: 24, borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent,
                fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
              }}
            >
              EXECUTE
            </button>
            <button
              onClick={onClearQueue}
              style={{
                height: 24, padding: '0 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted,
                fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
              }}
            >
              CLEAR
            </button>
          </div>
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 5 }}>
            Or say &ldquo;execute&rdquo;, &ldquo;go ahead&rdquo;, or &ldquo;read them back&rdquo;.
          </div>
        </div>
      )}

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

            {speaks && (
              // Nested, because it is not a separate feature — it is which voice
              // the answering is done in. Shown only once answering is on, so
              // the settings do not present a choice about something switched
              // off.
              <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: 'pointer', marginLeft: 22 }}>
                <input
                  type="checkbox" checked={studio}
                  onChange={e => onStudio(e.target.checked)} style={{ marginTop: 2 }}
                />
                <span>
                  Studio voice
                  <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>
                    A real recorded voice instead of the browser&rsquo;s. Each phrase is
                    recorded once and then shared by everyone, so it costs you nothing.
                    Falls back to the browser voice if it cannot be reached.
                  </span>
                </span>
              </label>
            )}

            <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox" checked={collecting}
                onChange={e => onCollecting(e.target.checked)} style={{ marginTop: 2 }}
              />
              <span>
                Collect commands before running them
                <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>
                  Say several things, hear them back, then &ldquo;execute&rdquo;. Nothing happens
                  until you say so.
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

            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 9 }}>
              <div style={{ color: C.textMuted, marginBottom: 5, letterSpacing: 0.3, fontSize: 9, fontWeight: 800 }}>
                THE ASSISTANT
              </div>
              <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={!!aiAuto}
                  onChange={e => onAiAuto?.(e.target.checked)} style={{ marginTop: 2 }}
                />
                <span>
                  Let the assistant act without asking
                  <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>
                    Off by default. Anything the studio cannot work out itself goes
                    straight to the assistant and spends credits — including a
                    sentence it misheard.
                  </span>
                </span>
              </label>
              {credits && (
                <div style={{ color: C.textMuted, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  Last turn cost {credits.spent.toLocaleString()} credits ·
                  {' '}{credits.left.toLocaleString()} left
                  {' '}(about ${(credits.left / 5000).toFixed(2)})
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 9 }}>
              <div style={{ color: C.textMuted, marginBottom: 5, letterSpacing: 0.3, fontSize: 9, fontWeight: 800 }}>
                CHECK THE MICROPHONE
              </div>
              {calibrating ? (
                <div style={{ lineHeight: 1.5 }}>
                  {calibrating === 'room'
                    ? 'Listening to the room — say nothing for a moment…'
                    : <>Now say: <span style={{ color: C.accent }}>&ldquo;{calibrationPhrase}&rdquo;</span></>}
                </div>
              ) : (
                <>
                  <button
                    onClick={onCalibrate}
                    style={{
                      width: '100%', height: 26, borderRadius: 4, cursor: 'pointer',
                      border: `1px solid ${C.border}`, background: 'transparent',
                      color: C.textPrimary, fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                    }}
                  >
                    RUN A CHECK
                  </button>
                  <div style={{ color: C.textMuted, marginTop: 4, lineHeight: 1.45 }}>
                    Measures the room, then asks you to say one sentence, then says which
                    part is the problem — and sets the sensitivity to match.
                  </div>
                </>
              )}

              {calibration && !calibrating && (
                <div style={{ marginTop: 8, lineHeight: 1.5 }}>
                  <div style={{ color: C.textPrimary }}>{calibration.verdict}</div>
                  <div style={{ color: C.textMuted, marginTop: 5 }}>
                    Heard: &ldquo;{calibration.heard}&rdquo;
                  </div>
                  <div style={{ color: C.textMuted, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                    room {calibration.floor.toFixed(3)} · voice {calibration.peak.toFixed(3)} ·
                    {' '}{calibration.headroom.toFixed(1)}x · {Math.round(calibration.accuracy * 100)}% of the words
                  </div>
                </div>
              )}
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
