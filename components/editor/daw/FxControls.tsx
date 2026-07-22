'use client'

// Sound controls, driven entirely by FX_FIELDS metadata so the clip "Sound"
// panel, preset creator, and per-note editor share one set. Layout keeps it
// from overwhelming: the 5 essentials are pinned on top, everything else lives
// in collapsible category sections. Commits on release (pointer/key up).

import { useEffect, useMemo, useState } from 'react'
import { FX_FIELDS, FX_CATEGORIES, TOP_FIELDS, fieldIsSet, type FxField, type FxCat } from '@/lib/roll-fx'
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

export default function FxControls({ value, onCommit }: {
  value: RollFx | undefined
  onCommit: (next: RollFx | undefined) => void
}) {
  const [draft, setDraft] = useState<RollFx>({ ...(value ?? {}) })
  // Categories that hold a set value start expanded so active settings show.
  const [open, setOpen] = useState<Set<FxCat>>(() => initialOpen(value))

  useEffect(() => { setDraft({ ...(value ?? {}) }) }, [value])

  function set(f: FxField, norm: number) { setDraft(d => ({ ...d, [f.key]: f.fromNorm(norm) })) }
  const commit = () => onCommit(cleanFx(draft))

  const byCat = useMemo(() => {
    const m: Record<string, FxField[]> = {}
    for (const f of FX_FIELDS) (m[f.cat] ||= []).push(f)
    return m
  }, [])

  return (
    <div>
      {/* Top 5 essentials */}
      <div style={{ padding: '4px 0 2px' }}>
        {TOP_FIELDS.map(f => <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={commit} />)}
      </div>

      {/* Category menus */}
      {FX_CATEGORIES.map(cat => {
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
                {fields.map(f => <FieldSlider key={f.key} f={f} draft={draft} set={set} commit={commit} dim={f.secondary} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FieldSlider({ f, draft, set, commit, dim }: {
  f: FxField
  draft: RollFx
  set: (f: FxField, norm: number) => void
  commit: () => void
  dim?: boolean
}) {
  const v = (draft[f.key] as number | undefined) ?? f.neutral
  const on = fieldIsSet(f.key, draft[f.key])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: dim ? '2px 12px 2px 20px' : '3px 12px' }}>
      <span style={{ fontSize: dim ? 9.5 : 10, color: dim ? 'var(--text-muted)' : 'var(--text-secondary)', width: dim ? 62 : 70, flexShrink: 0 }}>{f.label}</span>
      <input
        type="range" min={0} max={1} step={0.005}
        value={f.toNorm(v)}
        onChange={e => set(f, Number(e.target.value))}
        onPointerUp={commit} onKeyUp={commit}
        style={{ flex: 1, minWidth: 0, accentColor: ACCENT }}
      />
      <span style={{ fontSize: 9.5, color: on ? 'var(--text-primary)' : 'var(--text-muted)', width: 48, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{f.fmt(v)}</span>
    </div>
  )
}

function initialOpen(value: RollFx | undefined): Set<FxCat> {
  const s = new Set<FxCat>()
  if (value) for (const f of FX_FIELDS) if (fieldIsSet(f.key, value[f.key])) s.add(f.cat)
  return s
}
