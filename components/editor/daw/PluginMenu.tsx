'use client'
// ============================================================================
//  The Plugin menu — one place to choose what makes this track's sound.
//
//  Apollo used to be its own button beside a separate "Plugin" button, which
//  said the wrong thing about both: Apollo IS Beacon's instrument plugin, and a
//  player looking for "the synth" should not have to know which of two buttons
//  the built-in one hides behind. So there is one control, Apollo sits at the
//  top of it, and everything else the registry knows about follows.
//
//  Sources, in the order they appear:
//    Apollo    built in, always present, never fails to load
//    web       plugins under /plugins/<id>/ and any manifest URL the user added
//    bridge    real AU/VST3/CLAP reported by the Beacon Bridge
//    + Add Plugin…  paste a manifest URL; remembered locally, appears above
//
//  A plugin that failed to load is shown greyed with its reason rather than
//  omitted — the registry goes out of its way to keep those descriptors, and
//  "my synth vanished" is a far worse bug report than "my synth needs a newer
//  Beacon".
// ============================================================================

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, AlertTriangle, Trash2 } from 'lucide-react'
import {
  addPluginUrl, listPlugins, onRegistryChanged, removePluginUrl, getUserPluginUrls, baseOf,
} from '@/lib/beacon-plugins/registry'
import type { PluginDescriptor } from '@/lib/beacon-plugins/types'
import type { TrackInstrument } from '@/lib/daw-types'

const C = {
  bgSurface: '#1c1c1c',
  bgCard: '#222222',
  border: 'var(--border)',
  accent: 'var(--accent)',
  textPrimary: '#e8e8e8',
  textMuted: '#7c7c7c',
} as const

/** Apollo is not in the registry — it is the host, not a guest — so it gets a
 *  descriptor-shaped entry here and is pinned above everything else. */
const APOLLO_ROW = { id: '__apollo__', name: 'Apollo', vendor: '100Lights', note: 'built-in' }

export type PluginMenuProps = {
  /** Toolbar styling, so the same menu can sit in the transport bar where the
   *  Apollo button used to be, without a second copy of this component. */
  buttonStyle?: React.CSSProperties
  /** Shown when nothing is chosen. The transport says APOLLO, because that is
   *  what that button has always said and what it still opens. */
  fallbackLabel?: string
  /** Current instrument type on the track, so the button can show what is on.
   *  Undefined while a track is mid-delete — the picker keeps rendering. */
  instrType?: string
  instrument?: TrackInstrument
  onPickApollo: () => void
  onPickPlugin: (d: PluginDescriptor) => void
}

export default memo(function PluginMenu({
  instrType, instrument, onPickApollo, onPickPlugin, buttonStyle, fallbackLabel,
}: PluginMenuProps) {
  const [open, setOpen] = useState(false)
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const wrap = useRef<HTMLDivElement>(null)

  // The registry rescans when the bridge connects or the user adds a URL, so
  // the list has to be able to change while the menu is open.
  useEffect(() => {
    let cancelled = false
    const load = () => { void listPlugins().then(p => { if (!cancelled) setPlugins(p) }) }
    load()
    const off = onRegistryChanged(load)
    return () => { cancelled = true; off() }
  }, [])

  // Close on an outside click or Escape — a menu you cannot dismiss without
  // choosing something is a trap.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setErr('') } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const { web, bridge } = useMemo(() => ({
    web: plugins.filter(p => p.source !== 'bridge'),
    bridge: plugins.filter(p => p.source === 'bridge'),
  }), [plugins])

  // A descriptor does not carry the URL it came from, only the folder that URL
  // lives in — so the way back to "which stored URL is this?" is that folder.
  // Only `source: 'url'` plugins are the user's to forget; built-ins and bridge
  // plugins are not ours to remove from here.
  const urlByBase = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of getUserPluginUrls()) {
      try { m.set(baseOf(new URL(u, window.location.origin).toString()), u) } catch { m.set(baseOf(u), u) }
    }
    return m
  }, [plugins])

  // `params` is a union across every instrument type and `type` does not narrow
  // it, so the plugin fields are read by presence rather than by cast.
  const params = instrument?.params as { pluginId?: string; displayName?: string } | undefined
  const currentPluginId = instrType === 'plugin' ? (params?.pluginId ?? '') : ''

  const current = instrType === 'apollo'
    ? APOLLO_ROW.name
    : instrType === 'plugin'
      ? (params?.displayName || currentPluginId || 'Plugin')
      : ''

  const addPlugin = useCallback(async () => {
    // A manifest URL is the whole integration story for a web plugin: the
    // registry fetches it, validates it, and remembers the URL locally.
    const url = window.prompt(
      'Add a plugin\n\nPaste the URL of its beacon-plugin.json manifest.',
      'https://',
    )
    if (!url || !url.trim() || url.trim() === 'https://') return
    setBusy('Adding…'); setErr('')
    try {
      const d = await addPluginUrl(url.trim())
      setBusy('')
      if (d.error) { setErr(`${d.name || 'That plugin'}: ${d.error}`); return }
      onPickPlugin(d)
      setOpen(false)
    } catch (e) {
      setBusy('')
      setErr(e instanceof Error ? e.message : 'That URL did not return a usable plugin manifest.')
    }
  }, [onPickPlugin])

  const forget = useCallback((url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removePluginUrl(url)
  }, [])

  const active = instrType === 'apollo' || instrType === 'plugin'

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); setErr('') }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose the instrument plugin for this track — Apollo, a Beacon plugin, or your own"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 4,
          border: `1px solid ${active ? C.accent : C.border}`,
          background: active ? `${C.accent}22` : C.bgCard,
          color: active ? C.accent : C.textMuted,
          fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer',
          ...buttonStyle,
        }}
      >
        {current || fallbackLabel || 'Plugin'}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 60,
            minWidth: 250, maxHeight: 340, overflowY: 'auto',
            background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)', padding: 4,
          }}
        >
          <Row
            label={APOLLO_ROW.name}
            note={APOLLO_ROW.note}
            active={instrType === 'apollo'}
            onClick={() => { onPickApollo(); setOpen(false) }}
          />

          {web.length > 0 && <Divider />}
          {web.map(p => (
            <Row
              key={p.id}
              label={p.name || p.id}
              note={p.error ? 'unavailable' : (p.vendor || 'web')}
              error={p.error}
              active={currentPluginId === p.id}
              onClick={() => { if (!p.error) { onPickPlugin(p); setOpen(false) } }}
              onForget={p.source === 'url' && urlByBase.has(p.baseUrl)
                ? e => forget(urlByBase.get(p.baseUrl)!, e) : undefined}
            />
          ))}

          {bridge.length > 0 && <Divider />}
          {bridge.map(p => (
            <Row
              key={p.id}
              label={p.name || p.id}
              note={p.nativeFormat ?? 'bridge'}
              error={p.error}
              active={currentPluginId === p.id}
              onClick={() => { if (!p.error) { onPickPlugin(p); setOpen(false) } }}
            />
          ))}

          <Divider />
          <button
            role="menuitem"
            onClick={e => { e.stopPropagation(); void addPlugin() }}
            disabled={!!busy}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 8px', borderRadius: 4, border: 'none', background: 'transparent',
              color: C.accent, fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}18` }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <Plus size={13} />{busy || 'Add Plugin…'}
          </button>

          {err && (
            <div style={{
              display: 'flex', gap: 6, alignItems: 'flex-start',
              padding: '6px 8px', margin: '2px 4px 4px', borderRadius: 4,
              background: '#3a1d1d', color: '#ffb4b4', fontSize: 11, lineHeight: 1.35,
            }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{err}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

function Divider() {
  return <div style={{ height: 1, background: C.border, margin: '4px 6px' }} />
}

function Row({ label, note, active, error, onClick, onForget }: {
  label: string
  note?: string
  active?: boolean
  error?: string
  onClick: () => void
  onForget?: (e: React.MouseEvent) => void
}) {
  return (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      title={error || undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 8px', borderRadius: 4, cursor: error ? 'not-allowed' : 'pointer',
        background: active ? `${C.accent}22` : 'transparent',
        color: error ? C.textMuted : (active ? C.accent : C.textPrimary),
        opacity: error ? 0.6 : 1,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#2a2a2a' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        flex: 1, fontSize: 12, fontWeight: active ? 600 : 400,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
      {error && <AlertTriangle size={11} style={{ flexShrink: 0, color: '#c98a8a' }} />}
      {note && (
        <span style={{ flexShrink: 0, fontSize: 10, color: C.textMuted, letterSpacing: 0.3 }}>{note}</span>
      )}
      {onForget && (
        <button
          onClick={onForget}
          title="Forget this plugin"
          style={{
            flexShrink: 0, display: 'inline-flex', padding: 2, border: 'none',
            background: 'transparent', color: C.textMuted, cursor: 'pointer',
          }}
        ><Trash2 size={11} /></button>
      )}
    </div>
  )
}
