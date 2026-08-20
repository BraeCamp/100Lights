'use client'
// Apollo shared UI state: patch + engine access, param plumbing, mod drag-drop,
// and the shared control atoms (Knob, Sel, Section, ToggleBtn).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApolloPatch, ModSource, ModRoute, FxUnit, PARAM_MAP, FX_DEFS, initPatch, getByPath, setByPath,
  resolvePatchPath, uid,
} from '@/lib/apollo/patch'
import { ApolloEngine, ApolloMeters, getApolloEngine } from '@/lib/apollo/engine-client'
import { initApolloLibrary, restorePatchSamples, setApolloSourceSample } from '@/lib/apollo/sample-store'
import { useUser } from '@clerk/nextjs'
import { onMidiCC } from '@/lib/web-midi'

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
  /** Apollo 2's minimal UI: knobs grow a hover "+" that creates modulation in place. */
  quickMod?: boolean
  undo: () => void
  redo: () => void
  /** Live structural mutation during a drag: applies + throttled engine resend,
   *  no history/re-render. Call commit() at gesture end. */
  mutateLive: (fn: (p: ApolloPatch) => void) => void
  /** MIDI-learn: arm a param path; the next CC binds to it. */
  armMidiLearn: (path: string) => void
  clearMidiBinding: (path: string) => void
  midiBindingFor: (path: string) => number | null
  midiArmed: string | null
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

// Embedded mode: the provider edits a patch OWNED BY A HOST (e.g. a DAW track's
// instrument params) instead of the standalone working copy — changes flow to
// `onChange` (debounced) rather than localStorage, and the standalone-only
// behaviors (autosave restore, ?librarySample deep link, window.__apollo*
// hooks) stay off so an open /apollo tab is never fought over.
export interface ApolloEmbed { patch: ApolloPatch; onChange: (p: ApolloPatch) => void }

export function ApolloProvider({ children, quickMod, embed }: { children: React.ReactNode; quickMod?: boolean; embed?: ApolloEmbed }) {
  const engine = useMemo(() => getApolloEngine(), [])
  const patchRef = useRef<ApolloPatch | null>(null)
  const embedRef = useRef(embed)
  embedRef.current = embed
  if (!patchRef.current) patchRef.current = embed ? { ...initPatch(), ...JSON.parse(JSON.stringify(embed.patch)) } as ApolloPatch : initPatch()
  const [version, setVersion] = useState(0)
  // restore the autosaved patch after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    if (embedRef.current) return   // embedded: the host's patch is the source of truth
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
      const em = embedRef.current
      if (em) { em.onChange(JSON.parse(JSON.stringify(patchRef.current)) as ApolloPatch); return }
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

  // live mutation during ring drags: mutate + throttled full resend, history on commit
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutateLive = useCallback((fn: (p: ApolloPatch) => void) => {
    const p = patchRef.current as ApolloPatch
    if (gestureSnap.current == null) gestureSnap.current = JSON.stringify(p)
    fn(p)
    if (!liveTimer.current) {
      liveTimer.current = setTimeout(() => {
        liveTimer.current = null
        if (engine.ready) engine.sendPatch(patchRef.current as ApolloPatch)
      }, 80)
    }
  }, [engine])

  // ---- MIDI learn: cc -> param path map, persisted per browser ----
  const MIDI_MAP_KEY = 'apollo_midi_map_v1'
  const midiMap = useRef<Record<number, string>>({})
  const [midiArmed, setMidiArmed] = useState<string | null>(null)
  const midiArmedRef = useRef<string | null>(null)
  useEffect(() => {
    try { midiMap.current = JSON.parse(localStorage.getItem(MIDI_MAP_KEY) || '{}') as Record<number, string> } catch { /* fresh */ }
  }, [])
  const saveMidiMap = () => { try { localStorage.setItem(MIDI_MAP_KEY, JSON.stringify(midiMap.current)) } catch { /* quota */ } }
  const armMidiLearn = useCallback((path: string) => { midiArmedRef.current = path; setMidiArmed(path) }, [])
  const clearMidiBinding = useCallback((path: string) => {
    for (const cc of Object.keys(midiMap.current)) if (midiMap.current[Number(cc)] === path) delete midiMap.current[Number(cc)]
    saveMidiMap()
    setVersion(v => v + 1)
  }, [])
  const midiBindingFor = useCallback((path: string): number | null => {
    for (const cc of Object.keys(midiMap.current)) if (midiMap.current[Number(cc)] === path) return Number(cc)
    return null
  }, [])
  useEffect(() => {
    let commitTimer: ReturnType<typeof setTimeout> | null = null
    const off = onMidiCC(e => {
      if (e.cc === 1 || e.cc === 64) return // reserved: mod wheel + sustain
      if (midiArmedRef.current) {
        midiMap.current[e.cc] = midiArmedRef.current
        midiArmedRef.current = null
        setMidiArmed(null)
        saveMidiMap()
        setVersion(v => v + 1)
        return
      }
      const path = midiMap.current[e.cc]
      if (!path) return
      let range: { min: number; max: number; curve?: string } | null = PARAM_MAP[path] || null
      if (!range && path.startsWith('fx.')) {
        // fx.<unitId>.<key> — find the unit in any lane to learn its range
        const [, unitId, key] = path.split('.')
        const findUnit = (units: FxUnit[]): FxUnit | null => {
          for (const u of units) {
            if (u.id === unitId) return u
            if (u.chains) for (const c of u.chains) { const hit = findUnit(c); if (hit) return hit }
          }
          return null
        }
        const p = patchRef.current as ApolloPatch
        const u = findUnit(p.fxMain) || findUnit(p.fxBus1) || findUnit(p.fxBus2)
        if (u) {
          if (key === 'mix') range = { min: 0, max: 1 }
          else {
            const pd = FX_DEFS[u.type]?.params.find(pp => pp.key === key)
            if (pd) range = { min: pd.min, max: pd.max, curve: pd.curve }
          }
        }
      }
      if (!range) return
      const t = e.value / 127
      const val = range.curve === 'log' && range.min > 0 ? range.min * Math.pow(range.max / range.min, t) : range.min + (range.max - range.min) * t
      setParam(path, val)
      if (commitTimer) clearTimeout(commitTimer)
      commitTimer = setTimeout(() => commit(), 250)
    })
    return () => { off(); if (commitTimer) clearTimeout(commitTimer) }
  }, [setParam, commit])

  // Sound Library scoping + sample restoration: any patch (autosave, preset,
  // import) that references library samples gets them re-fulfilled into the
  // engine automatically.
  const { user } = useUser()
  useEffect(() => { initApolloLibrary(user?.id ?? null) }, [user?.id])

  // Library round-trip entry: /apollo?librarySample=<id> loads that Sound
  // Library sound straight into osc 1's sample engine (audio arrives via the
  // restore effect below — restorePatchSamples fulfills by library id) and
  // remembers it as the session's source so a bounce can replace it in place.
  useEffect(() => {
    if (embedRef.current) return   // deep links belong to the standalone app
    const sp = new URLSearchParams(window.location.search)
    const libId = sp.get('librarySample')
    if (!libId) return
    setApolloSourceSample(libId, sp.get('name') || libId)
    patchRef.current!.oscs[0].enabled = true
    patchRef.current!.oscs[0].engine = 'sample'
    patchRef.current!.oscs[0].smp.sampleId = libId
    patchRef.current!.name = sp.get('name') || patchRef.current!.name
    setVersion(v => v + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const restoring = useRef(false)
  useEffect(() => {
    if (!started || restoring.current) return
    restoring.current = true
    void restorePatchSamples(patchRef.current as ApolloPatch, engine)
      .then(ids => {
        restoring.current = false
        if (ids.length) setVersion(v => v + 1) // redraw waveforms with audio present
      })
      .catch(() => { restoring.current = false })
  }, [version, started, engine])

  // programmatic hook for automation/tests (same convention as __dawDispatch)
  useEffect(() => {
    if (embedRef.current) return   // hooks belong to the standalone app
    const w = window as unknown as Record<string, unknown>
    w.__apolloEngine = engine
    w.__apolloStart = start
    w.__apolloUpdate = update
    w.__apolloPatch = () => patchRef.current
    // Offline render → base64 WAV (parity with __dawRenderOffline): AI/automation
    // sessions audition patches without touching the live audio path. `patch`
    // may be null (renders the current patch) or a partial merged over it.
    w.__apolloRenderOffline = async (
      partial: Partial<ApolloPatch> | null,
      notes: { note: number; t: number; dur: number; vel?: number }[] | null,
      seconds?: number,
    ) => {
      await start()
      const base = JSON.parse(JSON.stringify(patchRef.current)) as ApolloPatch
      const p = partial ? { ...base, ...partial } as ApolloPatch : base
      const evs = (notes && notes.length ? notes : [{ note: 48, t: 0.03, dur: 2, vel: 0.9 }])
        .map(n => ({ t: n.t, dur: n.dur, note: n.note, vel: n.vel ?? 0.9 }))
      const secs = seconds ?? Math.max(...evs.map(n => n.t + n.dur)) + 2
      const buf = await engine.renderToBuffer(p, evs, secs)
      const { audioBufferToWav } = await import('@/lib/wav-encoder')
      const blob = audioBufferToWav(buf)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return { base64: btoa(bin), seconds: secs, sampleRate: buf.sampleRate }
    }
    return () => {
      delete w.__apolloEngine; delete w.__apolloStart; delete w.__apolloUpdate; delete w.__apolloPatch; delete w.__apolloRenderOffline
    }
  }, [engine, start, update])

  const value = useMemo<ApolloCtxValue>(() => ({
    patch: patchRef.current as ApolloPatch,
    version, engine, started, start, update, setParam, commit,
    selectedOsc, setSelectedOsc, modSource, setModSource, getModSource, assignMod, routesFor, undo, redo,
    mutateLive, armMidiLearn, clearMidiBinding, midiBindingFor, midiArmed, quickMod,
  }), [version, engine, started, start, update, setParam, commit, selectedOsc, modSource, setModSource, getModSource, assignMod, routesFor, undo, redo, mutateLive, armMidiLearn, clearMidiBinding, midiBindingFor, midiArmed, quickMod])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ---------------------------------------------------------------------------
// Shared atoms — the Apollo house palette

export const UI = {
  bg: '#0a0c0f',
  panel: '#12151a',
  header: '#1a1f26',
  inset: '#0d1013',
  border: '#262c35',
  borderLight: '#333a45',
  green: '#8ee67e',   // primary viz color (waveforms)
  greenDim: '#4f8f47',
  yellow: '#ffd75e',  // viz highlight (current frame, playheads)
  blue: '#4aa9ff',    // accent (arcs, active controls)
  blueDim: '#2c6db0',
  text: '#dbe1e8',
  dim: '#8b93a0',
  knobHi: '#333b47',  // legacy gradient stops (kept for shell themes)
  knobMid: '#20252d',
  knobLo: '#12151a',
  knob: '#252c36',    // flat knob face (solid, no gradient/shadow)
  panelLo: '#0f1216', // section body gradient bottom stop
  headerLo: '#14181e', // section header gradient bottom stop
}

export type ApolloTheme = Partial<typeof UI>
const DEFAULT_UI = { ...UI }

/**
 * Swap the whole visual language. Panels read UI.* at render time and
 * canvases at draw time, so a shell calling this in its component body
 * (before children render) re-skins every panel. Always resets to the
 * default first so shells never inherit another shell's theme.
 */
export function applyApolloTheme(theme: ApolloTheme): void {
  Object.assign(UI, DEFAULT_UI, theme)
}

// Shared readout: any control can broadcast "label · value" to the header
// (the Serum-style single readout — knobs show their value in place on hover,
// and this mirrors it somewhere fixed so long drags stay readable).
export function readout(label: string | null, value?: string) {
  try {
    window.dispatchEvent(new CustomEvent('apollo-readout', { detail: label == null ? null : { label, value: value ?? '' } }))
  } catch { /* SSR */ }
}

export function Section({ title, right, led, dice, children, style }: { title: string; right?: React.ReactNode; led?: boolean; dice?: () => void; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: `var(--ap-sec-bg, ${UI.panel})`,
      border: `1px solid var(--ap-sec-border, ${UI.border})`, borderRadius: 'var(--ap-sec-radius, 8px)', overflow: 'visible',
      display: 'flex', flexDirection: 'column', minWidth: 0, ...style,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: UI.header,
        borderBottom: `1px solid var(--ap-sec-border, ${UI.border})`, borderRadius: 'var(--ap-sec-head-radius, 7px 7px 0 0)',
        padding: '5px 9px', minHeight: 26,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'var(--ap-grip-pad, 0px)' }}>
          {led != null && <span style={{ width: 7, height: 7, borderRadius: '50%', background: led ? UI.green : '#3a404a', display: 'inline-block' }} />}
          <div data-learn={title} style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: UI.text, textTransform: 'uppercase', fontStretch: 'condensed' }}>{title}</div>
          {dice && (
            <button
              onClick={dice}
              data-learn="Dice"
              title={`Roll the dice — randomize just this module (${title})`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1, opacity: 0.7 }}
            >🎲</button>
          )}
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
    background: UI.header, color: UI.text, border: `1px solid ${UI.border}`,
    borderRadius: 5, padding: '3px 6px', fontSize: 10.5, fontWeight: 600, width: width || '100%', minWidth: 0, cursor: 'pointer',
  }
  return (
    <select value={value} title={title} data-learn={title} onChange={e => onChange(e.target.value)} style={selStyle}>
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
      data-learn={label}
      style={{
        background: on ? ac : UI.header,
        color: on ? '#0b0d10' : UI.dim,
        border: '1px solid ' + (on ? ac : UI.border),
        borderRadius: 5, padding: '3px 9px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer',
        whiteSpace: 'nowrap', letterSpacing: 0.6, textTransform: 'uppercase',
        transition: 'background 120ms, color 120ms, border-color 120ms',
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)

  // Apollo 2 quick-mod: create a modulation route from the destination side —
  // hover a knob, press its "+", pick what should move it. Sources are chosen
  // as the lowest unused slot so the corresponding panel reveals itself.
  const quickAssign = (kind: 'lfo' | 'env' | 'macro') => {
    if (!ctx || !props.path) return
    setQuickOpen(false)
    const dest = props.path
    const pm = ctx.patch
    const mkRoute = (source: ModSource) => ({ id: uid(), source, dest, amount: 0.35, bipolar: false, aux: 'none' as ModSource, auxAmount: 0, curve: null, bypass: false })
    if (kind === 'macro') {
      let slot = 0
      for (let i = 0; i < 8; i++) {
        if (pm.macroNames[i] === `Macro ${i + 1}` && !pm.matrix.some(r => r.source === `macro${i + 1}`)) { slot = i; break }
      }
      const name = window.prompt('Name this knob', props.label)?.trim()
      ctx.update(pp => {
        if (name) pp.macroNames[slot] = name
        pp.matrix.push(mkRoute(`macro${slot + 1}` as ModSource))
      })
      return
    }
    let src: ModSource | null = null
    if (kind === 'lfo') {
      for (let n = 1; n <= 10; n++) if (!pm.matrix.some(r => r.source === `lfo${n}`)) { src = `lfo${n}` as ModSource; break }
      src = src ?? ('lfo1' as ModSource)
    } else {
      for (let n = 2; n <= 4; n++) if (!pm.matrix.some(r => r.source === `env${n}`)) { src = `env${n}` as ModSource; break }
      src = src ?? ('env2' as ModSource)
    }
    ctx.update(pp => { pp.matrix.push(mkRoute(src as ModSource)) })
  }
  const [ringAmt, setRingAmt] = useState<number | null>(null)
  const dragRef = useRef<{ y: number; v: number } | null>(null)
  const ringRef = useRef<{ y: number; amt: number; id: string } | null>(null)
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
    if (e.button === 2) return
    e.preventDefault()
    // capture on the SVG itself — e.target is an inner path that React
    // replaces as the arc redraws, which silently kills the capture and
    // leaves the drag stuck "held" after the mouse is released
    try { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    // grabbing the outer arc of a modulated knob edits the mod AMOUNT
    const svgEl = e.currentTarget as SVGSVGElement
    const rect = svgEl.getBoundingClientRect()
    const dx = e.clientX - rect.left - rect.width / 2
    const dyC = e.clientY - rect.top - rect.height / 2
    const dist = Math.hypot(dx, dyC)
    const myRoutes = props.path && ctx ? ctx.routesFor(props.path) : []
    if (myRoutes.length && dist > rect.width / 2 - 6.5) {
      ringRef.current = { y: e.clientY, amt: myRoutes[0].amount, id: myRoutes[0].id }
      setRingAmt(myRoutes[0].amount)
      setDragging(true)
      return
    }
    dragRef.current = { y: e.clientY, v: toNorm(val) }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    // self-heal: pointermove fires on plain hover too — if the button is no
    // longer down but a drag ref survived (lost capture), end the drag now
    if (e.buttons === 0) {
      if (dragRef.current || ringRef.current) onPointerUp()
      return
    }
    if (ringRef.current && ctx) {
      const dy = ringRef.current.y - e.clientY
      const amt = Math.min(1, Math.max(-1, ringRef.current.amt + dy / 120 * (e.shiftKey ? 0.25 : 1)))
      const id = ringRef.current.id
      ctx.mutateLive(p => { const row = p.matrix.find(r => r.id === id); if (row) row.amount = amt })
      setRingAmt(amt)
      return
    }
    if (!dragRef.current) return
    const dy = dragRef.current.y - e.clientY
    const fine = e.shiftKey ? 0.25 : 1
    const nv = fromNorm(Math.min(1, Math.max(0, dragRef.current.v + dy / 150 * fine)))
    apply(nv)
    readout(props.label, fmtFn(nv))
  }
  const onPointerUp = () => {
    setDragging(false)
    if (ringRef.current) {
      ringRef.current = null
      setRingAmt(null)
      ctx?.commit()
      return
    }
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
  const modAmt = ringAmt != null ? ringAmt : (routes.length ? routes[0].amount : 0)
  const midiCc = props.path && ctx ? ctx.midiBindingFor(props.path) : null
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
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: size + 14, userSelect: 'none', position: 'relative' }}
      data-learn={props.label}
      title={props.path ? `${props.label} — drag to change, double-click resets, right-click for MIDI${routes.length ? `; ring drag edits ${routes[0].source} amount` : ''}` : props.label}
      onContextMenu={props.path ? (e => { e.preventDefault(); setMenuOpen(o => !o) }) : undefined}
      onMouseEnter={() => { setHovered(true); readout(props.label, fmtFn(val)) }}
      onMouseLeave={() => { setHovered(false); setQuickOpen(false); readout(null) }}
    >
      {ctx?.quickMod && props.path && hovered && (
        <button
          onClick={e => { e.stopPropagation(); setQuickOpen(o => !o) }}
          title="Make this knob move by itself"
          style={{
            position: 'absolute', top: -6, right: -3, zIndex: 290,
            width: 15, height: 15, borderRadius: '50%', padding: 0, lineHeight: 1,
            fontSize: 11, fontWeight: 800, cursor: 'pointer',
            background: quickOpen ? UI.green : UI.panel, color: quickOpen ? '#0b0d10' : UI.dim,
            border: `1px solid ${quickOpen ? UI.green : UI.borderLight}`,
          }}
        >+</button>
      )}
      {quickOpen && props.path && ctx && (
        <div style={{
          position: 'absolute', zIndex: 300, top: '100%', left: '50%', transform: 'translateX(-50%)',
          background: UI.panel, border: `1px solid ${UI.borderLight}`, borderRadius: 7, padding: 6,
          display: 'flex', flexDirection: 'column', gap: 4, minWidth: 128, boxShadow: '0 8px 22px rgba(0,0,0,0.55)',
        }}>
          <div style={{ fontSize: 8.5, color: UI.dim, letterSpacing: 0.8, textTransform: 'uppercase' }}>Move this with…</div>
          <button style={menuBtn} onClick={() => quickAssign('lfo')}>a wobble (LFO)</button>
          <button style={menuBtn} onClick={() => quickAssign('env')}>over time (Env)</button>
          <button style={menuBtn} onClick={() => quickAssign('macro')}>a knob of its own (Macro)</button>
        </div>
      )}
      {menuOpen && props.path && ctx && (
        <div style={{
          position: 'absolute', zIndex: 300, top: '100%', left: '50%', transform: 'translateX(-50%)',
          background: UI.panel, border: `1px solid ${UI.borderLight}`, borderRadius: 7, padding: 6,
          display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110, boxShadow: '0 8px 22px rgba(0,0,0,0.55)',
        }}>
          {ctx.midiArmed === props.path
            ? <div style={{ fontSize: 9, color: UI.yellow }}>move a MIDI knob…</div>
            : <button style={menuBtn} onClick={() => { ctx.armMidiLearn(props.path as string); }}>MIDI Learn</button>}
          {midiCc != null && <button style={menuBtn} onClick={() => { ctx.clearMidiBinding(props.path as string); setMenuOpen(false) }}>Unbind CC {midiCc}</button>}
          {routes.length > 0 && (
            <button style={menuBtn} onClick={() => { const id = routes[0].id; ctx.update(p => { p.matrix = p.matrix.filter(r => r.id !== id) }); setMenuOpen(false) }}>
              Remove {routes[0].source} mod
            </button>
          )}
          <button style={menuBtn} onClick={() => setMenuOpen(false)}>Close</button>
        </div>
      )}
      <svg
        width={size} height={size}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp}
        onDoubleClick={() => { apply(defaultValue); if (props.path && ctx) ctx.commit(); props.onCommit?.() }}
        style={{ cursor: 'ns-resize', touchAction: 'none', outline: dragOver ? `2px solid ${UI.blue}` : 'none', borderRadius: '50%' }}
      >
        {/* track */}
        <path d={arc(a0, a0 + sweep, r)} stroke={UI.border} strokeWidth={3} fill="none" strokeLinecap="round" />
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
        {/* flat body — solid color, no gradient or shadow */}
        <circle cx={cx} cy={cy} r={r - 4.5} fill={UI.knob} />
        {/* needle */}
        <line
          x1={cx + (r - 12) * Math.cos(((angle - 90) * Math.PI) / 180) * 0.25}
          y1={cy + (r - 12) * Math.sin(((angle - 90) * Math.PI) / 180) * 0.25}
          x2={cx + (r - 7) * Math.cos(((angle - 90) * Math.PI) / 180)}
          y2={cy + (r - 7) * Math.sin(((angle - 90) * Math.PI) / 180)}
          stroke={UI.text} strokeWidth={1.8} strokeLinecap="round"
        />
        {/* mod source dot (attachment indicator) */}
        {routes.length > 0 && <circle cx={size - 5} cy={5} r={3} fill={UI.green} opacity={0.9} />}
        {midiCc != null && <circle cx={5} cy={5} r={3} fill={UI.yellow} opacity={0.9} />}
      </svg>
      {/* one line, not two: the label rests, the VALUE takes its place only
          while the knob is hovered or dragged (plus the shared header readout) */}
      <div style={{
        fontSize: 8.5, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase',
        color: hovered || dragging ? UI.text : UI.dim,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap', maxWidth: size + 20, overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{hovered || dragging ? fmtFn(val) : props.label}</div>
    </div>
  )
}

const menuBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: UI.text, fontSize: 9.5, fontWeight: 600,
  textAlign: 'left', cursor: 'pointer', padding: '2px 4px', borderRadius: 4,
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
