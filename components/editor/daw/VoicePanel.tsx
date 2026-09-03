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
  Settings, BookOpen, ChevronLeft, Video, Minus, ScrollText,
} from 'lucide-react'
import { commandHelp } from '@/lib/voice/interpret'
import VoiceUsageLog from './VoiceUsageLog'
import VoiceMacros from './VoiceMacros'
import VoiceTranscript from './VoiceTranscript'
import VoiceLibrary from './VoiceLibrary'

// ⚠️ The bar beside the card must NOT re-render with the level meter. The
// card re-renders on every meter update (twelve a second while listening);
// without these the transcript, the cost log, the macro list and the command
// library all re-rendered with it, and a long session got slower and slower —
// Brae: "Light was slower to transcribe what I was saying the longer it ran."
// Their props are stable objects, so memo() lets them sit still.
const TranscriptMemo = React.memo(VoiceTranscript)
const UsageLogMemo = React.memo(VoiceUsageLog)
const MacrosMemo = React.memo(VoiceMacros)
const LibraryMemo = React.memo(VoiceLibrary)

/**
 * What is open in the bar BESIDE the voice card.
 *
 * Brae: "When this or any other of the buttons in the voice control window are
 * selected, they will open in a bar next to voice control so that voice control
 * stays on screen."
 *
 * ⚠️ NEVER INSTEAD OF THE CARD. Settings, the transcript, the costs, the named
 * shapes and the list of what Light can do all used to replace the live view —
 * so reading any of them meant losing sight of the one line that says what the
 * studio is hearing right now. They open in a second card to the left; the
 * live card stays where it is.
 */
export type VoiceSide = 'none' | 'settings' | 'usage' | 'macros' | 'transcript' | 'help'
import type { AssistantMode } from '@/lib/voice/speak'
import { usePlan } from '@/hooks/usePlan'
import { WAKE_WORDS } from '@/lib/voice/attention'
import { LUMENS_NAME } from '@/lib/credit-tiers'

export interface VoicePanelProps {
  /**
   * Which way this opens from its button.
   *
   * ⚠️ It was always 'down', which is right in the transport bar and wrong
   * everywhere else: docked in the bottom-right corner, a 544px panel opening
   * downwards is entirely off the screen. The caller measures.
   */
  placement?: 'down' | 'up'
  /** Open/close animation class — see popClass() in lib/ui/popup.ts. */
  animClass?: string
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
  /**
   * The ✕: turn voice control OFF, exactly as pressing the voice button would.
   *
   * Brae: "The x button will turn off voice controls as if the voice control
   * button was pressed to toggle off." A close that only hid the card left the
   * microphone open behind it, which is the one thing a microphone must never
   * quietly do.
   */
  onClose: () => void
  /** The –: put the card away and keep listening. */
  onMinimize: () => void
  /** What the bar beside the card is showing, and how to change it. */
  side: VoiceSide
  onSide: (s: VoiceSide) => void
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
  /** Big on-screen captions of what was said, for screen recordings. */
  caption: boolean
  onCaption: (on: boolean) => void
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
  /** How long a pause counts as the end of a sentence (silence-tail multiplier). */
  patience: number
  onPatience: (v: number) => void
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

    // ⚠️ Handled by the animation loop below, which is the whole point: this
    // effect only re-runs when level/talking/listening/C change, and while the
    // studio is speaking NONE of them do. The travelling wave advanced its
    // phase exactly once and then sat there — a single frozen frame, which is
    // what Brae saw as "a barely visible black static wave". It was not dim so
    // much as stopped.
    if (talking) return

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

  /**
   * The studio's own voice, drawn while it speaks.
   *
   * ⚠️ A real animation loop, not a redraw that happens to be triggered by
   * something else changing. Nothing about the studio talking changes any React
   * state — that is the point of it being a read-back — so there is nothing to
   * re-render on and the drawing has to drive itself.
   *
   * Synthesised rather than analysed, deliberately and consistently: the studio
   * speaks through an <audio> element for its own voice and through the
   * browser's speechSynthesis when that is unavailable, and the second of those
   * exposes no audio node at all. A meter that is real half the time and
   * invented the other half is worse than one that is honestly a voice-shaped
   * animation both times.
   */
  useEffect(() => {
    const el = canvas.current
    if (!talking || !el) return
    let raf = 0
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight
      const g = el.getContext('2d')
      if (!g || !w || !h) { raf = requestAnimationFrame(draw); return }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (el.width !== w * dpr || el.height !== h * dpr) { el.width = w * dpr; el.height = h * dpr }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const mid = h / 2
      phase.current += 0.13

      // Three bands at unrelated speeds, so it reads as speech rather than as a
      // sine wave — a single frequency looks like a test tone, which is exactly
      // what it would be.
      const bands = [
        { k: 11, a: 0.34, s: 1.00 },
        { k: 19, a: 0.20, s: -1.7 },
        { k: 5,  a: 0.24, s: 0.55 },
      ]
      // A slow swell so it breathes between phrases instead of running flat.
      const breath = 0.72 + 0.28 * Math.sin(phase.current * 0.7)

      const shape = (t: number) => {
        // Tapered at both ends, so it sits in the card rather than colliding
        // with the edges.
        const envelope = Math.sin(Math.PI * t) ** 0.8
        let v = 0
        for (const b of bands) v += Math.sin(t * b.k + phase.current * b.s) * b.a
        return v * envelope * breath
      }

      // Filled body first — a 1.5px stroke on a dark card is close to invisible,
      // which is the other half of what was wrong.
      g.beginPath()
      g.moveTo(0, mid)
      for (let x = 0; x <= w; x += 2) g.lineTo(x, mid + shape(x / w) * (h * 0.42))
      for (let x = w; x >= 0; x -= 2) g.lineTo(x, mid - shape(x / w) * (h * 0.42))
      g.closePath()
      g.globalAlpha = 0.22
      g.fillStyle = C.accent
      g.fill()

      g.globalAlpha = 1
      g.strokeStyle = C.accent
      g.lineWidth = 2
      g.lineJoin = 'round'
      // A soft glow, so it is legible on any card colour without needing to
      // know which one it is.
      g.shadowColor = C.accent
      g.shadowBlur = 6
      g.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const y = mid + shape(x / w) * (h * 0.42)
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.stroke()
      g.shadowBlur = 0

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [talking, C])

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
  placement = 'down', animClass = '',
  listening, continuous, level, hud,
  talking = false, saying = '', reply = '', problem = '', question,
  onHud, onClose, onMinimize, side, onSide, caption, onCaption, colors: C,
  mode, onMode, enterRuns, onEnterRuns, speaks, onSpeaks, canSpeak, studio, onStudio,
  mic, threshold = 0, sensitivity, onSensitivity, patience, onPatience,
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
  // (The card used to switch between live / settings / usage / macros. It no
  // longer switches at all — see VoiceSide: everything else opens beside it.)
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
    // The whole row moves — the card AND the bar beside it — so the offset is
    // measured against the row, not the card the title bar happens to be in.
    const card = (e.currentTarget as HTMLElement).closest('[data-voice-panel-root]') as HTMLElement | null
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

  // Stable props for the memoised bar contents (see the memo() wrappers above).
  const closeSide = useCallback(() => onSide('none'), [onSide])
  const libColors = React.useMemo(() => ({
    bgSurface: C.bgSurface, border: C.border, textPrimary: C.textPrimary, textMuted: C.textMuted, accent: C.accent,
  }), [C.bgSurface, C.border, C.textPrimary, C.textMuted, C.accent])

  const card = {
    width: 412, maxHeight: 544, display: 'flex', flexDirection: 'column' as const,
    background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 8,
    boxShadow: '0 18px 48px rgba(0,0,0,.55)', overflow: 'hidden',
    fontSize: 11, color: C.textPrimary,
  }
  const SIDE_TITLE: Record<Exclude<VoiceSide, 'none'>, string> = {
    settings: 'SETTINGS', usage: 'USAGE & COSTS', macros: 'NAMED SHAPES',
    transcript: 'TRANSCRIPT', help: 'WHAT LIGHT CAN DO',
  }

  return (
    <div
      data-voice-panel-root
      className={pos ? undefined : animClass}
      style={{
        // Fixed once it has been moved, so it stays where it was put rather
        // than following the button that opened it. A panel the person has
        // dragged somewhere is not animated or re-placed — they chose where it
        // goes, and moving it out from under them would be the bug.
        ...(pos
          ? { position: 'fixed' as const, left: pos.x, top: pos.y }
          : placement === 'up'
            ? { position: 'absolute' as const, bottom: 'calc(100% + 8px)', right: 0 }
            : { position: 'absolute' as const, top: 'calc(100% + 8px)', right: 0 }),
        zIndex: 80,
        // A row: the bar beside the card grows LEFT from the anchor, so the
        // card itself never moves when something opens next to it.
        display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 8,
      }}
      onClick={e => e.stopPropagation()}
    >
    <div data-voice-panel style={card}>
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

        {/* ⚠️ In the title bar, not buried in Settings.
            Brae: "We'll add a help button in the voice control window that
            pulls up another window for it." Nobody goes looking through
            settings to find out what a thing can do — the question arrives
            while you are already talking to it. */}
        {/* Each of these opens BESIDE the card, and pressing the one that is
            open closes it. The live view underneath never changes. */}
        {([
          { key: 'transcript', icon: <ScrollText size={13} />, label: 'Transcript — what was said and done' },
          { key: 'help', icon: <BookOpen size={13} />, label: 'What Light can do' },
          { key: 'settings', icon: <Settings size={13} />, label: 'Settings' },
        ] as { key: Exclude<VoiceSide, 'none'>; icon: React.ReactNode; label: string }[]).map(b => (
          <button
            key={b.key}
            onClick={() => onSide(side === b.key ? 'none' : b.key)}
            aria-label={b.label}
            aria-pressed={side === b.key}
            title={b.label}
            data-voice-side-button={b.key}
            style={{
              display: 'flex', alignItems: 'center', height: 20, padding: '0 5px',
              borderRadius: 4, cursor: 'pointer', border: 'none',
              background: side === b.key ? `${C.accent}22` : 'transparent',
              color: side === b.key ? C.accent : C.textMuted,
            }}
          >
            {b.icon}
          </button>
        ))}

        {/* Brae: "Add a minimize button to the voice control card and make that
            make the button close the window. The x button will turn off voice
            controls as if the voice control button was pressed to toggle off."
            Two buttons, two different things: – puts the card away and keeps
            listening; ✕ stops listening altogether. */}
        <button
          onClick={onMinimize}
          aria-label="Minimize — hide the card, keep listening"
          title="Hide the card (voice stays on)"
          data-voice-minimize
          style={{
            display: 'flex', alignItems: 'center', height: 20, padding: '0 4px',
            borderRadius: 4, cursor: 'pointer', border: 'none',
            background: 'transparent', color: C.textMuted,
          }}
        >
          <Minus size={13} />
        </button>
        <button
          onClick={onClose}
          aria-label="Turn voice control off"
          title="Turn voice control off"
          data-voice-off
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
      <div style={{ padding: '10px 12px 6px', borderBottom: `1px solid ${C.border}` }}>
        <Wave level={level} talking={talking} listening={listening} C={C} />
      </div>

      {queue.length > 0 && (
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
        {(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 96 }}>
            {/* ── You ────────────────────────────────────────────────────
                Brae: "we will also separate the visuals for the user speaking
                and light responding." Two rows, two voices: yours is labelled,
                left-edged and plain; Light's is labelled, tinted in the accent
                and marked with the spark. The wave above belongs to whoever is
                making sound — it already knows which. */}
            <div data-voice-you style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{
                flex: '0 0 auto', marginTop: 3, width: 16, height: 16, borderRadius: 8,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: listening && !talking ? `${C.accent}33` : 'rgba(255,255,255,.06)',
                color: listening && !talking ? C.accent : C.textMuted,
                transition: 'background 200ms, color 200ms',
              }}><Mic size={10} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: C.textMuted, marginBottom: 2 }}>YOU</div>
                {/* What you are saying, right now. One line, large enough to
                    read from where somebody actually sits — across a desk,
                    mid-take, while looking at the arrangement. */}
                <div style={{
                  fontSize: 15, lineHeight: 1.4, color: saying ? C.textPrimary : C.textMuted,
                  fontStyle: saying ? 'normal' : 'italic', minHeight: 21,
                  transition: 'color 160ms',
                }}>
                  {saying || (listening
                    ? 'Listening — say what you want.'
                    : 'Hold the button, or switch to click-to-talk in Settings.')}
                </div>
              </div>
            </div>

            {/* ── Light ──────────────────────────────────────────────────
                What it said back. Kept because a reply that vanishes leaves
                you unable to tell "it did the wrong thing" from "it did
                nothing" — which is the question this whole card exists to
                answer. */}
            {(reply || problem || talking) && (
              <div data-voice-light style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{
                  flex: '0 0 auto', marginTop: 3, width: 16, height: 16, borderRadius: 8,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: problem ? '#e0776b33' : `${C.accent}33`,
                  color: problem ? '#e0776b' : C.accent,
                  animation: talking ? 'pulse 1.1s ease-in-out infinite' : undefined,
                }}><Sparkles size={10} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: problem ? '#e0776b' : C.accent, marginBottom: 2 }}>
                    LIGHT{talking ? ' · speaking' : ''}
                  </div>
                  <div
                    // The read-back's stable hook. It used to be on a bubble
                    // floating below the button; the bubble is gone and this
                    // is where the same text lives now, so the checks that
                    // read it still find the thing they were checking.
                    data-voice-readback
                    style={{
                      padding: '7px 9px', borderRadius: 6, lineHeight: 1.45,
                      borderLeft: `2px solid ${problem ? '#e0776b' : C.accent}`,
                      background: problem ? '#e0776b12' : `${C.accent}12`,
                      color: problem ? '#ffb4b4' : C.textPrimary,
                    }}
                  >
                    {problem || reply || '…'}
                  </div>
                </div>
              </div>
            )}

            {/* The question, in the same column as the answer it follows.
                Below the reply because that is the order it happened in: you
                said something, the studio answered, and this is what it still
                needs to know. */}
            {question}
          </div>
        )}

      </div>
    </div>

    {/* ── The bar beside the card ──────────────────────────────────────────
        Rendered after the card so the settings JSX below stays where it has
        always been, and placed BEFORE it visually (order: -1) so it opens to
        the left, away from the screen edge the card is anchored to. */}
    {side !== 'none' && (
      <div
        data-voice-side={side}
        className="menu-pop"
        style={{ ...card, width: side === 'help' ? 420 : 380, order: -1 }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,.02)',
        }}>
          <span style={{ fontWeight: 800, letterSpacing: 0.3, fontSize: 10 }}>{SIDE_TITLE[side]}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => onSide('none')}
            aria-label="Close this bar"
            title="Close"
            style={{
              display: 'flex', alignItems: 'center', height: 20, padding: '0 4px',
              borderRadius: 4, cursor: 'pointer', border: 'none',
              background: 'transparent', color: C.textMuted,
            }}
          >
            <X size={13} />
          </button>
        </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: side === 'help' ? 0 : 10, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {side === 'usage' && <UsageLogMemo C={C} />}
        {side === 'macros' && <MacrosMemo C={C} />}
        {side === 'transcript' && <TranscriptMemo C={C} />}
        {side === 'help' && (
          <LibraryMemo embedded onClose={closeSide} colors={libColors} />
        )}

        {side === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── What it has cost ────────────────────────────────────────
                Brae: "Give an option in voice control settings to see a log
                with lumens and macros used, amounts of calls, costs per call".
                A button rather than a section, because it is a read-out you
                visit rather than a preference you set — and because most of
                what it has to say is about the commands that cost nothing. */}
            <button
              onClick={() => onSide('usage')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, padding: '7px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent',
                color: C.textPrimary, fontSize: 11, textAlign: 'left',
              }}
            >
              <span>Usage &amp; costs</span>
              <span style={{ color: C.textMuted, fontSize: 10 }}>
                what each command cost, and what was free
              </span>
            </button>

            {/* ── Named shapes ────────────────────────────────────────────
                Brae: "can we have a live list of these macros someplace?"
                Beside the costs on purpose: these two answer the same
                question from opposite ends — one shows what you spent, the
                other shows the names that stop you spending it again. */}
            <button
              onClick={() => onSide('macros')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, padding: '7px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent',
                color: C.textPrimary, fontSize: 11, textAlign: 'left',
              }}
            >
              <span>Named shapes</span>
              <span style={{ color: C.textMuted, fontSize: 10 }}>
                moves you can ask for again by name
              </span>
            </button>

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
                onClick={() => onSide('help')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  width: '100%', height: 26, borderRadius: 5, cursor: 'pointer',
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.textPrimary, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                }}
              >
                <BookOpen size={11} />
                What you can say
              </button>
            </Group>

            <Group C={C} icon={<Video size={11} />} title="Recording">
              <Toggle
                C={C}
                on={caption}
                onChange={onCaption}
                label="Show what I say, big"
                note={'Puts what you said and what the studio did on screen in large type, '
                  + 'and clears them a few seconds later. Meant for screen recordings — on a '
                  + 'phone the card in the corner is too small to read, and a voice demo '
                  + 'where you cannot see the words is a studio changing for no visible reason.'}
              />
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

              {/* ── How long it waits for you to finish ─────────────────
                  Brae: "Voice control is getting ahead of itself… The user
                  should be able to adjust the sensitivity of its hearing."
                  Two dials, not one: the row above is how LOUD you must be;
                  this is how long a pause has to last before the sentence is
                  taken as finished. Thinking mid-sentence wants this up. */}
              <div style={{ marginTop: 8, fontSize: 10, color: C.textMuted, lineHeight: 1.45 }}>
                How long it waits after you go quiet before it acts
              </div>
              <div data-voice-patience style={{ display: 'flex', gap: 3 }}>
                {([
                  [0.7, 'Snappy', 'acts about a second after you stop — for short commands'],
                  [1, 'Normal', 'the default, 1.2 seconds'],
                  [1.5, 'Patient', 'lets you pause to think mid-sentence'],
                  [2.2, 'Unhurried', 'for long, slowly spoken requests'],
                ] as const).map(([v, label, why]) => {
                  const active = Math.abs(patience - v) < 0.01
                  return (
                    <button
                      key={label}
                      title={why}
                      onClick={() => onPatience(v)}
                      aria-pressed={active}
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
      </div>
      </div>
    )}
    </div>
  )
}
