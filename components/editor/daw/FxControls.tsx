'use client'

// Grouped sliders for a RollFx bag, driven entirely by FX_FIELDS metadata so
// the clip "Sound" panel, the preset creator, and the per-note editor share one
// control set. Commits on release (pointer/key up) to keep undo history sane.

import { useEffect, useState } from 'react'
import { FX_FIELDS, fieldIsSet, type FxField } from '@/lib/roll-fx'
import type { RollFx } from '@/lib/daw-types'

const ACCENT = 'var(--accent-light)'
const GROUP_LABEL: Record<FxField['group'], string> = {
  level: 'Level', filter: 'Filter', drive: 'Drive', space: 'Space & delay', mod: 'Modulation', eq: 'Tone EQ', time: '',
}

/** Strip neutral fields; round the rest. Preserves sustain (edited elsewhere). */
export function cleanFx(fx: RollFx): RollFx | undefined {
  const out: RollFx = {}
  for (const f of FX_FIELDS) {
    const v = fx[f.key]
    if (v !== undefined && fieldIsSet(f.key, v)) out[f.key] = Math.round((v as number) * 1000) / 1000
  }
  if (fx.sustain && fx.sustain > 0) out.sustain = Math.round(fx.sustain * 100) / 100
  return Object.keys(out).length ? out : undefined
}

export default function FxControls({ value, onCommit, exclude }: {
  value: RollFx | undefined
  onCommit: (next: RollFx | undefined) => void
  /** Field groups to hide (e.g. ['time'] to drop secondary delay params). */
  exclude?: FxField['group'][]
}) {
  const [draft, setDraft] = useState<RollFx>({ ...(value ?? {}) })

  // Mirror external changes (different clip/note opened) without clobbering a drag
  useEffect(() => { setDraft({ ...(value ?? {}) }) }, [value])

  const fields = FX_FIELDS.filter(f => !exclude?.includes(f.group))
  const groups = [...new Set(fields.map(f => f.group))]

  function set(f: FxField, norm: number) {
    setDraft(d => ({ ...d, [f.key]: f.fromNorm(norm) }))
  }
  function commit() { onCommit(cleanFx(draft)) }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px' }
  const labelStyle: React.CSSProperties = { fontSize: 10, color: 'var(--text-secondary)', width: 70, flexShrink: 0 }
  const valStyle: React.CSSProperties = { fontSize: 9.5, color: 'var(--text-primary)', width: 48, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }

  return (
    <div>
      {groups.map(g => (
        <div key={g}>
          {GROUP_LABEL[g] && (
            <div style={{ padding: '7px 12px 2px', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              {GROUP_LABEL[g].toUpperCase()}
            </div>
          )}
          {fields.filter(f => f.group === g).map(f => {
            const v = (draft[f.key] as number | undefined) ?? f.neutral
            const on = fieldIsSet(f.key, draft[f.key])
            return (
              <div key={f.key} style={rowStyle}>
                <span style={labelStyle}>{f.label}</span>
                <input
                  type="range" min={0} max={1} step={0.005}
                  value={f.toNorm(v)}
                  onChange={e => set(f, Number(e.target.value))}
                  onPointerUp={commit} onKeyUp={commit}
                  style={{ flex: 1, minWidth: 0, accentColor: ACCENT }}
                />
                <span style={{ ...valStyle, color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}>{f.fmt(v)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
