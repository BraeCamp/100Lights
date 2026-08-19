'use client'
// Preset management: name, browse factory/user presets, save/load,
// import/export JSON, init, randomize.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApollo, ToggleBtn } from './ApolloContext'
import { ApolloPatch, initPatch, defaultFx, uid, ModSource, FxType, WarpMode, FilterType } from '@/lib/apollo/patch'
import { FACTORY_PRESETS } from '@/lib/apollo/presets'

const LS_PRESETS = 'apollo_presets_v1'

interface UserPreset { name: string; json: string }

function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS)
    if (raw) return JSON.parse(raw) as UserPreset[]
  } catch { /* corrupt list */ }
  return []
}

export default function PresetBar() {
  const ctx = useApollo()
  const [editingName, setEditingName] = useState(false)
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])
  useEffect(() => { setUserPresets(loadUserPresets()) }, [])
  const fileRef = useRef<HTMLInputElement>(null)

  const applyPatch = useCallback((loaded: Partial<ApolloPatch>) => {
    const merged = { ...initPatch(), ...loaded } as ApolloPatch
    ctx.update(p => {
      for (const key of Object.keys(merged) as (keyof ApolloPatch)[]) {
        ;(p as unknown as Record<string, unknown>)[key] = merged[key]
      }
      // re-send LFO luts + tables happens inside sendPatch via update
    })
  }, [ctx])

  const allPresets = useMemo(() => [
    ...FACTORY_PRESETS.map(fp => ({ group: 'Factory', name: fp.name, load: () => applyPatch(structuredClone(fp.patch)) })),
    ...userPresets.map(up => ({ group: 'User', name: up.name, load: () => { try { applyPatch(JSON.parse(up.json) as Partial<ApolloPatch>) } catch { /* bad json */ } } })),
  ], [userPresets, applyPatch])

  const currentIdx = allPresets.findIndex(pr => pr.name === ctx.patch.name)

  const step = (dir: number) => {
    if (!allPresets.length) return
    const next = ((currentIdx < 0 ? 0 : currentIdx + dir) + allPresets.length) % allPresets.length
    allPresets[next].load()
  }

  const save = () => {
    const name = ctx.patch.name.trim() || 'Untitled'
    const json = JSON.stringify(ctx.patch)
    const next = [...userPresets.filter(u => u.name !== name), { name, json }]
    setUserPresets(next)
    try { localStorage.setItem(LS_PRESETS, JSON.stringify(next)) } catch { /* quota */ }
  }

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(ctx.patch, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${ctx.patch.name || 'apollo-patch'}.apollo.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const randomize = () => {
    const r = (a: number, b: number) => a + Math.random() * (b - a)
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
    ctx.update(p => {
      const tables = ['basic-shapes', 'analog-saws', 'pwm', 'harmonic-sweep', 'bells', 'vocal', 'fm-scan', 'squares-morph', 'sub-fold', 'reso-sweep', 'metallic']
      p.oscs[0].enabled = true
      p.oscs[0].engine = 'wavetable'
      p.oscs[0].wt.tableId = pick(tables)
      p.oscs[0].wt.pos = r(0, 1)
      p.oscs[0].unison = pick([1, 2, 3, 5, 7])
      p.oscs[0].detune = r(0.05, 0.3)
      const warps: WarpMode[] = ['off', 'sync', 'bendPlus', 'pwm', 'asym', 'mirror', 'squeeze', 'saturate']
      p.oscs[0].wt.warp1 = { mode: pick(warps), amount: r(0, 0.6) }
      p.filters[0].enabled = Math.random() > 0.25
      const ftypes: FilterType[] = ['lp12', 'lp24', 'ladder24', 'multiLBH', 'formant', 'combPlus', 'bp12']
      p.filters[0].type = pick(ftypes)
      p.filters[0].cutoff = r(0.3, 0.85)
      p.filters[0].res = r(0.05, 0.5)
      p.envs[0].attack = pick([0.002, 0.01, 0.3, 0.8])
      p.envs[0].release = r(0.1, 1.5)
      p.matrix = [
        { id: uid(), source: 'env2' as ModSource, dest: 'f1.cutoff', amount: r(0.2, 0.6), bipolar: false, aux: 'none', auxAmount: 0, curve: null, bypass: false },
        { id: uid(), source: 'lfo1' as ModSource, dest: 'osc0.wt.pos', amount: r(0.1, 0.5), bipolar: false, aux: 'none', auxAmount: 0, curve: null, bypass: false },
      ]
      const fxPool: FxType[] = ['chorus', 'delay', 'reverb', 'phaser', 'distortion']
      p.fxMain = [defaultFx(pick(fxPool)), defaultFx(pick(fxPool))]
      p.name = 'Random ' + Math.floor(Math.random() * 1000)
    })
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button style={navBtn} onClick={() => step(-1)} title="Previous preset">◀</button>
      <select
        value={currentIdx >= 0 ? String(currentIdx) : ''}
        onChange={e => { const k = Number(e.target.value); if (!Number.isNaN(k) && allPresets[k]) allPresets[k].load() }}
        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 11, width: 150 }}
      >
        <option value="" disabled>{ctx.patch.name || 'Presets…'}</option>
        <optgroup label="Factory">
          {allPresets.map((pr, k) => pr.group === 'Factory' && <option key={pr.name} value={String(k)}>{pr.name}</option>)}
        </optgroup>
        <optgroup label="User">
          {allPresets.map((pr, k) => pr.group === 'User' && <option key={pr.name + k} value={String(k)}>{pr.name}</option>)}
        </optgroup>
      </select>
      <button style={navBtn} onClick={() => step(1)} title="Next preset">▶</button>
      {editingName ? (
        <input
          autoFocus defaultValue={ctx.patch.name}
          onBlur={e => { setEditingName(false); const nm = e.target.value.trim(); if (nm) ctx.update(p => { p.name = nm }) }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={{ width: 120, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--accent)', borderRadius: 6, fontSize: 11, padding: '3px 6px' }}
        />
      ) : (
        <span
          onDoubleClick={() => setEditingName(true)}
          title="Double-click to rename"
          style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', cursor: 'text', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{ctx.patch.name}</span>
      )}
      <ToggleBtn on={false} label="Save" onClick={save} title="Save to browser presets" />
      <ToggleBtn on={false} label="Export" onClick={exportFile} />
      <ToggleBtn on={false} label="Import" onClick={() => fileRef.current?.click()} />
      <input
        ref={fileRef} type="file" accept=".json,.apollo.json,application/json" style={{ display: 'none' }}
        onChange={async e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try { applyPatch(JSON.parse(await f.text()) as Partial<ApolloPatch>) } catch { /* invalid file */ }
        }}
      />
      <ToggleBtn on={false} label="Init" onClick={() => applyPatch(initPatch())} />
      <ToggleBtn on={false} label="⟳ Random" onClick={randomize} />
    </div>
  )
}

const navBtn: React.CSSProperties = {
  background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
  borderRadius: 6, width: 22, height: 22, fontSize: 10, cursor: 'pointer', padding: 0,
}
