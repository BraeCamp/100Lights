'use client'

// Beacon's rotary control, drawn in Apollo's visual language.
//
// The two studios had drifted into different hands: Apollo's knobs are SVG with
// a 270° arc, a flat face and a needle, while Beacon's were canvas with a 300°
// arc, a centre dot and no pointer at all — plus hardcoded greys that ignored
// the workshop theme, so a knob stayed the same colour whatever the studio was
// set to. Moving between the two felt like moving between two products.
//
// This is Apollo's geometry exactly (a0 -135°, sweep 270°, r = size/2 - 3, face
// at r - 4.5, needle from 0.25 to (r-7)) with Apollo's behaviour — drag
// vertically, shift for fine, double-click to reset, and the label giving way to
// the value while you are touching it. What is deliberately NOT copied is
// Apollo's modulation ring, quick-mod button and patch-path binding: those need
// Apollo's patch context, and a knob in Beacon has no matrix to route.
//
// The colours come from CSS variables rather than Apollo's literal hexes, so the
// knobs follow the workshop theme instead of pinning the studio to one palette.
//
// A knob is also a slider to a keyboard and a screen reader. It takes focus,
// announces its value in the parameter's unit, nudges with the arrow keys
// (Shift for fine, Page keys for coarse, Home/End for the ends), resets with
// Delete, and opens a typed entry on Enter or the first digit — "800" into a
// cutoff, "L30" into a pan, "-6dB" into a gain. The mouse never had to know
// any of this; the keyboard could not do without it.

import { useRef, useState, useCallback, useEffect } from 'react'
import { type KnobSpec, knobToNorm, knobFromNorm, KNOB_STEP, formatKnobValue, parseKnobEntry } from '@/lib/knob-math'

interface KnobProps {
  value: number
  min?: number
  max?: number
  defaultValue?: number
  size?: number
  color?: string
  label?: string
  /**
   * What the number IS: its range, unit and taper. With a spec the knob takes
   * the value in the parameter's own unit (800 for a cutoff, not 0.34), spaces
   * a log parameter by ratio itself, reads the value back with its unit, and
   * understands a typed "1.2k". Explicit min / max props still win over it.
   */
  spec?: KnobSpec
  /** Draw the arc out from the centre — for pan, and anything else ±. */
  bipolar?: boolean
  /** When several things are selected and they DISAGREE, the span they cover,
   *  as 0..1 of the range. Drawn as a dim arc behind the value, so "these are
   *  all different" survives the move from slider to knob — the slider showed
   *  it as a coloured band along the track, and dropping it would have made a
   *  multi-selection silently look like a single value. */
  spread?: [number, number] | null
  /** Replaces the default hover text. Several controls that became knobs had a
   *  sentence explaining what they do, and that is worth more than "drag to
   *  change" which the shape already tells you. */
  title?: string
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  format?: (v: number) => string
}

// Apollo's geometry, to the degree.
const A0 = -135
const SWEEP = 270

export default function Knob({
  value,
  min,
  max,
  defaultValue,
  size = 32,
  color = 'var(--accent)',
  label,
  spec,
  bipolar,
  spread,
  title,
  onChange,
  onCommit,
  format,
}: KnobProps) {
  // One description of the range, whichever way it arrived.
  const S: KnobSpec = {
    ...(spec ?? {}),
    min: min ?? spec?.min ?? -1,
    max: max ?? spec?.max ?? 1,
  }
  const home = defaultValue ?? (S.min < 0 && S.max > 0 ? 0 : S.min)
  // The spec's label is the full name ("Pan"); the visible label is often a
  // glyph ("P") that means nothing read aloud.
  const name = spec?.label ?? label

  const dragRef = useRef<{ y: number; n: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // The typed entry, while it is open; null otherwise. The ref is the same
  // text without the render delay: Escape closes the entry, the input then
  // blurs on its way out, and the blur must find it already closed rather
  // than commit the text a second time.
  const [typing, setTypingState] = useState<string | null>(null)
  const typingRef = useRef<string | null>(null)
  const setTyping = useCallback((t: string | null) => { typingRef.current = t; setTypingState(t) }, [])

  const norm = knobToNorm(value, S)
  const angle = A0 + norm * SWEEP
  const r = size / 2 - 3
  const cx = size / 2, cy = size / 2

  const arc = (from: number, to: number, radius: number) => {
    const s = ((from - 90) * Math.PI) / 180, e = ((to - 90) * Math.PI) / 180
    const x1 = cx + radius * Math.cos(s), y1 = cy + radius * Math.sin(s)
    const x2 = cx + radius * Math.cos(e), y2 = cy + radius * Math.sin(e)
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }

  const setNorm = useCallback((n: number) => {
    onChange(knobFromNorm(n, S))
  }, [onChange, S.min, S.max, S.curve]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return
    e.preventDefault()
    // Capture on the SVG itself, not on e.target: the inner arc path is
    // replaced on every redraw, which silently drops the capture and leaves the
    // knob stuck "held" after the mouse is released.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic event in tests */ }
    dragRef.current = { y: e.clientY, n: norm }
    setDragging(true)
    // A knob you are turning is the knob the keyboard is on.
    e.currentTarget.focus({ preventScroll: true })
  }, [norm])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    // Shift is the fine adjustment — five times slower, which is the difference
    // between setting a filter roughly and setting it exactly. Measured along
    // the arc, so a log knob drags by ratio the way it steps by ratio.
    const perPixel = e.shiftKey ? KNOB_STEP.fine : KNOB_STEP.step
    setNorm(d.n + (d.y - e.clientY) * perPixel)
  }, [setNorm])

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    onCommit?.(value)
  }, [value, onCommit])

  const reset = useCallback(() => { onChange(home); onCommit?.(home) }, [onChange, onCommit, home])

  const onKeyDown = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    let n: number | null = null
    const size = e.shiftKey ? KNOB_STEP.fine : KNOB_STEP.step
    if (k === 'ArrowUp' || k === 'ArrowRight') n = norm + size
    else if (k === 'ArrowDown' || k === 'ArrowLeft') n = norm - size
    else if (k === 'PageUp') n = norm + KNOB_STEP.coarse
    else if (k === 'PageDown') n = norm - KNOB_STEP.coarse
    else if (k === 'Home') n = 0
    else if (k === 'End') n = 1
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); reset(); return }
    else if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); setTyping(''); return }
    else if (/^[-+.\d]$/.test(k)) { e.preventDefault(); e.stopPropagation(); setTyping(k); return }
    if (n == null) return
    e.preventDefault()
    e.stopPropagation()
    const v = knobFromNorm(n, S)
    onChange(v)
    onCommit?.(v)
  }, [norm, reset, onChange, onCommit, S.min, S.max, S.curve]) // eslint-disable-line react-hooks/exhaustive-deps

  // The typed entry takes the keyboard the moment it opens, and hands it back
  // to the knob when it closes — whichever way it closed.
  useEffect(() => {
    if (typing != null) {
      const el = inputRef.current
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
    }
  }, [typing != null]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeTyping = useCallback((commit: boolean) => {
    const text = typingRef.current
    if (text == null) return
    setTyping(null)
    svgRef.current?.focus({ preventScroll: true })
    if (!commit) return
    const v = parseKnobEntry(text, S)
    if (v == null) return
    onChange(v)
    onCommit?.(v)
  }, [setTyping, onChange, onCommit, S.min, S.max, S.unit]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = format ? format(value) : spec ? formatKnobValue(value, S) : String(Math.round(value * 100) / 100)
  const live = hovered || dragging || focused
  const isBipolar = bipolar ?? (spec ? S.min < 0 && S.max > 0 : false)

  return (
    <div
      style={{
        display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        width: size + 14, userSelect: 'none',
      }}
      title={title ?? (name ? `${name} — drag to change, double-click resets, Enter types a value` : shown)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        ref={svgRef}
        width={size} height={size}
        role="slider"
        tabIndex={0}
        aria-label={name ?? title ?? 'Knob'}
        aria-valuemin={S.min}
        aria-valuemax={S.max}
        aria-valuenow={Math.round(value * 1000) / 1000}
        aria-valuetext={shown}
        aria-orientation="vertical"
        data-knob=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // touchAction:none or a drag on a tablet scrolls the panel instead of
        // turning the knob. The round outline is the focus ring: the global
        // :focus-visible rule squares it off at 2px, and a square ring around
        // a round knob reads as a bug.
        style={{ cursor: 'ns-resize', touchAction: 'none', display: 'block', borderRadius: '50%', outlineOffset: 1 }}
      >
        {/* The unfilled part of the arc.
            var(--border) alone is almost invisible against a dark panel — on
            the mixer strip a centred pan knob showed as a bare needle floating
            in space, with nothing to say it was a control at all. Apollo gets
            away with the same colour because its knobs are 38-42px; these are
            26-30px in a 72px strip. Layering a faint wash of the value colour
            over the border gives the ring a visible body while still reading as
            "empty", and it follows the theme rather than pinning a grey. */}
        <path d={arc(A0, A0 + SWEEP, r)} stroke="var(--border)" strokeWidth={3.5} fill="none" strokeLinecap="round" />
        <path d={arc(A0, A0 + SWEEP, r)} stroke={color} strokeWidth={3.5} fill="none" strokeLinecap="round" opacity={0.18} />
        {/* The spread of a multi-selection, behind everything else. */}
        {spread && Math.abs(spread[1] - spread[0]) > 0.005 && (
          <path
            d={arc(A0 + Math.min(spread[0], spread[1]) * SWEEP, A0 + Math.max(spread[0], spread[1]) * SWEEP, r)}
            stroke="#f59e0b" strokeWidth={3.5} fill="none" strokeLinecap="round" opacity={0.55} />
        )}
        {isBipolar
          ? <path
              d={norm >= 0.5 ? arc(A0 + 0.5 * SWEEP, angle, r) : arc(angle, A0 + 0.5 * SWEEP, r)}
              stroke={color} strokeWidth={3.5} fill="none" strokeLinecap="round" />
          : <path d={arc(A0, angle, r)} stroke={color} strokeWidth={3.5} fill="none" strokeLinecap="round" />}
        {/* Flat face — Apollo dropped the gradient and bevel, so this does too. */}
        <circle cx={cx} cy={cy} r={Math.max(1, r - 4.5)} fill="var(--bg-surface, #252c36)" />
        {/* Needle length is a FRACTION of the radius, not Apollo's fixed pixel
            offsets. Those assume a 38-42px knob: at 26px they work out to a
            three-pixel stub, which is why the first version of these read as a
            speck rather than a pointer. Proportional keeps the same look at
            every size Beacon uses. */}
        <line
          x1={cx + r * 0.25 * Math.cos(((angle - 90) * Math.PI) / 180)}
          y1={cy + r * 0.25 * Math.sin(((angle - 90) * Math.PI) / 180)}
          x2={cx + r * 0.72 * Math.cos(((angle - 90) * Math.PI) / 180)}
          y2={cy + r * 0.72 * Math.sin(((angle - 90) * Math.PI) / 180)}
          stroke="var(--text-primary)" strokeWidth={Math.max(1.4, size / 18)} strokeLinecap="round"
        />
      </svg>
      {typing != null ? (
        // The typed entry sits where the label sits, so the knob does not jump.
        // Enter commits, Escape lets go, and clicking away commits what is there.
        <input
          ref={inputRef}
          value={typing}
          aria-label={`${name ?? 'Value'} — type a value`}
          data-knob-entry=""
          onChange={e => setTyping(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') { e.preventDefault(); closeTyping(true) }
            else if (e.key === 'Escape') { e.preventDefault(); closeTyping(false) }
          }}
          onBlur={() => closeTyping(true)}
          onPointerDown={e => e.stopPropagation()}
          style={{
            width: size + 14, boxSizing: 'border-box', fontSize: 9, lineHeight: 1, padding: '1px 2px',
            textAlign: 'center', fontVariantNumeric: 'tabular-nums',
            background: 'var(--bg-surface)', color: 'var(--text-primary)',
            border: '1px solid var(--accent)', borderRadius: 2, outline: 'none',
          }}
        />
      ) : label ? (
        // One line, not two: the label rests there and the VALUE takes its place
        // only while you are on the knob. Two lines would cost twice the height
        // in a rack that is mostly knobs.
        <span style={{
          fontSize: 8.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: live ? 'var(--text-primary)' : 'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          whiteSpace: 'nowrap', maxWidth: size + 14, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{live ? shown : label}</span>
      ) : null}
    </div>
  )
}
