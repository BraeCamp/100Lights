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
// One window instead. It carried a scrolling TRANSCRIPT for a while, and that
// was right when nobody trusted the feature yet — being able to check up on it
// is exactly what you want while you are learning whether it works.
//
// Brae, once it did: "change the conversation tab (which is now just the card)
// so that it only shows what you're saying right now." So the log is gone and
// the card is a live view — a wave, the sentence in progress, and the answer.
// A conversation is a live event, and a log of one competes with the single
// line that actually matters.

import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  X, Mic, ListChecks, GripVertical, Sparkles, Lock, Volume2, Gauge, Keyboard, Waves,
  Settings, BookOpen, ChevronLeft,
} from 'lucide-react'
import { commandHelp } from '@/lib/voice/interpret'
import type { AssistantMode } from '@/lib/voice/speak'
import { usePlan } from '@/hooks/usePlan'
import { WAKE_WORDS } from '@/lib/voice/attention'
import { LUMENS_NAME } from '@/lib/credit-tiers'

export interface VoicePanelProps {
  listening: boolean
  continuous: boolean
  /** 0–1 input level, for the meter and the wave. */
  level: number
  /**
   * Is the studio speaking right now?
   *
   * Its own voice has no level to read — it goes out through speechSynthesis or
   * an audio element, and the microphone is deliberately deafened while it
   * talks so it cannot transcribe itself. So this is a fact, not a
   * measurement, and the wave it drives is openly a drawn one.
   */
  talking?: boolean
  /**
   * What is being said RIGHT NOW — the live, partial transcript.
   *
   * Brae: "change the conversation tab so that it only shows what you're saying
   * right now."
   */
  saying?: string
  /** What the studio said back, and what went wrong if anything did. */
  reply?: string
  problem?: string
  /**
   * The question the studio is waiting on, rendered INSIDE this window.
   *
   * Brae: "Questions and answers should also live in the voice control window.
   * Things like 'I didn't catch that' and questions about what was said should
   * live there. That means that they shouldn't be in other places, since the
   * space around the voice control gets crowded."
   *
   * ⚠️ It arrives as a node rather than as data because the question owns real
   * behaviour - editable text, choice buttons, a name field - and that
   * behaviour belongs with the state it changes, in VoiceControl. What this
   * component decides is WHERE it goes, which is the whole point: one home, not
   * a popover competing with the window for the same corner.
   */
  question?: React.ReactNode
  hud: boolean
  onHud: (on: boolean) => void
  onClose: () => void
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
   * How much the assistant may do: nothing, ask first, or act.
   *
   * `ask` stays the default for everybody, because a misheard sentence is
   * indistinguishable from a correct one until a person reads it. What is new
   * is `rules` — off entirely, so the studio is a fixed vocabulary that cannot
   * spend anything.
   */
  assistant: AssistantMode
  onAssistant: (m: AssistantMode) => void
  /**
   * Which ear is listening: the browser's own recogniser, or the server's.
   *
   * This has always existed and was never a choice anybody could make — it was
   * set silently, and only ever as a fallback when the browser's recogniser
   * turned out not to work at all. It is the single biggest lever on whether
   * the studio understands you, so it belongs in front of somebody who is
   * having trouble being understood.
   */
  ear: 'browser' | 'server'
  onEar: (e: 'browser' | 'server') => void
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
    x: Math.max(pad - 392, Math.min(window.innerWidth - pad, p.x)),
    y: Math.max(0, Math.min(window.innerHeight - pad * 2, p.y)),
  }
}

// ── The pieces the settings are built from ──────────────────────────────────
//
// Brae: "clean up the setting section (and the rest of the voice command card)
// to look nicer? This is a major feature and we want it to look perfect."
//
// The settings had grown by accretion: nine native checkboxes and two radios in
// a flat column, some under a heading and some not, each explaining itself in a
// grey paragraph the same size as everything else. Every control was correct
// and the page had no shape — nothing said which of them mattered, and the two
// that spend money looked exactly like the one that hides the toolbar.
//
// So: everything lives in a titled group, every group carries an icon, and the
// three kinds of control look like three kinds of control. Nothing here is
// decoration — the visual weight follows the consequence.

interface Palette { border: string; textPrimary: string; textMuted: string; accent: string }

/**
 * The wave across the top of the card.
 *
 * Brae: "above it is an audio visual that shows the wave when the machine (in AI
 * mode) is talking back to the user, and with a differently colored overlay
 * (warmer color) when the user is talking."
 *
 * Two waves, two sources, and they are not the same KIND of thing — which is
 * worth being straight about rather than papering over:
 *
 *   YOURS IS MEASURED. Every level the detector reports is pushed into a
 *   rolling buffer and drawn. It is the actual sound in the room, which is what
 *   makes it useful: a flat line while you are talking is the answer to "is it
 *   even hearing me", and no amount of animation would tell you that.
 *
 *   THE STUDIO'S IS DRAWN. There is no level to read. Its voice goes out
 *   through speechSynthesis or an audio element, and while it talks the
 *   microphone is deliberately deafened so it cannot transcribe itself — so the
 *   one meter we have is reading silence by design. Rather than invent a
 *   measurement, this is openly a travelling wave: it says "the studio is
 *   speaking" and does not pretend to say how loudly.
 *
 * Repainted on level updates rather than from a rAF loop, so a card sitting
 * open with nothing happening costs nothing — the same rule the editor's other
 * canvases follow.
 */
function Wave({ level, talking, listening, C }: {
  level: number; talking: boolean; listening: boolean; C: Palette
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const history = useRef<number[]>([])
  const phase = useRef(0)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w || !h) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (el.width !== w * dpr || el.height !== h * dpr) {
      el.width = w * dpr
      el.height = h * dpr
    }
    const g = el.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const BARS = 64
    const mid = h / 2
    const buf = history.current
    buf.push(Math.max(0, Math.min(1, level)))
    while (buf.length > BARS) buf.shift()

    // The studio's turn: a travelling wave, plainly generated.
    if (talking) {
      phase.current += 0.35
      g.strokeStyle = C.accent
      g.lineWidth = 1.5
      g.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const t = x / w
        const envelope = Math.sin(Math.PI * t)
        const y = mid + Math.sin(t * 14 + phase.current) * envelope * (h * 0.36)
        if (x === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
      return
    }

    // Your turn: the real levels, warm, mirrored around the centre line.
    const WARM = '#e8934a'
    const step = w / BARS
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]
      const amp = Math.max(1, v * (h * 0.44))
      const x = i * step
      // Recent samples are the ones being looked at; older ones fade back.
      g.globalAlpha = 0.35 + 0.65 * (i / Math.max(1, buf.length - 1))
      g.fillStyle = listening ? WARM : C.textMuted
      g.fillRect(x, mid - amp, Math.max(1, step - 1.5), amp * 2)
    }
    g.globalAlpha = 1

    // A resting line, so an idle card reads as "on and quiet" rather than
    // "broken".
    if (!buf.some(v => v > 0.02)) {
      g.strokeStyle = C.border
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, mid)
      g.lineTo(w, mid)
      g.stroke()
    }
  }, [level, talking, listening, C])

  return (
    <canvas
      ref={canvas}
      aria-hidden
      style={{ width: '100%', height: 56, display: 'block' }}
    />
  )
}

/** A titled group. The only structure in the settings, and enough of it. */
function Group({ icon, title, note, children, C }: {
  icon: React.ReactNode; title: string; note?: string
  children: React.ReactNode; C: Palette
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'flex', color: C.textMuted }}>{icon}</span>
        <h3 style={{
          margin: 0, fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
          textTransform: 'uppercase', color: C.textMuted,
        }}>{title}</h3>
        <span style={{ flex: 1, height: 1, background: C.border }} />
      </header>
      {note && <p style={{ margin: 0, color: C.textMuted, lineHeight: 1.5 }}>{note}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{children}</div>
    </section>
  )
}

/**
 * A switch, not a checkbox.
 *
 * The native control is 13px of blue-grey that reads as a form field. These are
 * preferences somebody flips while listening to something, often more than
 * once, so they get a real target and a state that is legible from across the
 * desk. The whole row is the label, so the hit area is the row.
 */
function Toggle({ on, onChange, label, note, disabled, C }: {
  on: boolean; onChange: (v: boolean) => void; label: string
  note?: string; disabled?: boolean; C: Palette
}) {
  return (
    <label style={{
      display: 'flex', gap: 9, alignItems: 'flex-start',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!on)}
        style={{
          flex: '0 0 auto', width: 26, height: 15, marginTop: 1, padding: 0,
          borderRadius: 999, position: 'relative', transition: 'background 120ms, border-color 120ms',
          border: `1px solid ${on ? C.accent : C.border}`,
          background: on ? C.accent : 'transparent',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: on ? 13 : 2,
          width: 9, height: 9, borderRadius: 999,
          background: on ? '#0b0b0d' : C.textMuted,
          transition: 'left 120ms',
        }} />
      </button>
      <span style={{ flex: 1, lineHeight: 1.45 }}>
        <span style={{ color: C.textPrimary }}>{label}</span>
        {note && <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>{note}</span>}
      </span>
    </label>
  )
}

/**
 * One of several, laid out as one control rather than a stack of radios.
 *
 * Used where the options are alternatives and worth comparing — which ear, how
 * much the assistant may do, how hard it is to trigger. The chosen option
 * explains itself underneath, so all three explanations do not compete for
 * attention at once.
 */
function Segmented<T extends string>({ value, options, onChange, C, disabled }: {
  value: T
  options: { id: T; label: string; note: string; cost?: string; locked?: boolean }[]
  onChange: (v: T) => void
  C: Palette
  disabled?: boolean
}) {
  const chosen = options.find(o => o.id === value) ?? options[0]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{
        display: 'flex', gap: 2, padding: 2, borderRadius: 6,
        border: `1px solid ${C.border}`, background: 'rgba(0,0,0,.22)',
        opacity: disabled ? 0.5 : 1,
      }}>
        {options.map(o => {
          const active = o.id === value
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              disabled={disabled || o.locked}
              onClick={() => !disabled && !o.locked && onChange(o.id)}
              title={o.locked ? 'Included with a paid plan' : o.note}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                height: 22, borderRadius: 4, border: 'none',
                cursor: disabled || o.locked ? 'default' : 'pointer',
                background: active ? C.accent : 'transparent',
                color: active ? '#0b0b0d' : o.locked ? C.textMuted : C.textPrimary,
                fontSize: 10, fontWeight: active ? 800 : 600, letterSpacing: 0.2,
                transition: 'background 120ms, color 120ms',
              }}
            >
              {o.locked && <Lock size={9} />}
              {o.label}
            </button>
          )
        })}
      </div>
      {/* Only the chosen one explains itself. Three notes at once is a wall. */}
      <div style={{ color: C.textMuted, lineHeight: 1.45, minHeight: 28 }}>
        {chosen.note}
        {chosen.cost && (
          <span style={{ color: C.accent, marginLeft: 4 }}>{chosen.cost}</span>
        )}
      </div>
    </div>
  )
}

export default function VoicePanel({
  listening, continuous, level, hud,
  talking = false, saying = '', reply = '', problem = '', question,
  onHud, onClose, colors: C,
  mode, onMode, enterRuns, onEnterRuns, speaks, onSpeaks, canSpeak, studio, onStudio,
  initialTab = 'talk', mic, threshold = 0, sensitivity, onSensitivity,
  queue, collecting, onCollecting, onRunQueue, onClearQueue, onDropQueued,
  calibration, calibrating, calibrationPhrase, onCalibrate, credits,
  assistant, onAssistant, ear, onEar,
}: VoicePanelProps) {
  // Both AI settings cost money to use, so they are shown to everybody and
  // operable by whoever is paying. Shown rather than hidden: a control you
  // cannot see is not a decision you know you could have made.
  const { isPro, loading: planLoading } = usePlan()
  // A calibrated sensitivity is a measured number and will almost never be one
  // of the four presets, so the preset row would show nothing selected.
  const calibrated = ![0.7, 1, 1.5, 2.2].some(v => Math.abs(sensitivity - v) < 0.01)
  // One view at a time, reached from the gear rather than from a tab strip.
  //
  // Brae: "let's put settings into a gear button, and 'What you can say'
  // shouldn't be there for AI mode so have it as a button in settings."
  //
  // The tabs gave three things equal billing, and they are not equal: the live
  // view is what the card is FOR, settings are visited occasionally, and the
  // command list is a reference you read once. With the assistant acting on
  // whatever it hears, a permanent tab listing the built-in phrasings also
  // rather misstates what the thing can do.
  const [view, setView] = React.useState<'live' | 'settings' | 'help'>(
    initialTab === 'settings' ? 'settings' : initialTab === 'help' ? 'help' : 'live',
  )
  const [find, setFind] = useState('')

  // Built once per keystroke rather than per render, and matched on the
  // description as well as the phrase: half the time you know what you want to
  // happen and not what to call it.
  const matchedHelp = React.useMemo(() => {
    const needle = find.trim().toLowerCase()
    const groups = commandHelp()
    if (!needle) return groups
    return groups
      .map(g => ({
        ...g,
        items: g.items.filter(i =>
          i.say.toLowerCase().includes(needle) || i.what.toLowerCase().includes(needle)),
      }))
      .filter(g => g.items.length)
  }, [find])
  // The gear opens Settings, so the caller asking for it is honoured the same
  // way — by moving the view rather than by selecting a tab that no longer
  // exists.
  React.useEffect(() => {
    setView(initialTab === 'settings' ? 'settings' : initialTab === 'help' ? 'help' : 'live')
  }, [initialTab])

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

  // Two states, not four. A held-open session used to be either "attentive" or
  // "dormant, say the name to wake it", and the name is no longer required —
  // so a session that is open is simply listening.
  const state = !listening ? 'off' : !continuous ? 'listening' : 'attentive'

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
        width: 412, maxHeight: 544, display: 'flex', flexDirection: 'column',
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

        {/* Brae: "remove the hud button". Gone from here — it was a mode
            switch sitting in the same row as the close button, which is a lot
            of prominence for something used once a session. The setting itself
            is still in Settings, so nothing is lost. */}
        <button
          onClick={() => setView(v => (v === 'live' ? 'settings' : 'live'))}
          aria-label={view === 'live' ? 'Settings' : 'Back'}
          title={view === 'live' ? 'Settings' : 'Back'}
          style={{
            display: 'flex', alignItems: 'center', height: 20, padding: '0 5px',
            borderRadius: 4, cursor: 'pointer', border: 'none', background: 'transparent',
            color: view === 'live' ? C.textMuted : C.accent,
          }}
        >
          <Settings size={13} />
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

      {/* ── The wave, and what is being said right now ────────────────────
          Brae: "change the conversation tab (which is now just the card) so
          that it only shows what you're saying right now."

          The scrolling transcript is gone with the tabs. It was the right thing
          while nobody trusted the feature — you could check up on it — and it
          is the wrong thing now that the card is the whole interface: a
          conversation is a live event, and a log of it competes with the one
          line that matters. */}
      {view === 'live' && (
        <div style={{ padding: '10px 12px 6px', borderBottom: `1px solid ${C.border}` }}>
          <Wave level={level} talking={talking} listening={listening} C={C} />
        </div>
      )}

      {view === 'live' && queue.length > 0 && (
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
        {view === 'live' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 96 }}>
            {/* What you are saying, right now. One line, large enough to read
                from where somebody actually sits — across a desk, mid-take,
                while looking at the arrangement rather than at this. */}
            <div style={{
              fontSize: 15, lineHeight: 1.4, color: saying ? C.textPrimary : C.textMuted,
              fontStyle: saying ? 'normal' : 'italic', minHeight: 42,
            }}>
              {saying || (talking
                ? '…'
                : listening
                  ? 'Listening — say what you want.'
                  : 'Hold the button, or switch to click-to-talk in Settings.')}
            </div>

            {/* And what it said back. Kept because a reply that vanishes leaves
                you unable to tell "it did the wrong thing" from "it did
                nothing" — which is the question this whole card exists to
                answer. */}
            {(reply || problem) && (
              <div
                // The read-back's stable hook. It used to be on a bubble
                // floating below the button; the bubble is gone and this is
                // where the same text lives now, so the checks that read it
                // still find the thing they were checking.
                data-voice-readback
                style={{
                padding: '7px 9px', borderRadius: 6, lineHeight: 1.45,
                borderLeft: `2px solid ${problem ? '#e0776b' : C.accent}`,
                background: problem ? '#e0776b12' : `${C.accent}12`,
                color: problem ? '#ffb4b4' : C.textPrimary,
                }}
              >
                {problem || reply}
              </div>
            )}

            {/* The question, in the same column as the answer it follows.
                Below the reply because that is the order it happened in: you
                said something, the studio answered, and this is what it still
                needs to know. */}
            {question}
          </div>
        )}

        {view === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── The two that spend money ──────────────────────────────────
                First, and grouped together, because they are the only settings
                here with a bill attached and the only ones somebody might be
                switching between deliberately. Everything below is a
                preference; these two are a decision. */}
            <Group
              C={C}
              icon={<Sparkles size={11} />}
              title="AI"
              // What is SHOWN is what is stored, never a prettier version of
              // it. Forcing the display to "browser / off" for a free account
              // was tidier and untrue in one case that matters: the ear falls
              // back to the server on its own when a browser's recogniser
              // cannot reach its service, free account or not, and a panel
              // insisting otherwise would be arguing with the studio.
              note={planLoading ? undefined : isPro
                ? 'Both are yours to switch off and on. Off, the studio still works — it just uses its own ear and its own vocabulary.'
                : 'Included with a paid plan. Without one the studio uses its own ear and its built-in commands, which cost nothing and always work.'}
            >
              <div>
                <div style={{ color: C.textPrimary, marginBottom: 5 }}>Hearing</div>
                <Segmented
                  C={C}
                  value={ear}
                  disabled={planLoading}
                  onChange={onEar}
                  options={[
                    {
                      id: 'browser', label: 'Browser',
                      note: 'Your browser’s own recogniser. Instant, free, and shows the words as you say them — but it is a general one, and it has never heard of your track names.',
                    },
                    {
                      id: 'server', label: 'AI', locked: !isPro,
                      note: 'Records a few seconds and transcribes it properly. Slower by a beat, and much better in a room with noise in it — it is told your track names and the command vocabulary before it listens.',
                      cost: isPro ? 'Costs credits per command.' : undefined,
                    },
                  ]}
                />
              </div>

              <div>
                <div style={{ color: C.textPrimary, marginBottom: 5 }}>Understanding</div>
                <Segmented
                  C={C}
                  value={assistant}
                  disabled={planLoading}
                  onChange={onAssistant}
                  options={[
                    {
                      id: 'rules', label: 'Off',
                      note: 'The built-in commands only. Never calls out, never costs anything, and says so plainly when it does not know a sentence.',
                    },
                    {
                      id: 'ask', label: 'Ask first', locked: !isPro,
                      note: 'Anything the built-in commands cannot read stops and shows you what it heard. Nothing is spent until you say go.',
                    },
                    {
                      id: 'auto', label: 'Automatic', locked: !isPro,
                      note: 'Acts on what it heard without stopping to ask — including, sometimes, a sentence it misheard.',
                      cost: 'Spends credits on its own.',
                    },
                  ]}
                />
              </div>

              {credits && (
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 6, padding: '6px 8px',
                  borderRadius: 5, background: 'rgba(0,0,0,.22)', border: `1px solid ${C.border}`,
                  color: C.textMuted, fontVariantNumeric: 'tabular-nums',
                }}>
                  <span style={{ color: C.textPrimary, fontWeight: 700 }}>
                    {credits.left.toLocaleString()}
                  </span>
                  {LUMENS_NAME} left (about ${(credits.left / 5000).toFixed(2)})
                  <span style={{ marginLeft: 'auto' }}>last turn {credits.spent.toLocaleString()}</span>
                </div>
              )}

              {/* Brae: "'What you can say' shouldn't be there for AI mode so
                  have it as a button in settings near the program transcribe
                  button."

                  Here rather than as a tab, and here SPECIFICALLY: the list is
                  what the built-in commands cover, which is exactly the thing
                  the two controls above decide whether you are relying on. With
                  the assistant switched off it is the whole vocabulary and
                  worth reading; with the assistant acting it is trivia. */}
              <button
                onClick={() => setView('help')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  width: '100%', height: 26, borderRadius: 5, cursor: 'pointer',
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.textPrimary, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                }}
              >
                <BookOpen size={11} />
                What you can say without the assistant
              </button>
            </Group>

            {/* ── How you talk to it ───────────────────────────────────────── */}
            <Group C={C} icon={<Mic size={11} />} title="Talking to it">
              <Segmented
                C={C}
                value={mode}
                onChange={onMode}
                options={[
                  { id: 'hold' as const, label: 'Hold', note: 'Hold the button down while you speak, let go when you are done. Nothing is listening the rest of the time.' },
                  { id: 'toggle' as const, label: 'Keep listening', note: 'Click once and it stays open. Say what you want, as many times as you like — it acts on the commands it recognises and ignores the rest of the room.' },
                ]}
              />
              <Toggle
                C={C} on={enterRuns} onChange={onEnterRuns}
                label="Enter starts and runs a command"
                note="Only while you are not typing — Enter keeps its usual job in any field."
              />
              <Toggle
                C={C} on={collecting} onChange={onCollecting}
                label="Collect commands before running them"
                note={'Say several things, hear them back, then “execute”. Nothing happens until you say so.'}
              />
            </Group>

            {/* ── How it answers ───────────────────────────────────────────── */}
            <Group C={C} icon={<Volume2 size={11} />} title="Answering">
              <Toggle
                C={C} on={speaks} onChange={onSpeaks} disabled={!canSpeak}
                label="Answer out loud"
                note={canSpeak
                  ? 'Reads back what it did and asks questions aloud. Stays quiet while the transport is running.'
                  : 'This browser has no speech voices installed.'}
              />
              {speaks && (
                <div style={{ paddingLeft: 35 }}>
                  <Toggle
                    C={C} on={studio} onChange={onStudio}
                    label="Studio voice"
                    note="A real recorded voice instead of the browser's. Each phrase is recorded once and then shared by everyone, so it costs you nothing. Falls back to the browser voice if it cannot be reached."
                  />
                </div>
              )}
            </Group>

            {/* ── The microphone ───────────────────────────────────────────── */}
            <Group
              C={C}
              icon={<Gauge size={11} />}
              title="How easily it triggers"
              note="Run the check below and it sets this from your own room and your own voice, which is better than any of the presets can be. Or set it by hand: watch the meter at the top while you talk and while the room does, and put the red line between the two."
            >
              {/* A measured setting is not one of these four, so it gets a place
                  of its own rather than leaving every button unlit and the
                  panel looking broken. It is listed first because it is the
                  one to prefer: the right bar is a property of a room, a
                  microphone and a voice, and none of the presets knows any of
                  the three. */}
              {calibrated && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                  borderRadius: 5, border: `1px solid ${C.accent}`,
                  background: `${C.accent}18`, color: C.accent,
                }}>
                  <Gauge size={11} />
                  <span style={{ fontWeight: 700 }}>Calibrated to your voice</span>
                  <span style={{ marginLeft: 'auto', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                    {sensitivity.toFixed(2)}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 3 }}>
                {([
                  [0.7, 'Quick', 'picks up quiet speech, and more of the room'],
                  [1, 'Normal', 'the default'],
                  [1.5, 'Firm', 'ignores conversation further away'],
                  [2.2, 'Strict', 'only a clear voice close to the microphone'],
                ] as const).map(([v, label, why]) => {
                  const active = Math.abs(sensitivity - v) < 0.01
                  return (
                    <button
                      key={label}
                      title={why}
                      onClick={() => onSensitivity(v)}
                      style={{
                        flex: 1, height: 24, borderRadius: 5, cursor: 'pointer', fontSize: 10,
                        fontWeight: active ? 800 : 600,
                        border: `1px solid ${active ? C.accent : C.border}`,
                        background: active ? `${C.accent}22` : 'transparent',
                        color: active ? C.accent : C.textMuted,
                        transition: 'background 120ms, color 120ms, border-color 120ms',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {calibrating ? (
                <div style={{
                  lineHeight: 1.5, padding: '7px 9px', borderRadius: 5,
                  border: `1px solid ${C.accent}55`, background: `${C.accent}12`,
                }}>
                  {calibrating === 'room'
                    ? 'Listening to the room — say nothing for a moment…'
                    : <>Now say: <span style={{ color: C.accent, fontWeight: 700 }}>&ldquo;{calibrationPhrase}&rdquo;</span></>}
                </div>
              ) : (
                <div>
                  <button
                    onClick={onCalibrate}
                    style={{
                      width: '100%', height: 26, borderRadius: 5, cursor: 'pointer',
                      border: `1px solid ${C.border}`, background: 'transparent',
                      color: C.textPrimary, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                    }}
                    // The recommended path, so it looks like one. Everything
                    // above it is the manual fallback.
                  >
                    Calibrate to my voice
                  </button>
                  {/* What it will do, before it does it. Dropped in the first
                      pass of this redesign and put back: a button that opens a
                      two-stage measurement should say so, and "says which part
                      is the problem" is the reason anybody would press it. */}
                  <div style={{ color: C.textMuted, marginTop: 5, lineHeight: 1.45 }}>
                    Measures the room, then asks you to say one sentence, then says which
                    part is the problem — and sets the bar from what it measured, a third
                    of the way up from your room to your voice.
                  </div>
                </div>
              )}

              {calibration && !calibrating && (
                <div style={{
                  lineHeight: 1.5, padding: '7px 9px', borderRadius: 5,
                  border: `1px solid ${C.border}`, background: 'rgba(0,0,0,.22)',
                }}>
                  <div style={{ color: C.textPrimary }}>{calibration.verdict}</div>
                  <div style={{ color: C.textMuted, marginTop: 4 }}>
                    Heard: &ldquo;{calibration.heard}&rdquo;
                  </div>
                  <div style={{ color: C.textMuted, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                    room {calibration.floor.toFixed(3)} · voice {calibration.peak.toFixed(3)} ·
                    {' '}{calibration.headroom.toFixed(1)}× · {Math.round(calibration.accuracy * 100)}% of the words
                  </div>
                </div>
              )}

              {mic && (
                <div style={{
                  lineHeight: 1.5, padding: '7px 9px', borderRadius: 5,
                  border: `1px solid ${mic.degraded ? '#e0776b55' : C.border}`,
                  background: mic.degraded ? '#e0776b12' : 'rgba(0,0,0,.22)',
                  color: mic.degraded ? '#e0776b' : C.textMuted,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Waves size={10} />
                    {mic.label || 'default input'}
                    {mic.sampleRate ? ` · ${(mic.sampleRate / 1000).toFixed(1)} kHz` : ''}
                    {mic.echoCancellation ? ' · echo cancelling' : ' · raw'}
                  </div>
                  {mic.degraded && (
                    <div style={{ marginTop: 4 }}>
                      This device dropped to call quality when the microphone opened, which is what
                      makes playback sound grainy. It is the headset switching profiles, not the
                      studio — monitor on something else while voice is on.
                    </div>
                  )}
                </div>
              )}
            </Group>

            {/* ── The room it works in ─────────────────────────────────────── */}
            <Group C={C} icon={<Keyboard size={11} />} title="The studio">
              <Toggle
                C={C} on={hud} onChange={onHud}
                label="HUD"
                note="Hides everything but the song and the sound visuals."
              />
            </Group>
          </div>
        )}


        {view === 'help' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Reached from Settings now, so it needs its own way back — the
                gear toggles live/settings and would strand somebody here. */}
            <button
              onClick={() => setView('settings')}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
                padding: '3px 8px 3px 4px', borderRadius: 5, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 10, fontWeight: 700,
              }}
            >
              <ChevronLeft size={12} />
              Settings
            </button>
            {/* Sixty-two commands in one scroll is a reference nobody reads.
                The question people actually arrive with is "can I say X", and a
                filter answers it in one keystroke — matched on both the phrase
                and what it does, because half the time you know the effect and
                not the wording. */}
            <input
              value={find}
              onChange={e => setFind(e.target.value)}
              placeholder="What do you want to do?"
              aria-label="Filter commands"
              style={{
                width: '100%', height: 26, padding: '0 9px', borderRadius: 5,
                border: `1px solid ${C.border}`, background: 'rgba(0,0,0,.22)',
                color: C.textPrimary, fontSize: 11, outline: 'none',
              }}
            />
            {matchedHelp.map(group => (
              <div key={group.group}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
                }}>
                  <span style={{
                    color: C.accent, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                  }}>
                    {group.group.toUpperCase()}
                  </span>
                  <span style={{ flex: 1, height: 1, background: C.border }} />
                </div>
                {group.items.map(item => (
                  // Stacked, not two columns fighting over one line. The old
                  // layout right-aligned the description against the phrase and
                  // the two collided the moment either got long — which, on a
                  // 412px card, is most of them.
                  <div key={item.say} style={{ padding: '3px 0 4px', lineHeight: 1.4 }}>
                    <div style={{ color: C.textPrimary }}>&ldquo;{item.say}&rdquo;</div>
                    <div style={{ color: C.textMuted }}>{item.what}</div>
                  </div>
                ))}
              </div>
            ))}
            {!matchedHelp.length && (
              <div style={{ color: C.textMuted, lineHeight: 1.5 }}>
                Nothing matches that. The assistant may still manage it — say it and see,
                if it is switched on in Settings.
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
