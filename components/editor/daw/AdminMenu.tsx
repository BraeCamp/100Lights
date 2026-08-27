'use client'

import { useEffect, useRef, useState } from 'react'
import { useIsAdmin } from '@/lib/use-is-admin'
import { useDaw } from '@/lib/daw-state'
import { buildInfo } from '@/lib/build-info'
import { clearCombinedEverywhere, combineStats } from '@/lib/apollo/freeze-cache'

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
  hasReport: () => boolean
}

export default function AdminMenu() {
  const isAdmin = useIsAdmin()
  const { engine, project } = useDaw()
  const [open, setOpen] = useState(false)
  const [watching, setWatching] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [since, setSince] = useState<number | null>(null)
  // A finished capture nobody has replaced yet is still worth copying.
  const [keptReport, setKeptReport] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
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
  // Elapsed lives in state rather than being read from the clock while
  // rendering: Date.now() during render is impure, and React is entitled to
  // render whenever it likes.
  useEffect(() => {
    if (!watching || !since) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - since) / 1000)), 1000)
    return () => clearInterval(t)
  }, [watching, since])

  if (!isAdmin) return null

  const api = () => (window as unknown as { __dawDiagnose?: DiagnoseApi }).__dawDiagnose
  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(null), 4000) }

  const start = () => {
    const d = api()
    if (!d) { flash('Diagnostics not available on this page'); return }
    d()
    setWatching(true)
    setKeptReport(false)
    setElapsed(0)
    setSince(Date.now())
    flash('Watching — now play the part that misbehaves')
    setOpen(false)
  }

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flash(`${what} copied`)
    } catch {
      console.log(text)    
      flash('Clipboard blocked — it is in the browser console')
    }
    setOpen(false)
  }

  const copyReport = () => {
    const d = api()
    if (!d) { flash('Diagnostics not available on this page'); return }
    const report = d.report()
    return copyText(
      typeof report === 'string' ? report : JSON.stringify(report, null, 2),
      'Report',
    )
  }

  const stop = () => {
    api()?.stop()
    setWatching(false)
    // Keep offering the copy. Stopping and THEN deciding to send the report is
    // the natural order, and throwing it away at stop lost the very thing you
    // stopped to look at. It clears when a new capture starts.
    setKeptReport(!!api()?.hasReport())
    flash('Stopped — the report is still here to copy')
    setOpen(false)
  }

  const copyBuild = () => copyText(JSON.stringify({
    ...buildInfo(),
    renderCache: combineStats(),
    project: { name: project.name, tempo: project.tempo, tracks: project.tracks.length },
  }, null, 2), 'Build info')

  const clearCache = async () => {
    setBusy('clear')
    await clearCombinedEverywhere()
    setBusy(null)
    flash('Render cache cleared — the next play is a cold one')
    setOpen(false)
  }

  const bounceWav = async () => {
    if (!engine) { flash('No engine on this page'); return }
    setBusy('bounce')
    setOpen(false)
    // Say what is about to happen. renderWav is an offline render, and Chrome
    // runs those on the MAIN THREAD when they carry JS worklets — so on a long
    // song the studio genuinely stops responding until it finishes. Silently
    // freezing looks like a crash; a warned wait is just a wait.
    flash('Bouncing the whole song — the studio will freeze until it finishes')
    try {
      const out = await engine.renderWav({})
      // renderWav hands back base64; turn it into a file rather than making
      // anyone deal with a data URL by hand.
      const bin = atob(out.master)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${(project.name || 'mix').replace(/[^\w -]+/g, '')}.wav`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      flash(`Bounced ${out.durationSec.toFixed(1)}s — check your downloads`)
    } catch (err) {
      flash(`Bounce failed: ${(err as Error).message.slice(0, 60)}`)
    } finally {
      setBusy(null)
    }
  }

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
            <>
              <button style={item} onClick={start}>Start watching</button>
              {/* The capture you just stopped is still here. It disappears when
                  a new one starts, not the moment you stop looking at it. */}
              {keptReport && (
                <button style={item} onClick={copyReport}>Copy last report</button>
              )}
            </>
          ) : (
            <>
              <button style={item} onClick={copyReport}>Copy report ({elapsed}s)</button>
              <button style={{ ...item, color: 'var(--text-secondary)' }} onClick={stop}>Stop watching</button>
            </>
          )}
          <div style={{ ...head, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 10, padding: '4px 10px 7px', whiteSpace: 'normal', lineHeight: 1.45 }}>
            {watching
              ? 'Play the part that goes wrong, then copy the report.'
              : keptReport
                ? 'Stopped. The last capture is still here until you start another.'
                : 'Start this, then play the part that goes wrong.'}
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
          <div style={head}>Sound</div>
          <button style={item} onClick={clearCache} disabled={busy === 'clear'}>
            {busy === 'clear' ? 'Clearing…' : 'Clear render cache'}
          </button>
          <button style={item} onClick={bounceWav} disabled={busy === 'bounce'}>
            {busy === 'bounce' ? 'Bouncing…' : 'Bounce mix to WAV'}
          </button>
          <div style={{ ...head, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 9.5, padding: '0 10px 6px', whiteSpace: 'normal', lineHeight: 1.4 }}>
            Renders offline — a long song will freeze the studio while it works.
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
          <div style={head}>About this build</div>
          <button style={item} onClick={copyBuild}>Copy build info</button>
          <div style={{ ...head, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 9.5, padding: '2px 10px 7px', whiteSpace: 'normal' }}>
            {String(buildInfo().commit)} · {String(buildInfo().deployment)}
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
