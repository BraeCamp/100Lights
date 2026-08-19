'use client'
// Dual filter section: 30+ filter types, serial/parallel routing,
// Serum-style per-source routing buttons (S A B C N).

import React from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn, UI } from './ApolloContext'
import { FILTER_TYPES, FilterType, SourceDest } from '@/lib/apollo/patch'

// toggle whether a source feeds filter `fi`, preserving its other-filter routing
function toggleDest(dest: SourceDest, fi: 0 | 1): SourceDest {
  const mine: SourceDest = fi === 0 ? 'f1' : 'f2'
  const other: SourceDest = fi === 0 ? 'f2' : 'f1'
  const feeds = dest === mine || dest === 'both'
  if (feeds) return dest === 'both' ? other : 'bypass'
  return dest === other ? 'both' : mine
}

function SourceButtons({ fi }: { fi: 0 | 1 }) {
  const ctx = useApollo()
  const p = ctx.patch
  const mine: SourceDest = fi === 0 ? 'f1' : 'f2'
  const feeds = (d: SourceDest) => d === mine || d === 'both'
  const items: { label: string; on: boolean; toggle: () => void }[] = [
    { label: 'S', on: feeds(p.sub.dest), toggle: () => ctx.update(pp => { pp.sub.dest = toggleDest(pp.sub.dest, fi) }) },
    ...([0, 1, 2] as const).map(oi => ({
      label: 'ABC'[oi], on: feeds(p.oscs[oi].dest),
      toggle: () => ctx.update(pp => { pp.oscs[oi].dest = toggleDest(pp.oscs[oi].dest, fi) }),
    })),
    { label: 'N', on: feeds(p.noise.dest), toggle: () => ctx.update(pp => { pp.noise.dest = toggleDest(pp.noise.dest, fi) }) },
  ]
  return (
    <div style={{ display: 'flex', gap: 2 }} title="Which sources feed this filter">
      {items.map(it => (
        <button
          key={it.label}
          onClick={it.toggle}
          style={{
            width: 20, height: 18, borderRadius: 4, fontSize: 9, fontWeight: 800, cursor: 'pointer',
            background: it.on ? UI.blue : '#14181e',
            color: it.on ? '#0b0d10' : UI.dim,
            border: `1px solid ${it.on ? UI.blue : UI.border}`,
            padding: 0, transition: 'background 100ms',
          }}
        >{it.label}</button>
      ))}
    </div>
  )
}

const FAT_LABEL: Partial<Record<FilterType, string>> = {
  multiLBH: 'Morph', multiLNH: 'Morph', morphSVF: 'Morph', formant: 'Vowel', ringMod: 'Mix',
}

function FilterSlot({ fi }: { fi: 0 | 1 }) {
  const ctx = useApollo()
  const cfg = ctx.patch.filters[fi]
  const pfx = `f${fi + 1}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 220, opacity: cfg.enabled ? 1 : 0.55 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToggleBtn on={cfg.enabled} label={`FILTER ${fi + 1}`} onClick={() => ctx.update(p => { p.filters[fi].enabled = !p.filters[fi].enabled })} />
        <Sel
          value={cfg.type}
          options={FILTER_TYPES.map(t => ({ value: t.id, label: t.label, group: t.group }))}
          onChange={v => ctx.update(p => { p.filters[fi].type = v as FilterType })}
          width={120}
        />
        <SourceButtons fi={fi} />
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
