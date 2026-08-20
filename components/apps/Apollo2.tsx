'use client'
// Apollo — the merged shell (/apollo). Formerly the /apollo2 experiment; now
// the one UI. Flat theme, three tabs, and every module always visible as a
// RESIZABLE panel (drag its right edge for width, bottom edge for height,
// corner for both — sizes persist), so the space fills the way you want.
//
// Kept from the experiment: bare "+" inventories (envelopes / LFOs / macros /
// FX busses grow as used), knob-hover ⊕ quick-mod, Movement drawer, keyboard
// HOLD latch + 📌 pin, /apollo/new. Changed on Brae's direction: collapsed
// chain segments are gone (modules are plain panels again), knobs are flat
// solid color, File ▾ gathers Export/Import/Bounce/Share, and Random/Mutate
// live as 🎲 dice on the modules they affect.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ApolloProvider, useApollo, useMeters, Knob, UI, Section, ToggleBtn } from '@/components/apps/apollo/ApolloContext'
import PresetBar from '@/components/apps/apollo/PresetBar'
import OscPanel from '@/components/apps/apollo/OscPanel'
import SubNoisePanel from '@/components/apps/apollo/SubNoisePanel'
import FilterPanel from '@/components/apps/apollo/FilterPanel'
import EnvPanel from '@/components/apps/apollo/EnvPanel'
import LfoPanel from '@/components/apps/apollo/LfoPanel'
import ModMatrixPanel from '@/components/apps/apollo/ModMatrixPanel'
import ModSourcesStrip from '@/components/apps/apollo/ModSourcesStrip'
import FxRack from '@/components/apps/apollo/FxRack'
import ArpPanel from '@/components/apps/apollo/ArpPanel'
import ClipPanel from '@/components/apps/apollo/ClipPanel'
import GlobalPanel from '@/components/apps/apollo/GlobalPanel'
import KeyboardStrip from '@/components/apps/apollo/KeyboardStrip'
import WavetableEditor from '@/components/apps/apollo/WavetableEditor'
import ScopeView from '@/components/apps/apollo/ScopeView'
import LearnMode from '@/components/apps/apollo/LearnMode'
import HelpButton from '@/components/apps/apollo/HelpButton'
import { startWebMidi, onMidiNote, webMidiSupported, getMidiDeviceNames } from '@/lib/web-midi'
import { startMpe, stopMpe } from '@/lib/apollo/mpe'
import { initPatch, type ApolloPatch } from '@/lib/apollo/patch'
import {
  type SessionMeta, WORKING_COPY_KEY, newSessionId, getCurrent, setCurrent,
  localPut, saveSession, loadSession, listSessions, renameSession, deleteSession,
} from '@/lib/apollo/sessions'

type Tab = 'sound' | 'effects' | 'perform'
const TABS: { id: Tab; label: string }[] = [
  { id: 'sound', label: 'SOUND' }, { id: 'effects', label: 'EFFECTS' }, { id: 'perform', label: 'PERFORM' },
]

// ── Dense module grid (Serum-style packing) ─────────────────────────────────
// Modules live on a 12-column grid with dense auto-flow: widths are FRACTIONS
// of the window (so everything always fills edge-to-edge and scales with the
// viewport), heights are auto-measured into row units (so rows pack with no
// holes). Drag the ⠿ grip on a module's title bar to move it; drag the right
// edge for width, the corner to scale width AND height by the same ratio
// (shape preserved); double-click a handle resets. Order + spans persist.
const GRID_COLS = 12
const ROW_UNIT = 8   // px per grid row
const GAP = 0        // modules SHARE edges (Serum-style): seams, not gutters
const LAYOUT_KEY = 'apollo_layout_grid_v1'

interface ModSpec { id: string; cols: number; rows: number | null } // rows null = auto (content height)
type GridLayout = Record<string, ModSpec[]> // per tab

function loadLayout(): GridLayout {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') as GridLayout } catch { return {} }
}
function saveLayout(all: GridLayout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(all)) } catch { /* quota */ }
}

const dragMod = { id: null as string | null }

function Module({ spec, onSpan, onDropBefore, children }: {
  spec: ModSpec
  onSpan: (cols: number, rows: number | null) => void
  onDropBefore: (draggedId: string) => void
  children: React.ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [autoRows, setAutoRows] = useState(12)
  const [dragOver, setDragOver] = useState(false)
  const resizeRef = useRef<{ mode: 'w' | 'wh' | 'h'; x: number; y: number; cols: number; rows: number } | null>(null)

  // Content height is ALWAYS measured (even with a manual row span): it is the
  // hard floor for the module's height, so a module can never be dragged short
  // enough to need internal scrolling — content shows in full, period.
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight
      const rows = Math.max(6, Math.ceil((h + GAP) / (ROW_UNIT + GAP)))
      setAutoRows(r => (r === rows ? r : rows))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = Math.max(spec.rows ?? 0, autoRows)
  const colPx = () => {
    const parent = boxRef.current?.parentElement
    if (!parent) return 100
    return (parent.clientWidth - GAP * (GRID_COLS - 1)) / GRID_COLS
  }

  const startResize = (mode: 'w' | 'wh' | 'h') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { mode, x: e.clientX, y: e.clientY, cols: spec.cols, rows }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic */ }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const d = resizeRef.current
    if (!d) return
    if (e.buttons === 0) { resizeRef.current = null; return }
    const dCols = Math.round((e.clientX - d.x) / (colPx() + GAP))
    const newCols = Math.min(GRID_COLS, Math.max(2, d.cols + dCols))
    if (d.mode === 'w') {
      if (newCols !== spec.cols) onSpan(newCols, spec.rows)
    } else if (d.mode === 'wh') {
      // corner: scale height by the SAME ratio as width — shape preserved
      const ratio = newCols / d.cols
      const newRows = Math.max(6, Math.round(d.rows * ratio))
      if (newCols !== spec.cols || newRows !== spec.rows) onSpan(newCols, newRows)
    } else {
      const dRows = Math.round((e.clientY - d.y) / (ROW_UNIT + GAP))
      const newRows = Math.max(6, d.rows + dRows)
      if (newRows !== spec.rows) onSpan(spec.cols, newRows)
    }
  }
  const endResize = () => { resizeRef.current = null }
  const handle = (mode: 'w' | 'wh' | 'h', style: React.CSSProperties) => (
    <div
      key={mode}
      onPointerDown={startResize(mode)}
      onPointerMove={onResizeMove}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      onDoubleClick={() => onSpan(spec.cols, null)}
      title="Drag to resize (corner keeps the shape · double-click = auto height)"
      style={{ position: 'absolute', zIndex: 6, touchAction: 'none', ...style }}
    />
  )

  return (
    <div
      ref={boxRef}
      onDragOver={e => { if (dragMod.id && dragMod.id !== spec.id) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (dragMod.id && dragMod.id !== spec.id) onDropBefore(dragMod.id)
      }}
      style={{
        position: 'relative',
        gridColumn: `span ${spec.cols}`,
        gridRow: `span ${rows}`,
        minWidth: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'visible',
        outline: dragOver ? `2px solid ${UI.blue}` : 'none',
        // shared seams: only right + bottom, so adjacent modules split one line
        borderRight: `1px solid ${UI.border}`,
        borderBottom: `1px solid ${UI.border}`,
        ['--ap-grip-pad' as string]: '13px',
      } as React.CSSProperties}
    >
      {/* ⠿ move grip — title-bar left, above the Section header */}
      <span
        draggable
        onDragStart={e => { dragMod.id = spec.id; e.dataTransfer.setData('text/plain', spec.id) }}
        onDragEnd={() => { dragMod.id = null }}
        title="Drag to move this module"
        style={{
          position: 'absolute', top: 7, left: 7, zIndex: 6, cursor: 'grab',
          color: UI.dim, fontSize: 10, lineHeight: 1, userSelect: 'none', padding: '1px 2px',
        }}
      >⠿</span>
      <div ref={innerRef} style={{ display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      {handle('w', { top: 0, bottom: 0, right: -4, width: 8, cursor: 'ew-resize' })}
      {handle('h', { left: 0, right: 0, bottom: -4, height: 8, cursor: 'ns-resize' })}
      {handle('wh', { right: -4, bottom: -4, width: 14, height: 14, cursor: 'nwse-resize' })}
    </div>
  )
}

// ── Macros: only named knobs exist; "+" names a new one ─────────────────────
export function MacrosBlock() {
  const ctx = useApollo()
  const named = ctx.patch.macroNames.map((name, i) => ({ name, i })).filter(m => m.name && m.name !== `Macro ${m.i + 1}`)
  const free = ctx.patch.macroNames.findIndex((n, i) => !n || n === `Macro ${i + 1}`)
  return (
    <Section title="Knobs">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {named.map(m => (
          <Knob
            key={m.i}
            label={m.name}
            size={42}
            min={0} max={1} def={0}
            value={ctx.patch.macros[m.i]}
            onChange={v => { ctx.setParam(`macro${m.i + 1}`, v); ctx.engine.setMacro(m.i, v) }}
            onCommit={() => ctx.commit()}
          />
        ))}
        {/* quiet empty state: the + carries the hint; details live in Learn mode */}
        {named.length === 0 && <span style={{ fontSize: 10.5, color: UI.dim, opacity: 0.6 }}>—</span>}
        {free >= 0 && (
          <button
            onClick={() => {
              const name = window.prompt('Name this knob', 'Custom')?.trim()
              if (name) ctx.update(p => { p.macroNames[free] = name })
            }}
            title="Another performance knob"
            style={{ width: 30, height: 30, borderRadius: '50%', border: `1px dashed ${UI.border}`, background: 'transparent', color: UI.dim, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}
          >+</button>
        )}
      </div>
    </Section>
  )
}

// ── Movement slide-over: the matrix as a drawer ─────────────────────────────
function MovementDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.45)' }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(560px, 94vw)',
          background: UI.bg, borderLeft: `1px solid ${UI.borderLight}`, padding: 12, overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: UI.text, textTransform: 'uppercase' }}>Movement</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: UI.dim, cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>
        <div style={{ fontSize: 10.5, color: UI.dim, marginBottom: 8, lineHeight: 1.5 }}>
          Everything that moves by itself — created by knob “+”, ring drags, or chip drops — lives here.
        </div>
        <ModMatrixPanel />
      </div>
    </div>
  )
}

// ── Shell ───────────────────────────────────────────────────────────────────
// The shared header readout: mirrors whatever control is being hovered or
// dragged ("CUTOFF · 0.80"), Serum-style, so knobs themselves only need one
// line of text.
function HeaderReadout() {
  const [text, setText] = useState('')
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { label: string; value: string } | null
      setText(d ? `${d.label} · ${d.value}` : '')
    }
    window.addEventListener('apollo-readout', on)
    return () => window.removeEventListener('apollo-readout', on)
  }, [])
  return (
    <span style={{
      minWidth: 130, textAlign: 'right', fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
      color: UI.dim, textTransform: 'uppercase', fontVariantNumeric: 'tabular-nums',
      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    }}>{text}</span>
  )
}

function ApolloInner() {
  const ctx = useApollo()
  const meters = useMeters()
  const [tab, setTab] = useState<Tab>('sound')
  const [wtOpen, setWtOpen] = useState(false)
  const [movementOpen, setMovementOpen] = useState(false)
  const [midiOn, setMidiOn] = useState(false)
  const [midiName, setMidiName] = useState('')
  const [midiAvailable, setMidiAvailable] = useState(false)
  const [mpeOn, setMpeOn] = useState(false)
  const [kbdPinned, setKbdPinned] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  useEffect(() => {
    setMidiAvailable(webMidiSupported)
    setKbdPinned(localStorage.getItem('apollo2_kbd_pin') === '1')
  }, [])
  const togglePin = () => {
    setKbdPinned(v => {
      try { localStorage.setItem('apollo2_kbd_pin', v ? '0' : '1') } catch { /* quota */ }
      return !v
    })
  }

  useEffect(() => {
    if (!midiOn || mpeOn) return
    const off = onMidiNote(e => {
      if (e.type === 'on') { void ctx.start().then(() => ctx.engine.noteOn(e.pitch, e.velocity / 127)) }
      else ctx.engine.noteOff(e.pitch)
    })
    return () => { off() }
  }, [midiOn, mpeOn, ctx])

  const toggleMpe = async () => {
    if (mpeOn) { stopMpe(); setMpeOn(false); return }
    await ctx.start()
    const ok = await startMpe(ctx.engine)
    if (ok) setMpeOn(true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      if (e.shiftKey) ctx.redo()
      else ctx.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx])

  // "+"-grown inventories: derived from use + session clicks
  const [extraEnvs, setExtraEnvs] = useState(0)
  const [extraLfos, setExtraLfos] = useState(0)
  let envUsed = 1
  let lfoUsed = 1
  for (const r of ctx.patch.matrix) {
    const em = /^env([2-4])$/.exec(r.source)
    if (em) envUsed = Math.max(envUsed, Number(em[1]))
    const lm = /^lfo(\d+)y?$/.exec(r.source)
    if (lm) lfoUsed = Math.max(lfoUsed, Number(lm[1]))
  }
  const envVisible = Math.min(4, Math.max(envUsed, 1 + extraEnvs))
  const lfoVisible = Math.min(10, Math.max(lfoUsed, 1 + extraLfos))
  const routeCount = ctx.patch.matrix.length

  const headerBtn = (label: string, onClick: () => void, opts?: { on?: boolean; title?: string }) => (
    <button
      key={label}
      onClick={onClick}
      title={opts?.title}
      style={{
        background: opts?.on ? UI.blue : UI.header,
        color: opts?.on ? '#0b0d10' : UI.dim,
        border: '1px solid ' + (opts?.on ? UI.blue : UI.border),
        borderRadius: 5, padding: '4px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
        whiteSpace: 'nowrap', letterSpacing: 0.5, textTransform: 'uppercase',
      }}
    >{label}</button>
  )

  const enableMidi = async () => {
    if (midiOn) { setMidiOn(false); return }
    const ok = await startWebMidi()
    if (ok) { setMidiOn(true); setMidiName(getMidiDeviceNames()[0] || 'MIDI ready') }
    else setMidiName('No MIDI access')
  }

  // ── Sessions ────────────────────────────────────────────────────────────
  // Which saveable session this bench belongs to (a projects row with
  // modules:['apollo']). Everything autosaves into it; deep links spawn a NEW
  // session instead of stomping the last one.
  const [session, setSession] = useState<{ id: string; name: string } | null>(null)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [sessionList, setSessionList] = useState<SessionMeta[] | null>(null)

  const applyLoadedPatch = useCallback((loaded: Partial<ApolloPatch>) => {
    const merged = { ...initPatch(), ...loaded } as ApolloPatch
    ctx.update(p => {
      for (const key of Object.keys(merged) as (keyof ApolloPatch)[]) {
        ;(p as unknown as Record<string, unknown>)[key] = merged[key]
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.update])

  useEffect(() => {
    // Resolve which session this visit is, exactly once on mount.
    const sp = new URLSearchParams(window.location.search)
    const deepLink = sp.get('librarySample') || sp.get('communityPatch')
    const want = sp.get('session')
    const cur = getCurrent()
    // Whatever was on the bench gets captured into its session (or rescued as
    // "Recovered session" from the pre-sessions era) before any switch.
    const stashBench = () => {
      try {
        const raw = localStorage.getItem(WORKING_COPY_KEY)
        if (!raw) return
        const patch = JSON.parse(raw) as ApolloPatch
        if (cur) localPut(cur.id, cur.name, patch)
        else localPut(newSessionId(), 'Recovered session', patch)
      } catch { /* corrupt working copy */ }
    }
    if (deepLink) {
      // Library sample / community patch → its own fresh session. The existing
      // deep-link effects apply the patch async; by then this session is current.
      stashBench()
      const meta = { id: newSessionId(), name: sp.get('librarySample') ? 'From library' : 'Community patch' }
      setCurrent(meta); setSession(meta)
    } else if (want && want !== cur?.id) {
      stashBench()
      void loadSession(want).then(res => {
        if (res) applyLoadedPatch(res.patch)
        const meta = { id: want, name: res?.name ?? 'Session' }
        setCurrent(meta); setSession(meta)
      })
    } else if (cur) {
      setSession(cur)   // the bench already IS this session's live copy
    } else {
      const hadBench = !!localStorage.getItem(WORKING_COPY_KEY)
      const meta = { id: newSessionId(), name: hadBench ? 'Recovered session' : 'Untitled session' }
      setCurrent(meta); setSession(meta)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Per-session autosave: local always, cloud when signed in (debounced).
  // An un-renamed session adopts the patch name, so the Sessions list reads
  // "Warm Keys · Aug 20" instead of a wall of "Untitled session".
  useEffect(() => {
    if (!session || ctx.version === 0) return
    const t = setTimeout(() => {
      let name = session.name
      const patchName = ctx.patch.name?.trim()
      if (name === 'Untitled session' && patchName && patchName !== 'Init' && patchName !== 'Untitled') {
        name = patchName
        setCurrent({ id: session.id, name })
        setSession({ id: session.id, name })
      }
      void saveSession(session.id, name, ctx.patch)
    }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.version, session])

  const switchSession = async (m: { id: string; name: string }) => {
    if (session) void saveSession(session.id, session.name, ctx.patch)
    const res = await loadSession(m.id)
    if (res) applyLoadedPatch(res.patch)
    const meta = { id: m.id, name: res?.name ?? m.name }
    setCurrent(meta); setSession(meta)
    window.history.replaceState(null, '', `/apollo?session=${m.id}`)
    setSessionsOpen(false)
  }
  const newSession = () => {
    if (session) void saveSession(session.id, session.name, ctx.patch)
    const meta = { id: newSessionId(), name: 'Untitled session' }
    setCurrent(meta); setSession(meta)
    applyLoadedPatch(initPatch())
    window.history.replaceState(null, '', '/apollo')
    setSessionsOpen(false)
  }
  const openSessions = () => {
    setSessionsOpen(v => !v)
    if (!sessionsOpen) { setSessionList(null); void listSessions().then(setSessionList) }
  }

  // per-tab layout: ordered specs (id, colSpan, rowSpan|null=auto), persisted.
  // Defaults are packed Serum-dense: sources + filters up top, modulation row
  // beneath, slim macro/scope columns filling the remainder.
  const DEFAULT_LAYOUT: GridLayout = {
    sound: [
      { id: 'osc', cols: 7, rows: null }, { id: 'env', cols: 5, rows: null },
      { id: 'filters', cols: 7, rows: null }, { id: 'lfo', cols: 5, rows: null },
      { id: 'subnoise', cols: 5, rows: null }, { id: 'macros', cols: 3, rows: null }, { id: 'scope', cols: 4, rows: null },
    ],
    effects: [{ id: 'fx', cols: 12, rows: null }],
    perform: [
      { id: 'arp', cols: 5, rows: null }, { id: 'clip', cols: 7, rows: null }, { id: 'global', cols: 7, rows: null },
    ],
  }
  const [layout, setLayout] = useState<GridLayout>(DEFAULT_LAYOUT)
  useEffect(() => {
    const saved = loadLayout()
    setLayout(prev => {
      const merged: GridLayout = { ...prev }
      for (const t of Object.keys(DEFAULT_LAYOUT)) {
        const def = DEFAULT_LAYOUT[t]
        const sv = saved[t]
        if (!sv) continue
        // keep saved order/spans, but only for ids that still exist + append new ids
        const kept = sv.filter(m => def.some(d => d.id === m.id))
        for (const d of def) if (!kept.some(m => m.id === d.id)) kept.push(d)
        merged[t] = kept
      }
      return merged
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const mutateLayout = (t: string, fn: (arr: ModSpec[]) => ModSpec[]) => {
    setLayout(prev => {
      const next = { ...prev, [t]: fn(prev[t] ?? []) }
      saveLayout(next)
      return next
    })
  }

  const PANEL_RENDER: Record<string, React.ReactNode> = {
    osc: <OscPanel onOpenWt={() => setWtOpen(true)} />,
    env: <EnvPanel visible={envVisible} onAdd={() => setExtraEnvs(n => Math.min(3, Math.max(n + 1, envVisible)))} />,
    subnoise: <SubNoisePanel />,
    filters: <FilterPanel />,
    lfo: <Section title="LFO"><LfoPanel visible={lfoVisible} onAdd={() => setExtraLfos(n => Math.min(9, Math.max(n + 1, lfoVisible)))} /></Section>,
    macros: <MacrosBlock />,
    scope: <ScopeView />,
    fx: <FxRack minimal />,
    arp: <ArpPanel />,
    clip: <ClipPanel />,
    global: <GlobalPanel />,
  }

  // One PLATE per tab (Serum-style): the grid sits on a single card surface,
  // the modules dissolve their own chrome (via the --ap-sec-* vars Section
  // reads) and SHARE EDGES — zero gap, each module drawing only its right +
  // bottom seam, so neighbors split a single 1px line the way Serum 2's
  // panels do. Header bars alone delineate the modules; drag/resize unchanged.
  const grid = (t: Tab) => (
    <div style={{
      background: UI.panel,
      border: `1px solid ${UI.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
      gridAutoRows: ROW_UNIT,
      gridAutoFlow: 'dense',
      gap: 0,
      alignItems: 'stretch',
      ['--ap-sec-bg' as string]: 'transparent',
      ['--ap-sec-border' as string]: 'transparent',
      ['--ap-sec-radius' as string]: '0px',
      ['--ap-sec-head-radius' as string]: '0px',
    } as React.CSSProperties}>
      {(layout[t] ?? []).map(spec => (
        <Module
          key={spec.id}
          spec={spec}
          onSpan={(cols, rows) => mutateLayout(t, arr => arr.map(m => (m.id === spec.id ? { ...m, cols, rows } : m)))}
          onDropBefore={draggedId => mutateLayout(t, arr => {
            const next = arr.filter(m => m.id !== draggedId)
            const dragged = arr.find(m => m.id === draggedId)
            if (!dragged) return arr
            const at = next.findIndex(m => m.id === spec.id)
            next.splice(at, 0, dragged)
            return next
          })}
        >
          {PANEL_RENDER[spec.id]}
        </Module>
      ))}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: UI.bg, color: UI.text, padding: '10px 14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: UI.panel,
        border: `1px solid ${UI.border}`, borderRadius: 8, padding: '7px 12px',
      }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: 4 }}>
          APOLLO<span style={{ color: UI.blue }}>2</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '5px 13px', borderRadius: 5, fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, cursor: 'pointer',
              background: tab === t.id ? UI.header : 'transparent',
              color: tab === t.id ? UI.text : UI.dim,
              border: `1px solid ${tab === t.id ? UI.borderLight : 'transparent'}`,
            }}>{t.label}</button>
          ))}
        </div>
        <PresetBar />
        <div style={{ flex: 1 }} />
        <HeaderReadout />
        <div style={{ position: 'relative' }}>
          {headerBtn('Sessions ▾', openSessions, { on: sessionsOpen, title: 'Your saved Apollo sessions — each one keeps its own sound' })}
          {sessionsOpen && (
            <div style={{
              position: 'absolute', top: '110%', right: 0, zIndex: 300, minWidth: 260, maxHeight: 340, overflowY: 'auto',
              background: UI.panel, border: `1px solid ${UI.borderLight}`, borderRadius: 8, padding: 6,
              boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
            }}>
              <button onClick={newSession} style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 6, cursor: 'pointer',
                background: UI.header, color: UI.text, border: `1px dashed ${UI.borderLight}`, fontSize: 11, fontWeight: 800, marginBottom: 5,
              }}>+ New session</button>
              {sessionList == null && <div style={{ padding: '6px 9px', fontSize: 10.5, color: UI.dim }}>Loading…</div>}
              {sessionList?.length === 0 && <div style={{ padding: '6px 9px', fontSize: 10.5, color: UI.dim }}>No saved sessions yet — everything you do here autosaves into this one.</div>}
              {sessionList?.map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: 6,
                  background: m.id === session?.id ? UI.header : 'transparent',
                }}>
                  <button data-session-id={m.id} onClick={() => { void switchSession(m) }} style={{
                    flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: UI.text,
                    fontSize: 11.5, fontWeight: m.id === session?.id ? 800 : 500, padding: 0, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {m.name}
                    <span style={{ color: UI.dim, fontWeight: 400, marginLeft: 7, fontSize: 9.5 }}>
                      {new Date(m.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{m.cloud ? ' · ☁' : ''}
                    </span>
                  </button>
                  <button title="Rename session" onClick={() => {
                    const name = window.prompt('Session name:', m.name)?.trim()
                    if (!name) return
                    void renameSession(m.id, name)
                    setSessionList(list => list?.map(s => (s.id === m.id ? { ...s, name } : s)) ?? null)
                    if (m.id === session?.id) setSession({ id: m.id, name })
                  }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.dim, fontSize: 11, padding: 1 }}>✎</button>
                  <button title="Delete session" onClick={() => {
                    if (!window.confirm(`Delete "${m.name}"?`)) return
                    void deleteSession(m.id)
                    setSessionList(list => list?.filter(s => s.id !== m.id) ?? null)
                  }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.dim, fontSize: 11, padding: 1 }}>🗑</button>
                </div>
              ))}
            </div>
          )}
        </div>
        {headerBtn('New', newSession, { title: 'Start fresh — a clean patch in its own new session' })}
        {headerBtn('↩', () => ctx.undo(), { title: 'Undo (Cmd+Z)' })}
        {headerBtn('↪', () => ctx.redo(), { title: 'Redo (Shift+Cmd+Z)' })}
        {headerBtn(`Movement · ${routeCount}`, () => setMovementOpen(true), { title: 'Everything that moves by itself (the mod matrix)' })}
        {midiAvailable && (
          <div style={{ position: 'relative' }}>
            {headerBtn('⌨ Input ▾', () => setInputOpen(o => !o), { on: inputOpen || midiOn || mpeOn, title: 'Hardware input — MIDI keyboards and MPE controllers' })}
            {inputOpen && (
              <div style={{
                position: 'absolute', top: '110%', right: 0, zIndex: 300, minWidth: 190,
                background: UI.panel, border: `1px solid ${UI.borderLight}`, borderRadius: 8, padding: 6,
                display: 'flex', flexDirection: 'column', gap: 5, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                <ToggleBtn on={midiOn && !mpeOn} label={midiOn && !mpeOn ? `MIDI · ${midiName || 'on'}` : 'MIDI keyboard'} title={midiName || 'Connect a MIDI keyboard'} onClick={() => { void enableMidi() }} />
                <ToggleBtn on={mpeOn} label="MPE controller" title="Per-note pitch bend + pressure (Seaboard, Linnstrument…)" onClick={() => { void toggleMpe() }} />
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Knob path="global.masterGain" label="Main" size={30} />
          <div title="Output level" style={{ width: 7, height: 30, background: UI.inset, border: `1px solid ${UI.border}`, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? '#e05555' : UI.green, transition: 'height 50ms linear' }} />
          </div>
        </div>
        <HelpButton onShowTab={t => setTab(t === 'fx' ? 'effects' : t === 'seq' || t === 'global' ? 'perform' : 'sound')} />
        <LearnMode />
      </div>

      {tab === 'sound' && grid('sound')}
      {tab === 'effects' && grid('effects')}
      {tab === 'perform' && grid('perform')}

      <ModSourcesStrip />
      <div style={kbdPinned
        ? { position: 'fixed', left: 10, right: 10, bottom: 8, zIndex: 350, borderRadius: 10 }
        : undefined}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={togglePin}
            title={kbdPinned ? 'Unpin the keyboard' : 'Pin the keyboard to the bottom of the window'}
            style={{
              position: 'absolute', top: 4, right: 6, zIndex: 5,
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0,
              background: kbdPinned ? UI.blue : UI.inset,
              color: kbdPinned ? '#0b0d10' : UI.dim,
              border: `1px solid ${kbdPinned ? UI.blue : UI.border}`,
            }}
          >📌</button>
          <KeyboardStrip holdOption />
        </div>
      </div>
      {kbdPinned && <div style={{ height: 120 }} />}

      {movementOpen && <MovementDrawer onClose={() => setMovementOpen(false)} />}
      {wtOpen && <WavetableEditor onClose={() => setWtOpen(false)} />}

      {!ctx.started && (
        <div
          onClick={() => { void ctx.start() }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(6,8,10,0.88)', zIndex: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 8, color: UI.text }}>
            APOLLO<span style={{ color: UI.blue }}>2</span>
          </div>
          <div style={{ fontSize: 13, color: UI.dim }}>Hybrid synthesizer, powered by the Helios engine · click anywhere to start audio</div>
        </div>
      )}
    </div>
  )
}

export default function Apollo2() {
  return (
    <ApolloProvider quickMod>
      <ApolloInner />
    </ApolloProvider>
  )
}
