'use client'
// ============================================================================
//  The track panel for a Beacon plugin.
//
//  Two states: nothing chosen yet (a picker), or a plugin loaded (controls
//  generated from its manifest). A plugin that declares its own UI gets an
//  iframe instead; everything else gets this, which is why the manifest's
//  parameter descriptions carry group, unit and curve.
// ============================================================================

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import Knob from './Knob'
import { useDaw } from '@/lib/daw-state'
import type { TrackInstrument } from '@/lib/daw-types'
import {
  formatParam, mergeValues, normToParam, paramToNorm,
  type PluginDescriptor, type PluginInstrumentParams, type PluginParam, type PluginParamValue,
} from '@/lib/beacon-plugins/types'
import {
  addPluginUrl, listPlugins, onRegistryChanged, removePluginUrl, rescan,
} from '@/lib/beacon-plugins/registry'

const C = {
  bgSurface:   '#1c1c1c',
  bgCard:      '#222222',
  border:      'var(--border)',
  accent:      'var(--accent)',
  textPrimary: '#e8e8e8',
  textMuted:   '#7c7c7c',
  warn:        '#e0b34a',
} as const

// ---------------------------------------------------------------------------

const SourceBadge = memo(function SourceBadge({ d }: { d: PluginDescriptor }) {
  const label = d.source === 'bridge' ? (d.nativeFormat ?? 'Native')
    : d.source === 'url' ? 'Added' : 'Built in'
  const tone = d.source === 'bridge' ? C.accent : C.textMuted
  return (
    <span style={{
      fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase',
      color: tone, border: `1px solid ${tone}`, borderRadius: 3,
      padding: '1px 4px', opacity: 0.85, flexShrink: 0,
    }}>{label}</span>
  )
})

// ---------------------------------------------------------------------------

const ParamControl = memo(function ParamControl({ param, value, onChange }: {
  param: PluginParam
  value: PluginParamValue
  onChange: (v: PluginParamValue) => void
}) {
  if (param.kind === 'bool') {
    const on = Boolean(value)
    return (
      <button
        onClick={() => onChange(!on)}
        title={param.tooltip}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none',
          border: 'none', cursor: 'pointer', padding: '3px 0', width: '100%', textAlign: 'left',
        }}
      >
        <span style={{
          width: 26, height: 14, borderRadius: 7, flexShrink: 0,
          background: on ? C.accent : '#333',
          border: `1px solid ${on ? C.accent : '#444'}`,
          position: 'relative', transition: 'background 120ms',
        }}>
          <span style={{
            position: 'absolute', top: 1, left: on ? 13 : 1,
            width: 10, height: 10, borderRadius: 5, background: on ? '#1a1a1a' : '#888',
            transition: 'left 120ms',
          }} />
        </span>
        <span style={{ fontSize: 11, color: on ? C.textPrimary : C.textMuted }}>{param.name}</span>
      </button>
    )
  }

  if (param.kind === 'choice') {
    return (
      <label style={{ display: 'block', padding: '2px 0' }} title={param.tooltip}>
        <span style={{ display: 'block', fontSize: 10, color: C.textMuted, marginBottom: 2 }}>
          {param.name}
        </span>
        <select
          value={Number(value)}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: '100%', background: '#141414', color: C.textPrimary,
            border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11, padding: '3px 4px',
          }}
        >
          {param.choices.map((c, i) => <option key={c + i} value={i}>{c}</option>)}
        </select>
      </label>
    )
  }

  // float / int -> knob, positioned through the parameter's own curve so a
  // log frequency control feels right rather than bunching at the bottom.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
         title={param.tooltip}>
      <span style={{ fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap' }}>{param.name}</span>
      <Knob
        value={paramToNorm(param, value)}
        min={0}
        max={1}
        defaultValue={paramToNorm(param, param.default)}
        size={30}
        color={C.accent}
        bipolar={param.min < 0 && param.max > 0}
        onChange={n => onChange(normToParam(param, n))}
        format={() => formatParam(param, value)}
      />
      <span style={{
        fontSize: 10, color: C.textPrimary, fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}>
        {formatParam(param, value)}
      </span>
    </div>
  )
})

// ---------------------------------------------------------------------------

const Picker = memo(function Picker({ onPick }: { onPick: (d: PluginDescriptor) => void }) {
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => {
    void listPlugins().then(setPlugins)
  }, [])

  useEffect(() => {
    refresh()
    return onRegistryChanged(refresh)
  }, [refresh])

  const add = useCallback(async () => {
    if (!url.trim()) return
    setBusy(true)
    const d = await addPluginUrl(url.trim())
    setBusy(false)
    if (d.error) setMessage(d.error)
    else { setMessage(''); setUrl(''); refresh() }
  }, [url, refresh])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {plugins.length === 0 && (
          <div style={{ fontSize: 11, color: C.textMuted }}>Looking for plugins…</div>
        )}
        {plugins.map(d => (
          <button
            key={d.id + d.baseUrl}
            disabled={Boolean(d.error)}
            onClick={() => onPick(d)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 5,
              padding: '6px 8px', cursor: d.error ? 'default' : 'pointer',
              opacity: d.error ? 0.5 : 1, textAlign: 'left',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, color: C.textPrimary }}>{d.name}</span>
              <span style={{ display: 'block', fontSize: 10, color: d.error ? C.warn : C.textMuted }}>
                {d.error ?? `${d.vendor}${d.version ? ' · ' + d.version : ''}`}
              </span>
            </span>
            <SourceBadge d={d} />
            {d.source === 'url' && (
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); removePluginUrl(d.baseUrl + 'beacon-plugin.json'); rescan() }}
                onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); removePluginUrl(d.baseUrl + 'beacon-plugin.json'); rescan() } }}
                style={{ fontSize: 10, color: C.textMuted, cursor: 'pointer', padding: '0 2px' }}
              >remove</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add() }}
          placeholder="add a plugin by manifest URL"
          style={{
            flex: 1, background: '#141414', color: C.textPrimary, fontSize: 11,
            border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px',
          }}
        />
        <button
          onClick={() => void add()}
          disabled={busy}
          style={{
            background: C.bgCard, color: C.textPrimary, fontSize: 11,
            border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
          }}
        >Add</button>
      </div>

      {message && <div style={{ fontSize: 10, color: C.warn }}>{message}</div>}
    </div>
  )
})

// ---------------------------------------------------------------------------

export default memo(function PluginPanel({ trackId, instrument }: {
  trackId: string
  instrument: TrackInstrument
}) {
  const { dispatch, engine } = useDaw()
  const params = instrument.params as PluginInstrumentParams
  const [descriptor, setDescriptor] = useState<PluginDescriptor | null>(null)

  useEffect(() => {
    if (!params.pluginId) { setDescriptor(null); return }
    let cancelled = false
    void listPlugins().then(all => {
      if (!cancelled) setDescriptor(all.find(p => p.id === params.pluginId) ?? null)
    })
    return () => { cancelled = true }
  }, [params.pluginId])

  const manifest = descriptor?.manifest ?? null

  const values = useMemo(
    () => (manifest ? mergeValues(manifest, params.values) : {}),
    [manifest, params.values],
  )

  const groups = useMemo(() => {
    if (!manifest) return []
    const byGroup = new Map<string, PluginParam[]>()
    for (const p of manifest.parameters) {
      const g = p.group ?? 'Parameters'
      const list = byGroup.get(g)
      if (list) list.push(p)
      else byGroup.set(g, [p])
    }
    return [...byGroup.entries()]
  }, [manifest])

  const choose = useCallback((d: PluginDescriptor) => {
    const next: PluginInstrumentParams = {
      pluginId: d.id,
      values: {},
      displayName: d.name,
    }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'plugin', params: next } })
  }, [dispatch, trackId])

  const setValue = useCallback((id: string, value: PluginParamValue) => {
    // Heard immediately on a sustaining note...
    engine?.setPluginParamLive(trackId, id, value)
    // ...and remembered in the project.
    const next: PluginInstrumentParams = {
      ...params,
      values: { ...params.values, [id]: value },
    }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'plugin', params: next } })
  }, [dispatch, engine, params, trackId])

  const loadPreset = useCallback((name: string) => {
    const preset = manifest?.presets?.find(p => p.name === name)
    if (!preset) return
    const next: PluginInstrumentParams = { ...params, values: { ...preset.values } }
    dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'plugin', params: next } })
  }, [dispatch, manifest, params, trackId])

  if (!params.pluginId) {
    return (
      <div style={{ padding: 8 }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>
          Choose a plugin for this track.
        </div>
        <Picker onPick={choose} />
      </div>
    )
  }

  if (!descriptor) {
    return (
      <div style={{ padding: 8, fontSize: 11, color: C.textMuted }}>
        Loading {params.displayName ?? params.pluginId}…
      </div>
    )
  }

  if (descriptor.error || !manifest) {
    return (
      <div style={{ padding: 8 }}>
        <div style={{ fontSize: 11, color: C.warn, marginBottom: 8 }}>
          {params.displayName ?? params.pluginId} could not be loaded.
          <br />
          {descriptor.error}
        </div>
        <Picker onPick={choose} />
      </div>
    )
  }

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12, color: C.textPrimary }}>{manifest.name}</span>
          <span style={{ display: 'block', fontSize: 10, color: C.textMuted }}>
            {manifest.vendor} · {manifest.version}
          </span>
        </span>
        <SourceBadge d={descriptor} />
        <button
          onClick={() => dispatch({
            type: 'SET_INSTRUMENT', trackId,
            instrument: { type: 'plugin', params: { pluginId: '', values: {} } },
          })}
          style={{
            background: 'none', border: `1px solid ${C.border}`, borderRadius: 4,
            color: C.textMuted, fontSize: 10, padding: '2px 6px', cursor: 'pointer',
          }}
        >Change</button>
      </div>

      {manifest.presets && manifest.presets.length > 0 && (
        <select
          defaultValue=""
          onChange={e => { loadPreset(e.target.value); e.currentTarget.value = '' }}
          style={{
            background: '#141414', color: C.textPrimary, fontSize: 11,
            border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px',
          }}
        >
          <option value="" disabled>Load a preset…</option>
          {manifest.presets.map(p => (
            <option key={p.name} value={p.name}>
              {p.category ? `${p.category} — ${p.name}` : p.name}
            </option>
          ))}
        </select>
      )}

      {groups.map(([group, list]) => (
        <div key={group}>
          <div style={{
            fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase',
            color: C.textMuted, marginBottom: 4,
          }}>{group}</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
            gap: 6, alignItems: 'start',
          }}>
            {list.map(p => (
              <ParamControl
                key={p.id}
                param={p}
                value={values[p.id]}
                onChange={v => setValue(p.id, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})
