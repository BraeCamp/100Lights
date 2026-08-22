'use client'
// ApolloCard — the synth opened ABOVE a host (the Beacon studio), the way
// Serum 2 opens as its own window over a DAW. One card, portal'd to <body>:
// the chrome (frame, backdrop, header) follows the app's theme tokens (the
// workshop customization vars), while the face inside is Apollo's own plate.
//
// `scope` picks what the card shows: 'all' = the whole instrument
// (collectively), or any single module (individually) — and the tabs in the
// card header switch between them without reopening.
//
// The card edits a patch OWNED BY THE HOST: ApolloProvider runs in embedded
// mode, so every tweak flows out through `onChange` (debounced) — in the DAW
// that dispatches SET_INSTRUMENT on the track — and none of the standalone
// app's autosave/session/deep-link machinery runs.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApolloProvider, useApollo, UI, Section } from './ApolloContext'
import type { ApolloPatch } from '@/lib/apollo/patch'
import OscPanel from './OscPanel'
import SubNoisePanel from './SubNoisePanel'
import FilterPanel from './FilterPanel'
import EnvPanel from './EnvPanel'
import LfoPanel from './LfoPanel'
import FxRack from './FxRack'
import ArpPanel from './ArpPanel'
import ClipPanel from './ClipPanel'
import GlobalPanel from './GlobalPanel'
import ScopeView from './ScopeView'
import KeyboardStrip from './KeyboardStrip'
import { MacrosBlock } from '@/components/apps/Apollo2'

export type ApolloCardScope =
  | 'all' | 'osc' | 'subnoise' | 'filters' | 'env' | 'lfo' | 'macros'
  | 'fx' | 'arp' | 'clip' | 'global'

export const APOLLO_CARD_SCOPES: { id: ApolloCardScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'osc', label: 'Oscillators' },
  { id: 'subnoise', label: 'Sub / Noise' },
  { id: 'filters', label: 'Filters' },
  { id: 'env', label: 'Envelopes' },
  { id: 'lfo', label: 'LFOs' },
  { id: 'macros', label: 'Macros' },
  { id: 'fx', label: 'Effects' },
  { id: 'arp', label: 'Arp' },
  { id: 'clip', label: 'Clips' },
  { id: 'global', label: 'Global' },
]

// The full-instrument layout: same packed spans as the standalone SOUND tab,
// with effects + performance rows beneath (the card body scrolls).
const ALL_LAYOUT: { id: ApolloCardScope | 'scope'; cols: number }[] = [
  { id: 'osc', cols: 7 }, { id: 'env', cols: 5 },
  { id: 'filters', cols: 7 }, { id: 'lfo', cols: 5 },
  { id: 'subnoise', cols: 5 }, { id: 'macros', cols: 3 }, { id: 'scope', cols: 4 },
  { id: 'fx', cols: 12 },
  { id: 'arp', cols: 5 }, { id: 'clip', cols: 7 },
  { id: 'global', cols: 12 },
]

function CardBody({ scope, footer }: { scope: ApolloCardScope; footer?: React.ReactNode }) {
  const ctx = useApollo()
  // inventories sized by use, like the standalone shell
  let envUsed = 1
  let lfoUsed = 1
  for (const r of ctx.patch.matrix) {
    const em = /^env([2-4])$/.exec(r.source)
    if (em) envUsed = Math.max(envUsed, Number(em[1]))
    const lm = /^lfo(\d+)y?$/.exec(r.source)
    if (lm) lfoUsed = Math.max(lfoUsed, Number(lm[1]))
  }
  const render = (id: ApolloCardScope | 'scope'): React.ReactNode => ({
    osc: <OscPanel />,
    subnoise: <SubNoisePanel />,
    filters: <FilterPanel />,
    env: <EnvPanel visible={envUsed} />,
    lfo: <Section title="LFO"><LfoPanel visible={lfoUsed} /></Section>,
    macros: <MacrosBlock />,
    scope: <ScopeView />,
    fx: <FxRack minimal />,
    arp: <ArpPanel />,
    clip: <ClipPanel />,
    global: <GlobalPanel />,
    all: null,
  } as Record<string, React.ReactNode>)[id]

  // Apollo's single-plate face: module chrome dissolves, header bars delineate
  const plate: React.CSSProperties = {
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    overflow: 'hidden',
    ['--ap-sec-bg' as string]: 'transparent',
    ['--ap-sec-border' as string]: 'transparent',
    ['--ap-sec-radius' as string]: '0px',
    ['--ap-sec-head-radius' as string]: '0px',
  } as React.CSSProperties
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {scope === 'all' ? (
        <div style={{
          ...plate,
          display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 0, alignItems: 'stretch',
        }}>
          {ALL_LAYOUT.map(m => (
            <div key={m.id} style={{
              gridColumn: `span ${m.cols}`, minWidth: 0,
              borderRight: `1px solid ${UI.border}`, borderBottom: `1px solid ${UI.border}`,
            }}>{render(m.id)}</div>
          ))}
        </div>
      ) : (
        <div style={plate}>{render(scope)}</div>
      )}
      {footer}
      <KeyboardStrip />
    </div>
  )
}

export default function ApolloCard({ patch, onChange, scope: initialScope = 'all', title, onClose, fxOnly = false, onParamMove, liveParams, headerExtra, footer }: {
  patch: ApolloPatch
  onChange: (p: ApolloPatch) => void
  scope?: ApolloCardScope
  title?: string
  onClose: () => void
  /** Track-chain hosting: lock the card to the Effects module (no scope tabs). */
  fxOnly?: boolean
  /** Motion recording: every knob move in the card is reported here. */
  onParamMove?: (path: string, value: number) => void
  /** Playback: values pushed in move the matching knobs on screen. */
  liveParams?: { path: string; value: number; stamp: number } | null
  /** Host controls rendered in the card header (record / loop / takes). */
  headerExtra?: React.ReactNode
  /** Host panel rendered at the foot of the card, above the keyboard — where
   *  Beacon puts the hosted track's own clip. */
  footer?: React.ReactNode
}) {
  const [scope, setScope] = useState<ApolloCardScope>(fxOnly ? 'fx' : initialScope)
  useEffect(() => {
    // Capture phase + stopPropagation: Esc closes ONLY the card — it must not
    // leak into the host's own Escape handling (the DAW deselects tracks on
    // Esc, which would also tear down the panel the card was opened from).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])
  // ── Floating window, not a modal ───────────────────────────────────────────
  // The card used to be a modal: a full-screen backdrop that dimmed Beacon,
  // swallowed clicks and closed on click-outside. That makes it impossible to
  // work on the track while the rack is open. It is now a window you can move
  // and resize, and only its own X (or Esc) closes it.
  const wideDefault = scope === 'all' || scope === 'fx' || scope === 'osc' || scope === 'clip'
  const [rect, setRect] = useState(() => {
    // The full instrument is a dense layout — twelve modules across twelve
    // columns. Sized to the viewport rather than a fixed 1280 so it does not
    // read as a small panel dropped into a large screen; a single-scope view
    // stays narrow because it has nothing to fill the width with.
    const vw = typeof window === 'undefined' ? 1400 : window.innerWidth
    const vh = typeof window === 'undefined' ? 900 : window.innerHeight
    const want = scope === 'all' ? Math.max(1280, Math.round(vw * 0.86)) : wideDefault ? 1280 : 760
    const w = Math.min(want, vw - 40)
    const h = Math.min(scope === 'all' ? 920 : 820, vh - 70)
    const x = Math.max(20, (vw - w) / 2)
    return { x, y: 44, w, h }
  })
  const dragRef = useRef<{ mode: string; sx: number; sy: number; r: typeof rect } | null>(null)

  const onDragPointer = useCallback((e: React.PointerEvent, mode: string) => {
    e.preventDefault()
    e.stopPropagation()
    // Capture is an optimisation, not a requirement — the move/up listeners are
    // on window. Some pointer sources (and synthetic events) throw here, and a
    // throw used to abort the drag before it started.
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* not capturable */ }
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, r: rect }
  }, [rect])

  useEffect(() => {
    const MIN_W = 380, MIN_H = 220
    function move(ev: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy
      const r = { ...d.r }
      if (d.mode === 'move') {
        r.x = d.r.x + dx
        r.y = d.r.y + dy
      } else {
        // MUST be an else: the edge tests below are substring checks, and the
        // word "move" contains an "e" — so a plain drag was also running the
        // east-resize branch and stretching the right edge as the window moved.
        // Edges and corners: dragging a left/top edge moves the origin as well
        // as resizing, so the opposite edge stays put.
        if (d.mode.includes('e')) r.w = Math.max(MIN_W, d.r.w + dx)
        if (d.mode.includes('s')) r.h = Math.max(MIN_H, d.r.h + dy)
        if (d.mode.includes('w')) { const w = Math.max(MIN_W, d.r.w - dx); r.x = d.r.x + (d.r.w - w); r.w = w }
        if (d.mode.includes('n')) { const h = Math.max(MIN_H, d.r.h - dy); r.y = d.r.y + (d.r.h - h); r.h = h }
      }
      // Keep a grab-able strip on screen so a window can always be recovered.
      r.x = Math.min(Math.max(r.x, 40 - r.w), window.innerWidth - 60)
      r.y = Math.min(Math.max(r.y, 0), window.innerHeight - 40)
      setRect(r)
    }
    function up() { dragRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  // The eight resize handles, drawn just outside the content edges.
  const GRAB = 7
  const handle = (mode: string, style: React.CSSProperties, cursor: string) => (
    <div
      key={mode}
      data-apollo-resize={mode}
      onPointerDown={e => onDragPointer(e, mode)}
      style={{ position: 'absolute', cursor, touchAction: 'none', zIndex: 10, ...style }}
    />
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      data-apollo-window
      style={{
        position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        zIndex: 500,
        background: 'var(--bg-card, #0a0c0f)',
        border: '1px solid var(--border, #262c35)',
        borderRadius: 14,
        boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      {/* Resize handles: every edge and corner, and every one of them INSIDE
          the frame. They used to straddle the border at -GRAB/2, but the window
          is overflow:hidden, so the outer half was clipped away and the only
          hittable part was the boundary pixel itself — resizing worked when a
          test dispatched events straight at the element and was near-impossible
          with an actual mouse. Sitting them inside costs the "grab just outside"
          affordance and buys a target you can actually hit. */}
      {handle('n',  { left: GRAB, right: GRAB, top: 0, height: GRAB }, 'ns-resize')}
      {handle('s',  { left: GRAB, right: GRAB, bottom: 0, height: GRAB }, 'ns-resize')}
      {handle('w',  { top: GRAB, bottom: GRAB, left: 0, width: GRAB }, 'ew-resize')}
      {handle('e',  { top: GRAB, bottom: GRAB, right: 0, width: GRAB }, 'ew-resize')}
      {handle('nw', { left: 0, top: 0, width: GRAB * 2, height: GRAB * 2 }, 'nwse-resize')}
      {handle('ne', { right: 0, top: 0, width: GRAB * 2, height: GRAB * 2 }, 'nesw-resize')}
      {handle('sw', { left: 0, bottom: 0, width: GRAB * 2, height: GRAB * 2 }, 'nesw-resize')}
      {handle('se', { right: 0, bottom: 0, width: GRAB * 2, height: GRAB * 2 }, 'nwse-resize')}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* chrome header — the host app's theme, not Apollo's. Doubles as the
            window's drag handle; clicks on its controls are left alone. */}
        <div
          data-apollo-titlebar
          onPointerDown={e => {
            const el = e.target as HTMLElement
            if (el.closest('button, input, select, textarea, a')) return
            onDragPointer(e, 'move')
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 14px', borderBottom: '1px solid var(--border, #262c35)',
            position: 'sticky', top: 0, background: 'var(--bg-card, #0a0c0f)', zIndex: 5, borderRadius: '14px 14px 0 0',
            cursor: 'grab', touchAction: 'none', userSelect: 'none',
          }}>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 3, color: 'var(--text-primary, #dbe1e8)' }}>
            APOLLO
            {title && <span style={{ fontWeight: 500, letterSpacing: 0.2, color: 'var(--text-muted, #8b93a0)', marginLeft: 10, fontSize: 12 }}>{title}</span>}
          </div>
          {headerExtra}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(fxOnly ? APOLLO_CARD_SCOPES.filter(sc => sc.id === 'fx') : APOLLO_CARD_SCOPES).map(s => (
              <button key={s.id} onClick={() => setScope(s.id)} style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                background: scope === s.id ? 'var(--accent, #4aa9ff)' : 'transparent',
                color: scope === s.id ? '#0b0d10' : 'var(--text-muted, #8b93a0)',
                border: `1px solid ${scope === s.id ? 'var(--accent, #4aa9ff)' : 'var(--border, #262c35)'}`,
              }}>{s.label}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} title="Close (Esc)" style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b93a0)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>✕</button>
        </div>
        <div style={{ padding: 12 }}>
          <ApolloProvider quickMod embed={{ patch, onChange }} onParamMove={onParamMove} liveParams={liveParams}>
            <CardBody scope={scope} footer={footer} />
          </ApolloProvider>
        </div>
      </div>
    </div>,
    document.body,
  )
}
