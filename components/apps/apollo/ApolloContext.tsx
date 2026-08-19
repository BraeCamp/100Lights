'use client'
// Apollo shared UI state: patch + engine access, param plumbing, mod drag-drop,
// and the shared control atoms (Knob, Sel, Section, ToggleBtn).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApolloPatch, ModSource, ModRoute, PARAM_MAP, initPatch, getByPath, setByPath,
  resolvePatchPath, uid,
} from '@/lib/apollo/patch'
import { ApolloEngine, ApolloMeters, getApolloEngine } from '@/lib/apollo/engine-client'

export interface ApolloCtxValue {
  patch: ApolloPatch
  version: number
  engine: ApolloEngine
  started: boolean
  start: () => Promise<void>
  /** Structural change: mutate draft, re-render, full patch resent to engine. */
  update: (fn: (p: ApolloPatch) => void) => void
  /** Continuous change (knob drag): in-place + engine fast path, no global re-render. */
  setParam: (path: string, value: number) => void
  /** Call at end of a continuous gesture to consolidate into the engine patch. */
  commit: () => void
  selectedOsc: number
  setSelectedOsc: (i: number) => void
  modSource: ModSource | null
  setModSource: (s: ModSource | null) => void
  /** Synchronous read of the in-flight drag source (state can lag native drag events). */
  getModSource: () => ModSource | null
  assignMod: (dest: string) => void
  routesFor: (dest: string) => ModRoute[]
  undo: () => void
  redo: () => void
}

const Ctx = createContext<ApolloCtxValue | null>(null)

export function useApollo(): ApolloCtxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApollo outside ApolloProvider')
  return v
}

export function useMeters(): ApolloMeters {
  const { engine } = useApollo()
  const [m, setM] = useState<ApolloMeters>(engine.meters)
  useEffect(() => {
    let raf = 0
    let latest = engine.meters
    const onMeters = (e: Event) => {
      latest = (e as CustomEvent).detail as ApolloMeters
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setM(latest) })
    }
    engine.addEventListener('meters', onMeters)
    return () => { engine.removeEventListener('meters', onMeters); if (raf) cancelAnimationFrame(raf) }
  }, [engine])
  return m
}

const LS_KEY = 'apollo_current_patch_v1'

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const engine = useMemo(() => getApolloEngine(), [])
  const patchRef = useRef<ApolloPatch | null>(null)
  if (!patchRef.current) patchRef.current = initPatch()
  const [version, setVersion] = useState(0)
  // restore the autosaved patch after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        patchRef.current = { ...initPatch(), ...JSON.parse(raw) } as ApolloPatch
        setVersion(v => v + 1)
      }
    } catch { /* corrupt save, start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [started, setStarted] = useState(false)
  const [selectedOsc, setSelectedOsc] = useState(0)
  const [modSource, _setModSource] = useState<ModSource | null>(null)
  const modSourceRef = useRef<ModSource | null>(null)
  const setModSource = useCallback((s: ModSource | null) => { modSourceRef.current = s; _setModSource(s) }, [])
  const getModSource = useCallback(() => modSourceRef.current, [])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(patchRef.current)) } catch { /* quota */ }
    }, 800)
  }, [])

  const start = useCallback(async () => {
    if (engine.ready) { engine.resume(); setStarted(true); return }
    await engine.init()
    engine.sendPatch(patchRef.current as ApolloPatch)
    setStarted(true)
  }, [engine])

  // undo/redo: snapshots of the patch JSON, captured before each change
  const history = useRef<string[]>([])
  const future = useRef<string[]>([])
  const gestureSnap = useRef<string | null>(null)

  const pushHistory = useCallback((snap: string) => {
    history.current.push(snap)
    if (history.current.length > 60) history.current.shift()
    future.current = []
  }, [])

  const applySnapshot = useCallback((json: string) => {
    try {
      patchRef.current = { ...initPatch(), ...JSON.parse(json) } as ApolloPatch
    } catch { return }
    if (engine.ready) engine.sendPatch(patchRef.current)
    persist()
    setVersion(v => v + 1)
  }, [engine, persist])

  const undo = useCallback(() => {
    const snap = history.current.pop()
    if (snap == null) return
    future.current.push(JSON.stringify(patchRef.current))
    applySnapshot(snap)
  }, [applySnapshot])

  const redo = useCallback(() => {
    const snap = future.current.pop()
    if (snap == null) return
    history.current.push(JSON.stringify(patchRef.current))
    applySnapshot(snap)
  }, [applySnapshot])

  const update = useCallback((fn: (p: ApolloPatch) => void) => {
    const p = patchRef.current as ApolloPatch
    pushHistory(JSON.stringify(p))
    fn(p)
    if (engine.ready) engine.sendPatch(p)
    persist()
    setVersion(v => v + 1)
  }, [engine, persist, pushHistory])

  const setParam = useCallback((path: string, value: number) => {
    const p = patchRef.current as ApolloPatch
    if (gestureSnap.current == null) gestureSnap.current = JSON.stringify(p)
    setByPath(p, resolvePatchPath(path), value)
    if (engine.ready) engine.setParam(path, value)
    persist()
  }, [engine, persist])

  const commit = useCallback(() => {
    if (gestureSnap.current != null) { pushHistory(gestureSnap.current); gestureSnap.current = null }
    if (engine.ready) engine.sendPatch(patchRef.current as ApolloPatch)
    persist()
    setVersion(v => v + 1)
  }, [engine, persist, pushHistory])

  const assignMod = useCallback((dest: string) => {
    const src = modSourceRef.current
    if (!src) return
    setModSource(null)
    update(p => {
      const existing = p.matrix.find(r => r.source === src && r.dest === dest)
      if (existing) return
      p.matrix.push({ id: uid(), source: src, dest, amount: 0.3, bipolar: false, aux: 'none', auxAmount: 0, curve: null, bypass: false })
    })
  }, [modSource, update])

  const routesFor = useCallback((dest: string): ModRoute[] => {
    return (patchRef.current as ApolloPatch).matrix.filter(r => r.dest === dest && !r.bypass)
  }, [])

  // programmatic hook for automation/tests (same convention as __dawDispatch)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__apolloEngine = engine
    w.__apolloStart = start
    w.__apolloUpdate = update
    w.__apolloPatch = () => patchRef.current
    return () => {
      delete w.__apolloEngine; delete w.__apolloStart; delete w.__apolloUpdate; delete w.__apolloPatch
    }
  }, [engine, start, update])

  const value = useMemo<ApolloCtxValue>(() => ({
    patch: patchRef.current as ApolloPatch,
    version, engine, started, start, update, setParam, commit,
    selectedOsc, setSelectedOsc, modSource, setModSource, getModSource, assignMod, routesFor, undo, redo,
  }), [version, engine, started, start, update, setParam, commit, selectedOsc, modSource, setModSource, getModSource, assignMod, routesFor, undo, redo])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ---------------------------------------------------------------------------
// Shared atoms — Serum-2-style palette

export const UI = {
  bg: '#0a0c0f',
  panel: '#12151a',
  header: '#1a1f26',
  inset: '#0d1013',
  border: '#262c35',
  borderLight: '#333a45',
  green: '#8ee67e',
  greenDim: '#4f8f47',
  yellow: '#ffd75e',
  blue: '#4aa9ff',
  blueDim: '#2c6db0',
  text: '#dbe1e8',
  dim: '#8b93a0',
}

export function Section({ title, right, led, children, style }: { title: string; right?: React.ReactNode; led?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: `linear-gradient(180deg, ${UI.panel} 0%, #0f1216 100%)`,
      border: `1px solid ${UI.border}`, borderRadius: 8, overflow: 'visible',
      display: 'flex', flexDirection: 'column', minWidth: 0,
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', ...style,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: `linear-gradient(180deg, ${UI.header} 0%, #14181e 100%)`,
        borderBottom: `1px solid ${UI.border}`, borderRadius: '7px 7px 0 0',
        padding: '5px 9px', minHeight: 26,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {led != null && <span style={{ width: 7, height: 7, borderRadius: '50%', background: led ? UI.green : '#3a404a', boxShadow: led ? `0 0 5px ${UI.green}` : 'none', display: 'inline-block' }} />}
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: UI.text, textTransform: 'uppercase', fontStretch: 'condensed' }}>{title}</div>
        </div>
        {right}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 9 }}>
        {children}
      </div>
    </div>
  )
}

export function Sel({ value, options, onChange, width, title }: {
  value: string
  options: { value: string; label: string; group?: string }[]
  onChange: (v: string) => void
  width?: number | string
  title?: string
}) {
  const groups = new Map<string, { value: string; label: string }[]>()
  let hasGroups = false
  for (const o of options) {
    const g = o.group || ''
    if (g) hasGroups = true
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(o)
  }
  const selStyle: React.CSSProperties = {
    background: `linear-gradient(180deg, #1c212a 0%, #14181e 100%)`, color: UI.text, border: `1px solid ${UI.border}`,
    borderRadius: 5, padding: '3px 6px', fontSize: 10.5, fontWeight: 600, width: width || '100%', minWidth: 0, cursor: 'pointer',
  }
  return (
    <select value={value} title={title} onChange={e => onChange(e.target.value)} style={selStyle}>
      {hasGroups
        ? [...groups.entries()].map(([g, opts]) => (
          <optgroup key={g || '_'} label={g}>
            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))
        : options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function ToggleBtn({ on, label, onClick, title, accent }: { on: boolean; label: string; onClick: () => void; title?: string; accent?: string }) {
  const ac = accent || UI.blue
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: on ? `linear-gradient(180deg, ${ac} 0%, ${ac}cc 100%)` : `linear-gradient(180deg, #1c212a 0%, #14181e 100%)`,
        color: on ? '#0b0d10' : UI.dim,
        border: '1px solid ' + (on ? ac : UI.border),
        borderRadius: 5, padding: '3px 9px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer',
        whiteSpace: 'nowrap', letterSpacing: 0.6, textTransform: 'uppercase',
        transition: 'background 120ms, color 120ms, border-color 120ms',
        boxShadow: on ? `0 0 8px ${ac}44` : 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >{label}</button>
  )
}

// ---------------------------------------------------------------------------
// Knob: modulatable rotary control. If `path` is given it reads/writes the
// patch param at that path, accepts mod-source drops, and shows a mod ring.

export interface KnobProps {
  path?: string
  value?: number
  min?: number
  max?: number
  def?: number
  label: string
  size?: number
  color?: string
  format?: (v: number) => string
  onChange?: (v: number) => void
  onCommit?: () => void
  bipolar?: boolean
  log?: boolean
}

export function Knob(props: KnobProps) {
  const ctx = useContext(Ctx)
  const def = props.path ? PARAM_MAP[props.path] : undefined
  const min = props.min ?? def?.min ?? 0
  const max = props.max ?? def?.max ?? 1
  const defaultValue = props.def ?? def?.default ?? min
  const log = props.log ?? def?.curve === 'log'
  const size = props.size ?? 40
  const readValue = useCallback((): number => {
    if (props.value != null) return props.value
    if (props.path && ctx) {
      const v = getByPath(ctx.patch, resolvePatchPath(props.path))
      if (typeof v === 'number') return v
    }
    return defaultValue
  }, [props.value, props.path, ctx, defaultValue])
  const [val, setVal] = useState(readValue)
  const [dragOver, setDragOver] = useState(false)
  const dragRef = useRef<{ y: number; v: number } | null>(null)
  useEffect(() => { setVal(readValue()) }, [readValue, ctx?.version])

  const apply = (v: number) => {
    const cl = Math.min(max, Math.max(min, v))
    setVal(cl)
    if (props.path && ctx) ctx.setParam(props.path, cl)
    props.onChange?.(cl)
  }

  const toNorm = (v: number) => {
    if (log && min > 0) return Math.log(v / min) / Math.log(max / min)
    return (v - min) / (max - min)
  }
  const fromNorm = (t: number) => {
    if (log && min > 0) return min * Math.pow(max / min, t)
    return min + (max - min) * t
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { y: e.clientY, v: toNorm(val) }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dy = dragRef.current.y - e.clientY
    const fine = e.shiftKey ? 0.25 : 1
    apply(fromNorm(Math.min(1, Math.max(0, dragRef.current.v + dy / 150 * fine))))
  }
  const onPointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    if (props.path && ctx) ctx.commit()
    props.onCommit?.()
  }

  const norm = toNorm(val)
  const a0 = -135, sweep = 270
  const angle = a0 + norm * sweep
  const r = size / 2 - 3
  const cx = size / 2, cy = size / 2
  const arc = (from: number, to: number, radius: number) => {
    const s = ((from - 90) * Math.PI) / 180, en = ((to - 90) * Math.PI) / 180
    const x1 = cx + radius * Math.cos(s), y1 = cy + radius * Math.sin(s)
    const x2 = cx + radius * Math.cos(en), y2 = cy + radius * Math.sin(en)
    const large = to - from > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`
  }
  const routes = props.path && ctx ? ctx.routesFor(props.path) : []
  const modAmt = routes.length ? routes[0].amount : 0
  const modTo = Math.min(1, Math.max(0, norm + modAmt))
  const droppable = !!props.path && !!ctx
  const fmt = props.format || def?.unit === 'ct' || def?.unit === 'st'
    ? (v: number) => `${v.toFixed(def?.unit === 'ct' ? 0 : 1)}${def?.unit || ''}`
    : (v: number) => (max - min > 20 ? v.toFixed(0) : v.toFixed(2))
  const fmtFn = props.format || fmt

  return (
    <div
      onDragOver={droppable ? (e => { if (ctx!.getModSource()) { e.preventDefault(); setDragOver(true) } }) : undefined}
      onDragLeave={() => setDragOver(false)}
      onDrop={droppable ? (e => { e.preventDefault(); setDragOver(false); if (ctx!.getModSource()) ctx!.assignMod(props.path!) }) : undefined}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: size + 14, userSelect: 'none' }}
      title={props.path ? `${props.label} — drag to change, double-click to reset${routes.length ? `, mod: ${routes.map(r2 => r2.source).join(',')}` : ''}` : props.label}
    >
      <svg
        width={size} height={size}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onDoubleClick={() => { apply(defaultValue); if (props.path && ctx) ctx.commit(); props.onCommit?.() }}
        style={{ cursor: 'ns-resize', touchAction: 'none', outline: dragOver ? `2px solid ${UI.blue}` : 'none', borderRadius: '50%' }}
      >
        <defs>
          <radialGradient id="apKnobBody" cx="38%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#333b47" />
            <stop offset="55%" stopColor="#20252d" />
            <stop offset="100%" stopColor="#12151a" />
          </radialGradient>
        </defs>
        {/* track */}
        <path d={arc(a0, a0 + sweep, r)} stroke="#1c2129" strokeWidth={3} fill="none" strokeLinecap="round" />
        {/* value arc */}
        {props.bipolar
          ? <path d={norm >= 0.5 ? arc(0, a0 + norm * sweep, r) : arc(a0 + norm * sweep, 0, r)} stroke={props.color || UI.blue} strokeWidth={3} fill="none" strokeLinecap="round" />
          : <path d={arc(a0, a0 + norm * sweep, r)} stroke={props.color || UI.blue} strokeWidth={3} fill="none" strokeLinecap="round" />}
        {/* mod range arc */}
        {routes.length > 0 && (
          <path
            d={modTo >= norm ? arc(a0 + norm * sweep, a0 + modTo * sweep, r) : arc(a0 + modTo * sweep, a0 + norm * sweep, r)}
            stroke={UI.green} strokeWidth={1.8} fill="none" strokeLinecap="round" opacity={0.95}
          />
        )}
        {/* metallic body */}
        <circle cx={cx} cy={cy} r={r - 4.5} fill="url(#apKnobBody)" stroke="#0a0c0f" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={r - 4.5} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.8} />
        {/* needle */}
        <line
          x1={cx + (r - 12) * Math.cos(((angle - 90) * Math.PI) / 180) * 0.25}
          y1={cy + (r - 12) * Math.sin(((angle - 90) * Math.PI) / 180) * 0.25}
          x2={cx + (r - 7) * Math.cos(((angle - 90) * Math.PI) / 180)}
          y2={cy + (r - 7) * Math.sin(((angle - 90) * Math.PI) / 180)}
          stroke="#e8edf3" strokeWidth={1.8} strokeLinecap="round"
        />
        {/* mod source dot (Serum-style attachment indicator) */}
        {routes.length > 0 && <circle cx={size - 5} cy={5} r={3} fill={UI.green} opacity={0.9} />}
      </svg>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: UI.dim, whiteSpace: 'nowrap', maxWidth: size + 20, overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.label}</div>
      <div style={{ fontSize: 8.5, color: UI.text, fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>{fmtFn(val)}</div>
    </div>
  )
}

// Draggable mod-source chip: drag onto any Knob with a path to create a route.
export function SourceChip({ source, label, active }: { source: ModSource; label: string; active?: boolean }) {
  const ctx = useApollo()
  return (
    <div
      draggable
      onDragStart={e => { ctx.setModSource(source); e.dataTransfer.setData('text/plain', source) }}
      onDragEnd={() => ctx.setModSource(null)}
      style={{
        padding: '2px 7px', borderRadius: 10, fontSize: 9, fontWeight: 700, cursor: 'grab',
        background: active ? 'var(--accent-subtle, rgba(61,143,239,.2))' : 'var(--bg-surface)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
        color: active ? 'var(--accent)' : 'var(--text-secondary)', userSelect: 'none', whiteSpace: 'nowrap',
      }}
      title={`Drag onto a knob to modulate it with ${label}`}
    >{label}</div>
  )
}
