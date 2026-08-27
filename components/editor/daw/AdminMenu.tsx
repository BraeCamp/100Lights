'use client'

import { useEffect, useRef, useState } from 'react'
import { useIsAdmin } from '@/lib/use-is-admin'

/**
 * Admin-only tools, in the studio, for the person who owns it.
 *
 * Brae, after being asked to run window.__dawDiagnose() from the browser
 * console: "Can you add a button to run diagnose?" Fair — a console incantation
 * is a bad way to capture a fault you are already annoyed by, and the moment it
 * happens is the worst moment to be looking up syntax.
 *
 * Rendered for nobody else. The gate is an email match rather than the /admin
 * cookie: this only reads meters and clocks, and requiring a second login to
 * read a level meter would mean it never gets used at the moment it is needed.
 */

type DiagnoseApi = (() => string) & {
  report: () => unknown
  stop: () => void
}

export default function AdminMenu() {
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  const [watching, setWatching] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [since, setSince] = useState<number | null>(null)
  const [, force] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  // Tick the elapsed readout while watching, so it is obvious the thing is
  // running — a menu that says "watching" and never changes looks stuck.
  useEffect(() => {
    if (!watching) return
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [watching])

  if (!isAdmin) return null

  const api = () => (window as unknown as { __dawDiagnose?: DiagnoseApi }).__dawDiagnose
  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(null), 4000) }

  const start = () => {
    const d = api()
    if (!d) { flash('Diagnostics not available on this page'); return }
    d()
    setWatching(true)
    setSince(Date.now())
    flash('Watching — now play the part that misbehaves')
    setOpen(false)
  }

  const copyReport = async () => {
    const d = api()
    if (!d) { flash('Diagnostics not available on this page'); return }
    const report = d.report()
    const text = typeof report === 'string' ? report : JSON.stringify(report, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      flash('Report copied — paste it to Claude')
    } catch {
      // Clipboard access can be refused (permissions, an insecure origin). The
      // report is the whole point of the button, so it must still be reachable
      // rather than lost to a failed copy.
      console.log(text)   // eslint-disable-line no-console
      flash('Clipboard blocked — the report is in the browser console')
    }
    setOpen(false)
  }

  const stop = () => {
    api()?.stop()
    setWatching(false)
    setSince(null)
    flash('Stopped watching')
    setOpen(false)
  }

  const elapsed = since ? Math.round((Date.now() - since) / 1000) : 0

  const item: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '7px 10px', borderRadius: 6, background: 'none', border: 'none',
    color: 'var(--text-primary)', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap',
  }
  const head: React.CSSProperties = {
    fontSize: 8.5, fontWeight: 800, letterSpacing: 1, color: 'var(--text-muted)',
    textTransform: 'uppercase', padding: '6px 10px 2px',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        data-help-id="admin-menu"
        data-admin-menu
        title="Admin tools (only you can see this)"
        style={{
          height: 26, width: 'auto', padding: '0 9px', borderRadius: 6,
          fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: watching ? 'color-mix(in srgb, #e0a03a 22%, transparent)' : 'var(--bg-card)',
          border: `1px solid ${watching ? '#e0a03a' : 'var(--border)'}`,
          color: watching ? '#e0a03a' : 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        {/* A dot while watching, because the menu is usually closed and there
            has to be something on screen saying a capture is running. */}
        {watching && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#e0a03a' }} />}
        ADMIN{watching ? ` ${elapsed}s` : ''}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 30, right: 0, zIndex: 1000, minWidth: 210,
            padding: 4, borderRadius: 9,
            background: 'var(--bg-elevated, var(--bg-base))',
            border: '1px solid var(--border)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}
        >
          <div style={head}>Playback diagnostics</div>
          {!watching ? (
            <button style={item} onClick={start}>Start watching</button>
          ) : (
            <>
              <button style={item} onClick={copyReport}>Copy report ({elapsed}s)</button>
              <button style={{ ...item, color: 'var(--text-secondary)' }} onClick={stop}>Stop watching</button>
            </>
          )}
          <div style={{ ...head, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 10, padding: '4px 10px 7px', whiteSpace: 'normal', lineHeight: 1.45 }}>
            {watching
              ? 'Play the part that goes wrong, then copy the report.'
              : 'Start this, then play the part that goes wrong.'}
          </div>
        </div>
      )}

      {note && (
        <div
          style={{
            position: 'absolute', top: 30, right: 0, zIndex: 1001,
            padding: '6px 10px', borderRadius: 7, fontSize: 10.5, whiteSpace: 'nowrap',
            background: 'var(--bg-elevated, var(--bg-base))',
            border: '1px solid var(--border)', color: 'var(--text-secondary)',
          }}
        >
          {note}
        </div>
      )}
    </div>
  )
}
