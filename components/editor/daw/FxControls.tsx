'use client'

// Sound controls, driven entirely by FX_FIELDS metadata so the clip "Sound"
// panel, preset creator, and per-note editor share one set. Layout keeps it
// from overwhelming: the 5 essentials are pinned on top, everything else lives
// in collapsible category sections. Commits on release (pointer/key up).

import { useEffect, useMemo, useState } from 'react'
import Knob from './Knob'
import { ChevronRight } from 'lucide-react'
import { FX_FIELDS, FX_CATEGORIES, TOP_FIELDS, BASIC_FIELDS, fieldIsSet, type FxField, type FxCat } from '@/lib/roll-fx'
import type { RollFx, AutoPoint } from '@/lib/daw-types'
import MotionCurve from './MotionCurve'

const ACCENT = 'var(--accent-light)'

/** Strip neutral fields; round the rest. */
export function cleanFx(fx: RollFx): RollFx | undefined {
  const out: RollFx = {}
  for (const f of FX_FIELDS) {
    const v = fx[f.key]
    if (v !== undefined && fieldIsSet(f.key, v)) out[f.key] = Math.round((v as number) * 1000) / 1000
  }
  // Articulation (legato/slide) isn't part of FX_FIELDS but rides on the same
  // bag — carry it through so editing an FX slider doesn't wipe it. 0 is a
  // meaningful explicit "off" (overriding the family default), so keep it.
  if (fx.legato !== undefined) out.legato = fx.legato
  if (fx.slide !== undefined) out.slide = fx.slide
  return Object.keys(out).length ? out : undefined
}

export default function FxControls({ value, onCommit, hideCats, hideFields, ranges, onField, mode, graphs, onGraphChange, onToggleGraph, onOpenGraph }: {
  value: RollFx | undefined
  onCommit: (next: RollFx | undefined) => void
  /** Categories to omit (e.g. ['env','pitch'] for a track effect bar). */
  hideCats?: FxCat[]
  /** Individual field keys to omit — used when volume/EQ move to the track. */
  hideFields?: (keyof RollFx)[]
  /** Per-field [normLo, normHi] spread across a multi-selection — draws a heat
   *  band showing the range. Present only for fields whose values differ. */
  ranges?: Partial<Record<string, [number, number]>>
  /** Multi-select commit: apply just this one field's value to every selected
   *  item (so only that setting syncs — its heat band collapses, others stay). */
  onField?: (key: keyof RollFx, value: number) => void
  /** 'basic' shows only the essential controls, flat; 'advanced' shows all. */
  mode?: 'basic' | 'advanced'
  /** Per-field graphs: when a field is here it's drawn as a curve over time
   *  instead of a slider. Presence of onToggleGraph enables the ◠ graph toggle. */
  graphs?: Partial<Record<string, AutoPoint[]>>
  onGraphChange?: (key: keyof RollFx, pts: AutoPoint[]) => void
  onToggleGraph?: (key: keyof RollFx, on: boolean) => void
  /** Modal mode: clicking a field's LABEL opens its graph in a modal instead of
   *  the ◠ button + inline curve. When set, takes over from onToggleGraph. */
  onOpenGraph?: (key: keyof RollFx) => void
}) {
  const [draft, setDraft] = useState<RollFx>({ ...(value ?? {}) })
  // Categories that hold a set value start expanded so active settings show.
  const [open, setOpen] = useState<Set<FxCat>>(() => initialOpen(value))

  useEffect(() => { setDraft({ ...(value ?? {}) }) }, [value])

  function set(f: FxField, norm: number) { setDraft(d => ({ ...d, [f.key]: f.fromNorm(norm) })) }
  // In multi-select mode a field commit applies just that field to everything;
  // otherwise the whole cleaned bag is committed.
  const commitField = (f: FxField) => {
    if (onField) onField(f.key, (draft[f.key] as number | undefined) ?? f.fromNorm(f.toNorm(f.neutral)))
    else onCommit(cleanFx(draft))
  }

  const byCat = useMemo(() => {
    const m: Record<string, FxField[]> = {}
    for (const f of FX_FIELDS) (m[f.cat] ||= []).push(f)
    return m
  }, [])

  const hidden = new Set<FxCat>(hideCats ?? [])
  const hiddenF = new Set<string>(hideFields ?? [])
  const showF = (f: FxField) => !hiddenF.has(f.key)
  const topFields = TOP_FIELDS.filter(f => !hidden.has(f.cat) && showF(f))

  // Per-field graph mode (a field's slider ↔ a drawn curve). Only barable fields
  // (chain + graph) can toggle, and only when the host wires onToggleGraph.
  const gProps = (f: FxField) => ({
    graphPts: graphs?.[f.key],
    graphable: (!!onToggleGraph || !!onOpenGraph) && !!f.graph && !!f.chain,
    onToggleGraph: onToggleGraph ? (on: boolean) => onToggleGraph(f.key, on) : undefined,
    onGraph: onGraphChange ? (pts: AutoPoint[]) => onGraphChange(f.key, pts) : undefined,
    onOpenGraph: onOpenGraph ? () => onOpenGraph(f.key) : undefined,
  })

  // Basic mode: the curated essential macros, flat — no category menus. This set
  // is deliberately hand-picked (Volume, Release, Filter, Reverb, Drive), so it is
  // NOT subject to hideCats (which only collapses the advanced category sections);
  // otherwise a hidden category would silently drop an essential like Release.
  if (mode === 'basic') {
    return (
      <div style={{ padding: '4px 0 2px' }}>
        {BASIC_FIELDS.filter(showF).map(f => (
          <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={() => commitField(f)} range={ranges?.[f.key]} {...gProps(f)} />
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Top essentials */}
      <div style={{ padding: '4px 0 2px' }}>
        {topFields.map(f => <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={() => commitField(f)} range={ranges?.[f.key]} {...gProps(f)} />)}
      </div>

      {/* Category menus */}
      {FX_CATEGORIES.filter(cat => !hidden.has(cat.key)).map(cat => {
        const fields = (byCat[cat.key] ?? []).filter(showF)
        if (fields.length === 0) return null
        const activeCount = fields.filter(f => fieldIsSet(f.key, draft[f.key])).length
        const isOpen = open.has(cat.key)
        return (
          <div key={cat.key} style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setOpen(s => { const n = new Set(s); n.has(cat.key) ? n.delete(cat.key) : n.add(cat.key); return n })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', transition: 'transform 0.1s', transform: isOpen ? 'rotate(90deg)' : 'none', color: 'var(--text-muted)' }}><ChevronRight size={11} /></span>
              {cat.label.toUpperCase()}
              {activeCount > 0 && <span style={{ color: ACCENT, fontSize: 9 }}>● {activeCount}</span>}
            </button>
            {isOpen && (
              <div style={{ paddingBottom: 4 }}>
                {fields.map(f => <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={() => commitField(f)} range={ranges?.[f.key]} dim={f.secondary} {...gProps(f)} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FieldSlider({ f, draft, set, commit, range, dim, graphPts, graphable, onToggleGraph, onGraph, onOpenGraph }: {
  f: FxField
  draft: RollFx
  set: (f: FxField, norm: number) => void
  commit: () => void
  /** [normLo, normHi] across a multi-selection when this field's values differ. */
  range?: [number, number]
  dim?: boolean
  graphPts?: AutoPoint[]
  graphable?: boolean
  onToggleGraph?: (on: boolean) => void
  onGraph?: (pts: AutoPoint[]) => void
  /** Modal mode: clicking the label opens the graph; no ◠ button, no inline curve. */
  onOpenGraph?: () => void
}) {
  const v = (draft[f.key] as number | undefined) ?? f.neutral
  const on = fieldIsSet(f.key, draft[f.key])
  const hasRange = !!range && Math.abs(range[1] - range[0]) > 0.005
  const lo = range ? Math.min(range[0], range[1]) : 0
  const hi = range ? Math.max(range[0], range[1]) : 0

  // Graph mode: this field is drawn as a curve over time instead of a slider.
  if (graphPts) {
    // Modal mode — a compact "graphed" row; the curve lives in the modal.
    if (onOpenGraph) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: dim ? '3px 12px 3px 20px' : '4px 12px' }}>
          <button onClick={onOpenGraph} title="Edit this effect's curve"
            style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <span style={{ fontSize: dim ? 9.5 : 10, color: ACCENT, fontWeight: 600 }}>{f.label}</span>
            <span style={{ fontSize: 8, color: ACCENT, letterSpacing: '0.04em' }}>◠ graph</span>
          </button>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>edit ▸</span>
        </div>
      )
    }
    return (
      <div style={{ padding: dim ? '3px 12px 4px 20px' : '4px 12px 5px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: dim ? 9.5 : 10, color: 'var(--text-secondary)', flex: 1 }}>{f.label}</span>
          <span style={{ fontSize: 8, color: ACCENT, letterSpacing: '0.04em' }}>GRAPH · 0→full</span>
          <button onClick={() => onToggleGraph?.(false)} title="Back to a slider (resets this effect)"
            style={{ fontSize: 10, lineHeight: 1, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${ACCENT}`, background: 'rgb(var(--accent-rgb) / 0.18)', color: ACCENT }}>◠</button>
        </div>
        <MotionCurve points={graphPts} onChange={pts => onGraph?.(pts)} width={248} height={44} color={ACCENT} />
      </div>
    )
  }

  // A graphable field in modal mode gets a clickable label (opens the curve).
  const labelClickable = graphable && !!onOpenGraph
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: dim ? '2px 12px 2px 20px' : '3px 12px' }}>
      {labelClickable ? (
        <button onClick={onOpenGraph} title="Click to draw this effect over time"
          style={{ display: 'flex', alignItems: 'center', gap: 3, width: dim ? 62 : 70, flexShrink: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: dim ? 9.5 : 10, color: dim ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
          {f.label}<span style={{ fontSize: 7, color: 'var(--text-muted)', opacity: 0.7 }}>◠</span>
        </button>
      ) : (
        <span style={{ fontSize: dim ? 9.5 : 10, color: dim ? 'var(--text-muted)' : 'var(--text-secondary)', width: dim ? 62 : 70, flexShrink: 0 }}>{f.label}</span>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* The heat band became an arc on the knob. It carried real information —
            the spread of this setting across a multi-selection — so it could not
            just be dropped when the slider went: without it, ten notes that
            disagree would look identical to ten that agree. */}
        <Knob
          value={f.toNorm(v)} min={0} max={1} defaultValue={f.toNorm(f.neutral)}
          size={dim ? 26 : 30}
          color={on ? ACCENT : 'var(--text-muted)'}
          spread={hasRange ? [lo, hi] : null}
          title={hasRange ? `${f.label} — these differ across the selection` : f.label}
          onChange={nv => set(f, nv)}
          onCommit={commit}
          format={() => (hasRange ? 'range' : f.fmt(v))}
        />
      </div>
      <span style={{ fontSize: 9.5, color: hasRange ? '#f59e0b' : on ? 'var(--text-primary)' : 'var(--text-muted)', width: graphable && !onOpenGraph ? 34 : 48, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {hasRange ? 'range' : f.fmt(v)}
      </span>
      {graphable && !onOpenGraph && (
        <button onClick={() => onToggleGraph?.(true)} title="Draw this effect over time (a graph)"
          style={{ fontSize: 10, lineHeight: 1, padding: '1px 5px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-muted)', flexShrink: 0 }}>◠</button>
      )}
    </div>
  )
}

function initialOpen(value: RollFx | undefined): Set<FxCat> {
  const s = new Set<FxCat>()
  if (value) for (const f of FX_FIELDS) if (fieldIsSet(f.key, value[f.key])) s.add(f.cat)
  return s
}
