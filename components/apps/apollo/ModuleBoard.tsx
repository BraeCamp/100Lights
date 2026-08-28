'use client'
// The Apollo board — the face of the synth inside Beacon.
//
// One bar per module: its name, the knobs you reach for most, a switch, and an
// eye. Click a bar and its real panel unfolds beneath it. Open several and the
// bars close ranks into a continuous rack.
//
// ── Why it exists ──────────────────────────────────────────────────────────
//
// Measured on production before any of this was written: opening the old rack
// blocked the main thread for about 2.9 SECONDS — 3315, 2809 and 2886 ms over
// three consecutive opens — because it mounts eleven panels, nine canvases and
// 129 SVG nodes every single time. The cost repeated, so it was never bundle
// parse or engine boot; it was mounting.
//
// The board mounts rows of knobs and nothing else. A panel is a lazy import
// that does not exist until you open that module, and once opened it is KEPT
// MOUNTED behind the collapse — because mounting is the expensive part, and
// this interface is built around opening and closing things.

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApollo, Knob, UI, Section } from './ApolloContext'
import {
  APOLLO_MODULES, GROUP_LABEL, liveKnobs, moduleCanToggle, moduleIsOn,
  setModuleOn, shortLabel, type ApolloModuleDef, type ModuleGroup,
} from '@/lib/apollo/modules'
import { FX_DEFS } from '@/lib/apollo/patch'

// ── Panels, loaded only when a module is opened ─────────────────────────────
// Created at module scope: a React.lazy built during render is a different
// component every time, which remounts the panel on every keystroke.
const LazyOsc = React.lazy(() => import('./OscPanel'))
const LazySubNoise = React.lazy(() => import('./SubNoisePanel'))
const LazyFilter = React.lazy(() => import('./FilterPanel'))
const LazyEnv = React.lazy(() => import('./EnvPanel'))
const LazyLfo = React.lazy(() => import('./LfoPanel'))
const LazyFx = React.lazy(() => import('./FxRack'))
const LazyArp = React.lazy(() => import('./ArpPanel'))
const LazyClip = React.lazy(() => import('./ClipPanel'))
const LazyGlobal = React.lazy(() => import('./GlobalPanel'))
const LazyMacros = React.lazy(() => import('@/components/apps/Apollo2').then(m => ({ default: m.MacrosBlock })))
// Visuals are a separate lazy layer again — the eye is the only thing that
// ever mounts a canvas.
const LazyWavetableView = React.lazy(() => import('./WavetableView'))
const LazySampleView = React.lazy(() => import('./SampleView'))
const LazyGranularView = React.lazy(() => import('./GranularView'))
const LazySpectralView = React.lazy(() => import('./SpectralView'))
const LazyScope = React.lazy(() => import('./ScopeView'))

const HAIRLINE = 1

function Placeholder({ label }: { label: string }) {
  return (
    <div style={{
      padding: '18px 14px', fontSize: 11, color: UI.dim,
      fontFamily: 'inherit', letterSpacing: '.04em',
    }}>{label}…</div>
  )
}

/** The knobs on a bar. Collapsed it clips to one row; expanded it wraps. */
function KnobRow({ paths, def, allShown, onOverflow }: {
  paths: string[]
  def: ApolloModuleDef
  allShown: boolean
  onOverflow: (hasMore: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Whether anything is hidden is measured, not counted. Counting means
  // guessing knob widths and container padding and getting it wrong at every
  // breakpoint; the browser already knows.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => onOverflow(el.scrollWidth > el.clientWidth + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onOverflow, paths.length, allShown])

  return (
    <div
      ref={ref}
      data-knob-row
      style={{
        display: 'flex', gap: 10, flex: 1, minWidth: 0, alignItems: 'center',
        flexWrap: allShown ? 'wrap' : 'nowrap',
        overflow: allShown ? 'visible' : 'hidden',
        rowGap: allShown ? 10 : 0,
      }}
    >
      {paths.map(p => <Knob key={p} path={p} label={shortLabel(p, def)} size={30} />)}
    </div>
  )
}

/** FX knobs come from FX_DEFS rather than PARAM_MAP, so they carry their own
 *  ranges — the registry only holds the fixed instrument params. */
function FxKnobRow({ unitId, type, allShown, onOverflow }: {
  unitId: string; type: string; allShown: boolean; onOverflow: (b: boolean) => void
}) {
  const ctx = useApollo()
  const ref = useRef<HTMLDivElement>(null)
  const params = (FX_DEFS as Record<string, { params: { key: string; label: string; min: number; max: number; default: number; curve?: 'log' | 'lin' }[] }>)[type]?.params ?? []

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => onOverflow(el.scrollWidth > el.clientWidth + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onOverflow, params.length, allShown])

  const unit = ctx.patch.fxMain.find(u => u.id === unitId)
  return (
    <div
      ref={ref}
      data-knob-row
      style={{
        display: 'flex', gap: 10, flex: 1, minWidth: 0, alignItems: 'center',
        flexWrap: allShown ? 'wrap' : 'nowrap',
        overflow: allShown ? 'visible' : 'hidden',
        rowGap: allShown ? 10 : 0,
      }}
    >
      <Knob
        path={`fx.${unitId}.mix`} label="Mix" size={30} min={0} max={1} def={1}
        value={unit?.mix ?? 1}
        onChange={v => ctx.setParam(`fx.${unitId}.mix`, v)}
        onCommit={() => ctx.commit()}
      />
      {params.map(pp => (
        <Knob
          key={pp.key}
          path={`fx.${unitId}.${pp.key}`}
          label={pp.label}
          size={30}
          min={pp.min} max={pp.max} def={pp.default} log={pp.curve === 'log'}
          value={(unit?.params as Record<string, number> | undefined)?.[pp.key] ?? pp.default}
          onChange={v => ctx.setParam(`fx.${unitId}.${pp.key}`, v)}
          onCommit={() => ctx.commit()}
        />
      ))}
    </div>
  )
}

interface BarProps {
  id: string
  name: string
  blurb: string
  on: boolean
  canToggle: boolean
  hasVisual: boolean
  open: boolean
  joinedAbove: boolean
  joinedBelow: boolean
  onToggleOpen: () => void
  onToggleOn: () => void
  /** Given by the bar, because the bar owns the ALL/LESS state that decides
   *  whether the row wraps — an earlier version kept that state in the row and
   *  the button was wired to nothing. */
  renderKnobs: (allShown: boolean, onOverflow: (hasMore: boolean) => void) => React.ReactNode
  panel?: React.ReactNode             // mounted only once opened, kept after
  visual?: React.ReactNode
}

function Bar(props: BarProps) {
  const [showVisual, setShowVisual] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [allKnobs, setAllKnobs] = useState(false)

  // Bars that are open next to each other lose their shared edge and read as
  // one rack, which is what Brae asked for: "they connect to become a rack
  // when multiple items are selected".
  const radiusTop = props.joinedAbove ? 0 : 8
  const radiusBottom = props.joinedBelow ? 0 : 8

  const dim = !props.on
  return (
    <div style={{
      border: `${HAIRLINE}px solid ${UI.border}`,
      borderTopWidth: props.joinedAbove ? 0 : HAIRLINE,
      borderRadius: `${radiusTop}px ${radiusTop}px ${radiusBottom}px ${radiusBottom}px`,
      background: UI.panel,
      overflow: 'hidden',
    }}>
      {/* ── the bar ─────────────────────────────────────────────────────── */}
      <div
        data-module-bar={props.id}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '7px 10px',
          background: props.open ? UI.header : 'transparent',
        }}
      >
        <button
          onClick={props.onToggleOpen}
          title={props.blurb}
          aria-expanded={props.open}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            width: 132, flexShrink: 0, textAlign: 'left',
          }}
        >
          <span style={{
            fontSize: 9, color: UI.dim, width: 8, flexShrink: 0,
            transform: props.open ? 'rotate(90deg)' : 'none', transition: 'transform .16s ease',
          }}>▶</span>
          {/* The NAME keeps full contrast when the module is off — Brae:
              "grays out the module except for the name of the module". */}
          <span style={{
            fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em',
            color: UI.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{props.name}</span>
        </button>

        {/* Everything except the name dims when the module is switched off. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, opacity: dim ? 0.38 : 1, transition: 'opacity .16s ease' }}>
          {props.renderKnobs(allKnobs, setHasMore)}
        </div>

        {hasMore || allKnobs ? (
          <button
            onClick={() => setAllKnobs(v => !v)}
            title={allKnobs ? 'Show fewer knobs' : 'Show every knob on this bar'}
            style={{
              flexShrink: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em',
              padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${UI.border}`, color: UI.dim,
            }}
          >{allKnobs ? 'LESS' : 'ALL'}</button>
        ) : null}

        {props.hasVisual && (
          <button
            onClick={() => setShowVisual(v => !v)}
            title={showVisual ? 'Hide the visual' : 'Watch this module'}
            aria-pressed={showVisual}
            style={{
              flexShrink: 0, fontSize: 11, lineHeight: 1, padding: '4px 6px', borderRadius: 5,
              cursor: 'pointer', background: 'transparent',
              border: `1px solid ${showVisual ? UI.blue : UI.border}`,
              color: showVisual ? UI.blue : UI.dim,
            }}
          >◉</button>
        )}

        {props.canToggle ? (
          <button
            onClick={props.onToggleOn}
            title={props.on ? `Switch ${props.name} off` : `Switch ${props.name} on`}
            aria-pressed={props.on}
            style={{
              flexShrink: 0, width: 30, height: 17, borderRadius: 999, cursor: 'pointer',
              padding: 0, position: 'relative',
              background: props.on ? UI.blue : 'transparent',
              border: `1px solid ${props.on ? UI.blue : UI.border}`,
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: props.on ? 15 : 2,
              width: 11, height: 11, borderRadius: 999,
              background: props.on ? '#fff' : UI.dim,
              transition: 'left .14s ease',
            }} />
          </button>
        ) : (
          // Say why there is no switch rather than leaving a hole in the row.
          <span title="This module cannot be switched off yet" style={{ flexShrink: 0, width: 30, textAlign: 'center', fontSize: 9, color: UI.dim, opacity: .5 }}>—</span>
        )}
      </div>

      {/* ── the eye's visual ────────────────────────────────────────────── */}
      {showVisual && props.visual && (
        <div style={{ borderTop: `${HAIRLINE}px solid ${UI.border}`, padding: 8 }}>
          <Suspense fallback={<Placeholder label="Loading the view" />}>{props.visual}</Suspense>
        </div>
      )}

      {/* ── the panel ───────────────────────────────────────────────────────
          Rendered whenever it has EVER been opened, hidden when collapsed.
          Unmounting here would re-pay the mount cost this whole design exists
          to avoid, and this is an interface built around opening and closing. */}
      {props.panel !== undefined && (
        <div style={{
          display: props.open ? 'block' : 'none',
          borderTop: `${HAIRLINE}px solid ${UI.border}`,
        }}>
          <Suspense fallback={<Placeholder label={`Loading ${props.name}`} />}>{props.panel}</Suspense>
        </div>
      )}
    </div>
  )
}

/** How many panels stay mounted after being collapsed. Enough that moving
 *  between a few modules is free; small enough that a long session does not
 *  end up with every panel alive. */
const KEEP_ALIVE = 5

export default function ModuleBoard() {
  const ctx = useApollo()
  const [open, setOpen] = useState<string[]>([])
  const [mounted, setMounted] = useState<string[]>([])

  const toggleOpen = useCallback((id: string) => {
    setOpen(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
    setMounted(prev => {
      const next = [id, ...prev.filter(x => x !== id)]
      return next.slice(0, KEEP_ALIVE)
    })
  }, [])

  // Inventories sized by what the patch actually uses, same rule the old rack
  // used — an unused envelope is not worth a panel.
  const { envUsed, lfoUsed } = useMemo(() => {
    let e = 1, l = 1
    for (const r of ctx.patch.matrix) {
      const em = /^env([2-4])$/.exec(r.source); if (em) e = Math.max(e, Number(em[1]))
      const lm = /^lfo(\d+)y?$/.exec(r.source); if (lm) l = Math.max(l, Number(lm[1]))
    }
    return { envUsed: e, lfoUsed: l }
  }, [ctx.patch.matrix])

  const panelFor = useCallback((id: string): React.ReactNode => {
    switch (id) {
      case 'osc': return <LazyOsc />
      case 'subnoise': return <LazySubNoise />
      case 'filters': return <LazyFilter />
      case 'env': return <LazyEnv visible={envUsed} />
      case 'lfo': return <Section title="LFO"><LazyLfo visible={lfoUsed} /></Section>
      case 'macros': return <LazyMacros />
      case 'arp': return <LazyArp />
      case 'clip': return <LazyClip />
      case 'global': return <LazyGlobal />
      default: return id.startsWith('fx:') ? <LazyFx minimal /> : null
    }
  }, [envUsed, lfoUsed])

  const visualFor = useCallback((id: string): React.ReactNode => {
    if (id === 'clip') return <LazyScope />
    if (id !== 'osc') return null
    // The oscillator's picture depends on which engine it is running.
    const eng = ctx.patch.oscs[0]?.engine
    if (eng === 'sample' || eng === 'multisample') return <LazySampleView />
    if (eng === 'granular') return <LazyGranularView />
    if (eng === 'spectral') return <LazySpectralView />
    return <LazyWavetableView />
  }, [ctx.patch.oscs])

  // FX units are modules too — Brae: "add new effects like compressors and
  // allow each to be toggled on or off from the Apollo board". Each unit gets
  // its own bar and its own switch; expanding any of them opens the rack.
  const fxModules: ApolloModuleDef[] = useMemo(() => ctx.patch.fxMain.map(u => ({
    id: `fx:${u.id}`,
    name: (FX_DEFS as Record<string, { label: string }>)[u.type]?.label ?? u.type,
    group: 'effects' as ModuleGroup,
    knobs: [],
    enablePaths: [],
    hasVisual: false,
    blurb: `${(FX_DEFS as Record<string, { label: string }>)[u.type]?.label ?? u.type} — an effect on the main lane.`,
  })), [ctx.patch.fxMain])

  const groups: ModuleGroup[] = ['voice', 'modulation', 'effects', 'performance']
  const inGroup = (g: ModuleGroup) =>
    g === 'effects'
      ? fxModules
      : APOLLO_MODULES.filter(m => m.group === g)

  return (
    <div data-apollo-board style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map(g => {
        const mods = inGroup(g)
        if (!mods.length) return null
        return (
          <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{
              fontSize: 8.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase',
              color: UI.dim, padding: '0 2px 6px',
            }}>{GROUP_LABEL[g]}</div>

            {mods.map((m, i) => {
              const isFx = m.id.startsWith('fx:')
              const unitId = isFx ? m.id.slice(3) : ''
              const unit = isFx ? ctx.patch.fxMain.find(u => u.id === unitId) : undefined
              const on = isFx ? !!unit?.enabled : moduleIsOn(ctx.patch, m)
              const canToggle = isFx ? true : moduleCanToggle(m)
              const isOpen = open.includes(m.id)
              // A bar joins the one above when BOTH are open — that is what
              // turns a set of bars into a rack.
              const prev = mods[i - 1], next = mods[i + 1]
              const joinedAbove = !!prev && isOpen && open.includes(prev.id)
              const joinedBelow = !!next && isOpen && open.includes(next.id)

              return (
                <div key={m.id} style={{ marginTop: i === 0 ? 0 : (joinedAbove ? 0 : 6) }}>
                  <Bar
                    id={m.id}
                    name={m.name}
                    blurb={m.blurb}
                    on={on}
                    canToggle={canToggle}
                    hasVisual={m.hasVisual}
                    open={isOpen}
                    joinedAbove={joinedAbove}
                    joinedBelow={joinedBelow}
                    onToggleOpen={() => toggleOpen(m.id)}
                    onToggleOn={() => {
                      if (isFx) {
                        ctx.update(p => {
                          const u = p.fxMain.find(x => x.id === unitId)
                          if (u) u.enabled = !u.enabled
                        })
                      } else {
                        ctx.update(p => setModuleOn(p, m, !moduleIsOn(p, m)))
                      }
                    }}
                    panel={mounted.includes(m.id) ? panelFor(m.id) : undefined}
                    visual={m.hasVisual ? visualFor(m.id) : undefined}
                    renderKnobs={(allShown, onOverflow) => (
                      isFx
                        ? <FxKnobRow unitId={unitId} type={unit?.type ?? ''} allShown={allShown} onOverflow={onOverflow} />
                        : liveKnobs(m).length
                          ? <KnobRow paths={liveKnobs(m)} def={m} allShown={allShown} onOverflow={onOverflow} />
                          : <span style={{ fontSize: 10, color: UI.dim, opacity: .6 }}>Open to edit</span>
                    )}
                  />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
