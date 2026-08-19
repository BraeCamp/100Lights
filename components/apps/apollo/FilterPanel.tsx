'use client'
// Dual filter section: 30+ filter types, serial/parallel routing.

import React from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn } from './ApolloContext'
import { FILTER_TYPES, FilterType } from '@/lib/apollo/patch'

const FAT_LABEL: Partial<Record<FilterType, string>> = {
  multiLBH: 'Morph', multiLNH: 'Morph', morphSVF: 'Morph', formant: 'Vowel', ringMod: 'Mix',
}

function FilterSlot({ fi }: { fi: 0 | 1 }) {
  const ctx = useApollo()
  const cfg = ctx.patch.filters[fi]
  const pfx = `f${fi + 1}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 220, opacity: cfg.enabled ? 1 : 0.55 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <ToggleBtn on={cfg.enabled} label={`FILTER ${fi + 1}`} onClick={() => ctx.update(p => { p.filters[fi].enabled = !p.filters[fi].enabled })} />
        <Sel
          value={cfg.type}
          options={FILTER_TYPES.map(t => ({ value: t.id, label: t.label, group: t.group }))}
          onChange={v => ctx.update(p => { p.filters[fi].type = v as FilterType })}
          width={120}
        />
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <Knob path={`${pfx}.cutoff`} label="Cutoff" size={42} />
        <Knob path={`${pfx}.res`} label="Res" size={36} />
        <Knob path={`${pfx}.drive`} label="Drive" size={36} />
        <Knob path={`${pfx}.fat`} label={FAT_LABEL[cfg.type] || 'Fat'} size={36} />
        <Knob path={`${pfx}.mix`} label="Mix" size={36} />
        <Knob path={`${pfx}.pan`} label="Pan" bipolar size={36} />
        <Knob label="Key" size={36} min={0} max={1} def={0} value={cfg.keytrack}
          onChange={v => { ctx.update(p => { p.filters[fi].keytrack = v }) }} />
      </div>
    </div>
  )
}

export default function FilterPanel() {
  const ctx = useApollo()
  return (
    <Section
      title="Filters"
      right={
        <div style={{ display: 'flex', gap: 4 }}>
          <ToggleBtn on={ctx.patch.filterRouting === 'serial'} label="Serial" onClick={() => ctx.update(p => { p.filterRouting = 'serial' })} />
          <ToggleBtn on={ctx.patch.filterRouting === 'parallel'} label="Parallel" onClick={() => ctx.update(p => { p.filterRouting = 'parallel' })} />
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <FilterSlot fi={0} />
        <FilterSlot fi={1} />
      </div>
    </Section>
  )
}
