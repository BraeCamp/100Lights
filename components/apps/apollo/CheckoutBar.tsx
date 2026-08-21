'use client'

// The bar that appears when Apollo has custody of a Beacon track item.
//
// Check-out model (not live): Apollo owns the item while it is out. This bar
// is the visible answer to "where did this come from and how do I send it
// back", plus the monitor switch that lets you hear the item through the
// Beacon track's effects without those effects becoming yours to edit.

import { useCallback, useEffect, useState } from 'react'
import { useApollo, UI } from './ApolloContext'
import {
  readCheckout, writeCheckout, checkoutToClip, notesFromApollo,
  type ApolloCheckout,
} from '@/lib/apollo/checkout'
import type { FxUnit } from '@/lib/apollo/patch'

export default function CheckoutBar() {
  const ctx = useApollo()
  const [co, setCo] = useState<ApolloCheckout | null>(null)
  const [monitor, setMonitor] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // ── Arrival: adopt the item as this session's clip + sound ──
  useEffect(() => {
    if (hydrated) return
    const found = readCheckout()
    if (!found || found.returnedAt) { setHydrated(true); return }
    setCo(found)
    setHydrated(true)
    void (async () => {
      const clip = checkoutToClip(found)
      let patch = found.patch
      if (!patch && found.instrument) {
        // The track was on a legacy synth — translate it so the item arrives
        // sounding like it did in Beacon.
        try {
          const { translateInstrument } = await import('@/lib/apollo/daw-synth')
          patch = translateInstrument(found.instrument) as typeof patch
        } catch { patch = null }
      }
      ctx.update(d => {
        if (patch) Object.assign(d, JSON.parse(JSON.stringify(patch)))
        d.global.bpm = found.bpm
        d.clips = [clip, ...d.clips.filter(c => c.name !== clip.name)]
        d.activeClip = 0
        d.clipMode = true
      })
      ctx.engine.setTransport({ bpm: found.bpm })
      setStatus(`Checked out from ${found.projectName}`)
    })()
  }, [hydrated, ctx])

  // ── Monitor through the Beacon track's effects (read-only) ──
  // The units were translated in Beacon at check-out; applying them here is
  // purely for auditioning, and they are stripped again on check-in so they
  // never leak into the item's own sound.
  const toggleMonitor = useCallback(() => {
    if (!co?.monitorChain?.length) return
    const next = !monitor
    setMonitor(next)
    ctx.update(d => {
      // Monitoring occupies the main FX lane only; the item's own sound lives
      // in the oscillators/filters, so nothing of the item is displaced.
      d.fxMain = next
        ? (co.monitorChain as FxUnit[]).map(u => JSON.parse(JSON.stringify(u)))
        : []
    })
  }, [co, monitor, ctx])

  // ── Check in: notes + sound go home ──
  const checkIn = useCallback(() => {
    if (!co) return
    const patch = JSON.parse(JSON.stringify(ctx.patch))
    // Monitoring FX belong to the Beacon track, not to this item.
    if (monitor) patch.fxMain = []
    const clip = ctx.patch.clips[ctx.patch.activeClip] ?? ctx.patch.clips[0]
    writeCheckout({
      ...co,
      notes: clip?.notes ?? co.notes,
      lengthBeats: clip?.lengthBeats ?? co.lengthBeats,
      patch,
      instrument: null,
      returnedAt: new Date().toISOString(),
    })
    setStatus(`Checked in to ${co.projectName} — reopen that project to see it`)
    setCo(c => c ? { ...c, returnedAt: new Date().toISOString() } : c)
  }, [co, ctx, monitor])

  if (!co) return null
  const returned = !!co.returnedAt

  const btn = (on: boolean, accent?: string): React.CSSProperties => ({
    height: 22, padding: '0 9px', borderRadius: 5, cursor: 'pointer',
    fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
    background: on ? (accent ?? UI.blue) : UI.header,
    color: on ? '#0b0d10' : UI.dim,
    border: `1px solid ${on ? (accent ?? UI.blue) : UI.border}`,
  })

  return (
    <div data-apollo-checkout={returned ? 'returned' : 'out'} style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '6px 10px', borderRadius: 6,
      background: returned ? UI.header : 'rgba(74,169,255,0.10)',
      border: `1px solid ${returned ? UI.border : UI.blue}`,
    }}>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.2, color: returned ? UI.dim : UI.blue }}>
        {returned ? 'CHECKED IN' : 'CHECKED OUT'}
      </span>
      <span style={{ fontSize: 10.5, color: UI.text }}>
        {co.trackName} · {co.clipName}
        <span style={{ color: UI.dim }}> from {co.projectName}</span>
      </span>

      {!returned && (
        <>
          <button
            onClick={toggleMonitor}
            disabled={!co.monitorChain?.length}
            data-apollo-monitor={monitor ? 'on' : 'off'}
            title={co.monitorChain?.length
              ? "Hear the item through the Beacon track's effects. They are not part of this item and are not saved with it."
              : 'That track has no effects to monitor through'}
            style={{ ...btn(monitor), opacity: co.monitorChain?.length ? 1 : 0.4 }}
          >MONITOR FX</button>
          <button onClick={checkIn} data-apollo-checkin
            title="Send the notes and sound back to the Beacon track"
            style={btn(true, UI.green)}>CHECK IN ↩</button>
        </>
      )}
      {status && <span style={{ fontSize: 10, color: UI.dim }}>{status}</span>}
    </div>
  )
}
