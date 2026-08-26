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

import { useRef, useState, useCallback } from 'react'

interface KnobProps {
  value: number
  min?: number
  max?: number
  defaultValue?: number
  size?: number
  color?: string
  label?: string
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
  min = -1,
  max = 1,
  defaultValue = 0,
  size = 32,
  color = 'var(--accent)',
  label,
  bipolar,
  spread,
  title,
  onChange,
  onCommit,
  format,
}: KnobProps) {
  const dragRef = useRef<{ y: number; v: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)

  const norm = max === min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)))
  const angle = A0 + norm * SWEEP
  const r = size / 2 - 3
  const cx = size / 2, cy = size / 2

  const arc = (from: number, to: number, radius: number) => {
    const s = ((from - 90) * Math.PI) / 180, e = ((to - 90) * Math.PI) / 180
    const x1 = cx + radius * Math.cos(s), y1 = cy + radius * Math.sin(s)
    const x2 = cx + radius * Math.cos(e), y2 = cy + radius * Math.sin(e)
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return
    e.preventDefault()
    // Capture on the SVG itself, not on e.target: the inner arc path is
    // replaced on every redraw, which silently drops the capture and leaves the
    // knob stuck "held" after the mouse is released.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic event in tests */ }
    dragRef.current = { y: e.clientY, v: value }
    setDragging(true)
  }, [value])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    // Shift is the fine adjustment — five times slower, which is the difference
    // between setting a filter roughly and setting it exactly.
    const perPixel = (e.shiftKey ? 0.002 : 0.01) * (max - min)
    onChange(Math.min(max, Math.max(min, d.v + (d.y - e.clientY) * perPixel)))
  }, [min, max, onChange])

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    onCommit?.(value)
  }, [value, onCommit])

  const shown = format ? format(value) : String(Math.round(value * 100) / 100)
  const live = hovered || dragging

  return (
    <div
      style={{
        display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        width: size + 14, userSelect: 'none',
      }}
      title={title ?? (label ? `${label} — drag to change, double-click resets` : shown)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        width={size} height={size}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onDoubleClick={() => { onChange(defaultValue); onCommit?.(defaultValue) }}
        // touchAction:none or a drag on a tablet scrolls the panel instead of
        // turning the knob.
        style={{ cursor: 'ns-resize', touchAction: 'none', display: 'block' }}
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
        {bipolar
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
      {label && (
        // One line, not two: the label rests there and the VALUE takes its place
        // only while you are on the knob. Two lines would cost twice the height
        // in a rack that is mostly knobs.
        <span style={{
          fontSize: 8.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: live ? 'var(--text-primary)' : 'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          whiteSpace: 'nowrap', maxWidth: size + 14, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{live ? shown : label}</span>
      )}
    </div>
  )
}
