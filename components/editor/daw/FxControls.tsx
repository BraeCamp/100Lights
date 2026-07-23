'use client'

// Sound controls, driven entirely by FX_FIELDS metadata so the clip "Sound"
// panel, preset creator, and per-note editor share one set. Layout keeps it
// from overwhelming: the 5 essentials are pinned on top, everything else lives
// in collapsible category sections. Commits on release (pointer/key up).

import { useEffect, useMemo, useState } from 'react'
import { FX_FIELDS, FX_CATEGORIES, TOP_FIELDS, BASIC_FIELDS, fieldIsSet, type FxField, type FxCat } from '@/lib/roll-fx'
import type { RollFx } from '@/lib/daw-types'

const ACCENT = 'var(--accent-light)'

/** Strip neutral fields; round the rest. */
export function cleanFx(fx: RollFx): RollFx | undefined {
  const out: RollFx = {}
  for (const f of FX_FIELDS) {
    const v = fx[f.key]
    if (v !== undefined && fieldIsSet(f.key, v)) out[f.key] = Math.round((v as number) * 1000) / 1000
  }
  return Object.keys(out).length ? out : undefined
}

export default function FxControls({ value, onCommit, hideCats, ranges, onField, mode }: {
  value: RollFx | undefined
  onCommit: (next: RollFx | undefined) => void
  /** Categories to omit (e.g. ['env','pitch'] for a track effect bar). */
  hideCats?: FxCat[]
  /** Per-field [normLo, normHi] spread across a multi-selection — draws a heat
   *  band showing the range. Present only for fields whose values differ. */
  ranges?: Partial<Record<string, [number, number]>>
  /** Multi-select commit: apply just this one field's value to every selected
   *  item (so only that setting syncs — its heat band collapses, others stay). */
  onField?: (key: keyof RollFx, value: number) => void
  /** 'basic' shows only the essential controls, flat; 'advanced' shows all. */
  mode?: 'basic' | 'advanced'
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
  const topFields = TOP_FIELDS.filter(f => !hidden.has(f.cat))

  // Basic mode: just the essentials, flat — no category menus.
  if (mode === 'basic') {
    return (
      <div style={{ padding: '4px 0 2px' }}>
        {BASIC_FIELDS.filter(f => !hidden.has(f.cat)).map(f => (
          <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={() => commitField(f)} range={ranges?.[f.key]} />
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Top essentials */}
      <div style={{ padding: '4px 0 2px' }}>
        {topFields.map(f => <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={() => commitField(f)} range={ranges?.[f.key]} />)}
      </div>

      {/* Category menus */}
      {FX_CATEGORIES.filter(cat => !hidden.has(cat.key)).map(cat => {
        const fields = byCat[cat.key] ?? []
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
              <span style={{ display: 'inline-block', width: 8, transition: 'transform 0.1s', transform: isOpen ? 'rotate(90deg)' : 'none', color: 'var(--text-muted)' }}>▶</span>
              {cat.label.toUpperCase()}
              {activeCount > 0 && <span style={{ color: ACCENT, fontSize: 9 }}>● {activeCount}</span>}
            </button>
            {isOpen && (
              <div style={{ paddingBottom: 4 }}>
                {fields.map(f => <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={() => commitField(f)} range={ranges?.[f.key]} dim={f.secondary} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FieldSlider({ f, draft, set, commit, range, dim }: {
  f: FxField
  draft: RollFx
  set: (f: FxField, norm: number) => void
  commit: () => void
  /** [normLo, normHi] across a multi-selection when this field's values differ. */
  range?: [number, number]
  dim?: boolean
}) {
  const v = (draft[f.key] as number | undefined) ?? f.neutral
  const on = fieldIsSet(f.key, draft[f.key])
  const hasRange = !!range && Math.abs(range[1] - range[0]) > 0.005
  const lo = range ? Math.min(range[0], range[1]) : 0
  const hi = range ? Math.max(range[0], range[1]) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: dim ? '2px 12px 2px 20px' : '3px 12px' }}>
      <span style={{ fontSize: dim ? 9.5 : 10, color: dim ? 'var(--text-muted)' : 'var(--text-secondary)', width: dim ? 62 : 70, flexShrink: 0 }}>{f.label}</span>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        {hasRange && (
          // Heat band: the spread of this setting across the selection. Bars mark
          // the min/max ends. It vanishes once the field is set for all of them.
          <div style={{ position: 'absolute', left: `${lo * 100}%`, right: `${(1 - hi) * 100}%`, top: '50%', height: 6, transform: 'translateY(-50%)', borderRadius: 3, background: 'linear-gradient(90deg, #3b82f6, #f59e0b, #ef4444)', pointerEvents: 'none', zIndex: 0 }}>
            <div style={{ position: 'absolute', left: 0, top: -3, bottom: -3, width: 2, background: '#fff' }} />
            <div style={{ position: 'absolute', right: 0, top: -3, bottom: -3, width: 2, background: '#fff' }} />
          </div>
        )}
        <input
          type="range" min={0} max={1} step={0.005}
          value={f.toNorm(v)}
          onChange={e => set(f, Number(e.target.value))}
          onPointerUp={commit} onKeyUp={commit}
          style={{ position: 'relative', zIndex: 1, width: '100%', minWidth: 0, accentColor: hasRange ? 'transparent' : ACCENT }}
        />
      </div>
      <span style={{ fontSize: 9.5, color: hasRange ? '#f59e0b' : on ? 'var(--text-primary)' : 'var(--text-muted)', width: 48, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {hasRange ? 'range' : f.fmt(v)}
      </span>
    </div>
  )
}

function initialOpen(value: RollFx | undefined): Set<FxCat> {
  const s = new Set<FxCat>()
  if (value) for (const f of FX_FIELDS) if (fieldIsSet(f.key, value[f.key])) s.add(f.cat)
  return s
}
