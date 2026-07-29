'use client'

/**
 * Detachable "Build history" controls. Opened via window.open() from the studio
 * (the History panel's "Pop out" button) — in the desktop app it becomes a real
 * OS window you can drag to another monitor. It holds no DAW state itself: it
 * mirrors the studio's history and drives it entirely over postMessage, so the
 * main window stays the single source of truth.
 */

import { useEffect, useRef, useState } from 'react'

type Step = { icon: string; text: string; where: string }
const SPEEDS = [0.5, 1, 2, 4]
const C = {
  bg: '#14121a', card: '#1c1a24', border: '#332f40', text: '#ece9f5',
  muted: '#847f98', sub: '#bcb7cd', accent: '#7c3aed', green: '#059669',
}

export default function HistoryControlPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [total, setTotal] = useState(0)
  const [step, setStep] = useState(0)
  const [autoPlay, setAutoPlay] = useState(false)
  const [listening, setListening] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [connected, setConnected] = useState(false)
  const [noOpener, setNoOpener] = useState(false)
  const openerRef = useRef<Window | null>(null)

  useEffect(() => {
    const opener = window.opener as Window | null
    if (!opener) { setNoOpener(true); return }
    openerRef.current = opener
    const post = (msg: Record<string, unknown>) => { try { opener.postMessage({ __lightsHistory: true, ...msg }, location.origin) } catch { /* opener gone */ } }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return
      const d = e.data as Record<string, unknown> | null
      if (!d || !d.__lightsHistory) return
      if (d.type === 'init') {
        setSteps((d.steps as Step[]) || []); setTotal((d.total as number) || 0)
        setStep((d.step as number) ?? (d.total as number) ?? 0); setSpeed((d.speed as number) ?? 1)
        setAutoPlay(!!d.autoPlay); setListening(!!d.listening); setConnected(true)
      } else if (d.type === 'state') {
        if (d.step != null) setStep(d.step as number)
        if (d.autoPlay != null) setAutoPlay(d.autoPlay as boolean)
        if (d.listening != null) setListening(d.listening as boolean)
        if (d.total != null) setTotal(d.total as number)
        if (d.steps) setSteps(d.steps as Step[])
      }
    }
    window.addEventListener('message', onMsg)
    post({ cmd: 'ready' })
    const onUnload = () => post({ cmd: 'closed' })
    window.addEventListener('beforeunload', onUnload)
    document.title = 'Build history'
    return () => { window.removeEventListener('message', onMsg); window.removeEventListener('beforeunload', onUnload) }
  }, [])

  const send = (msg: Record<string, unknown>) => { try { openerRef.current?.postMessage({ __lightsHistory: true, ...msg }, location.origin) } catch { /* opener gone */ } }
  const desc = step > 0 ? steps[step - 1] : null

  const shell: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2147483000, background: C.bg, color: C.text,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    display: 'flex', flexDirection: 'column', padding: '16px 18px', gap: 10, boxSizing: 'border-box',
  }
  const ctrl: React.CSSProperties = {
    height: 38, minWidth: 42, borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent',
    color: C.text, fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  if (noOpener) return (
    <div style={shell}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>Build history</div>
      <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.6, marginTop: 8 }}>
        Open this from the studio — the <b>Build history</b> panel&rsquo;s <b>⧉ Pop out</b> button. On the
        desktop app it becomes a window you can drag to another screen.
      </p>
    </div>
  )

  return (
    <div style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Build history</span>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: connected ? C.green : C.muted }} />
        <span style={{ fontSize: 10.5, color: C.muted }}>{connected ? 'linked to studio' : 'connecting…'}</span>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: C.muted, flexShrink: 0 }}>{step}/{total}</span>
          <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {desc ? `${desc.icon} ${desc.text}` : (step === 0 ? 'empty project' : 'finished ✓')}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, height: 16, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {desc ? `↳ ${desc.where}` : ''}
        </div>
      </div>

      <input type="range" min={0} max={total} step={1} value={step}
        onChange={e => { const v = Number(e.target.value); setStep(v); setAutoPlay(false); send({ cmd: 'scrubTo', step: v }) }}
        style={{ width: '100%', accentColor: C.accent, cursor: 'pointer', height: 22 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 'auto' }}>
        <button style={ctrl} title="Previous edit" onClick={() => { setAutoPlay(false); send({ cmd: 'prev' }) }}>◀</button>
        <button style={{ ...ctrl, flex: 1, background: C.accent, color: '#fff', border: 'none' }}
          onClick={() => { const p = !autoPlay; setAutoPlay(p); send({ cmd: p ? 'play' : 'pause' }) }}>{autoPlay ? '⏸ Pause' : '▶ Play'}</button>
        <button style={ctrl} title="Next edit" onClick={() => { setAutoPlay(false); send({ cmd: 'next' }) }}>▶</button>
        <select value={speed} title="Speed" onChange={e => { const s = Number(e.target.value); setSpeed(s); send({ cmd: 'setSpeed', speed: s }) }}
          style={{ ...ctrl, width: 'auto', padding: '0 8px', cursor: 'pointer' }}>
          {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
        </select>
        <button style={{ ...ctrl, background: listening ? C.green : 'transparent', color: listening ? '#fff' : C.text, border: listening ? 'none' : `1px solid ${C.border}` }}
          title="Listen to this version" onClick={() => { const l = !listening; setListening(l); send({ cmd: l ? 'listen' : 'stopListen' }) }}>{listening ? '■' : '♪'}</button>
      </div>

      <button onClick={() => send({ cmd: 'consolidate' })}
        title="Merge repeated tweaks of the same control into their final value"
        style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}>
        ⤳ Consolidate
      </button>
    </div>
  )
}
