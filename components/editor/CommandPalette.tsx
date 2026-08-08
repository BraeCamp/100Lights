'use client'

// ⌘K / Ctrl-K command palette for the editor. A searchable overlay that runs
// any registered command (see lib/commands.ts) — a keyboard-first way to trigger
// existing editor actions and navigate a feature-dense UI.
//
// Open: ⌘K / Ctrl-K (verified free in the editor), or ⌘/Ctrl-Shift-P as a
// fallback. Close: Esc / click-out. Filter: case-insensitive substring over
// label + keywords. Nav: ↑/↓ (wrap), Enter runs the highlighted command then
// closes; click runs too. Renders nothing when closed.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCommands, type Command } from '@/lib/commands'

export default function CommandPalette() {
  const commands = useCommands()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Global open/close shortcut ────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'p') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Reset + focus each time it opens.
  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [open])

  // ── Filter (label + keywords, respecting `when`) ──────────
  const filtered = useMemo<Command[]>(() => {
    const term = q.trim().toLowerCase()
    return commands.filter(c => {
      if (c.when && !c.when()) return false
      if (!term) return true
      return `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(term)
    })
  }, [commands, q])

  // Keep the highlight in range as the list shrinks.
  useEffect(() => {
    if (active >= filtered.length) setActive(0)
  }, [filtered.length, active])

  function run(cmd: Command | undefined) {
    if (!cmd) return
    setOpen(false)
    try {
      cmd.run()
    } catch (err) {
      console.error('[command-palette]', cmd.id, err)
    }
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(a => (filtered.length ? (a + 1) % filtered.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => (filtered.length ? (a - 1 + filtered.length) % filtered.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(filtered[active])
    }
  }

  if (!open) return null

  // Group while keeping a flat index so keyboard nav lines up with render order.
  const groups: { group: string; items: { cmd: Command; index: number }[] }[] = []
  filtered.forEach((cmd, index) => {
    const g = cmd.group || 'Commands'
    let bucket = groups.find(b => b.group === g)
    if (!bucket) { bucket = { group: g, items: [] }; groups.push(bucket) }
    bucket.items.push({ cmd, index })
  })

  return (
    <div
      className="electron-nodrag"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh', paddingLeft: 16, paddingRight: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '100%',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', maxHeight: '70vh',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>⌘K</span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => { setQ(e.target.value); setActive(0) }}
            onKeyDown={onInputKey}
            placeholder="Type a command or search…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 15, minWidth: 0 }}
          />
          <kbd style={{ fontSize: 10, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>esc</kbd>
        </div>

        <div style={{ overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '18px 12px', fontSize: 13, color: 'var(--text-muted)' }}>No matching commands.</div>
          )}
          {groups.map(bucket => (
            <div key={bucket.group}>
              <div style={{ padding: '8px 10px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                {bucket.group}
              </div>
              {bucket.items.map(({ cmd, index }) => {
                const on = index === active
                return (
                  <button
                    key={cmd.id}
                    onMouseMove={() => setActive(index)}
                    onClick={() => run(cmd)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', textAlign: 'left', padding: '9px 10px',
                      borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? 'var(--accent-contrast)' : 'var(--text-primary)',
                    }}
                  >
                    <span style={{ fontSize: 13.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cmd.label}
                    </span>
                    {cmd.shortcut && (
                      <kbd style={{ fontSize: 10, color: on ? 'var(--accent-contrast)' : 'var(--text-muted)', border: `1px solid ${on ? 'var(--accent-contrast)' : 'var(--border)'}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0, opacity: on ? 0.9 : 1 }}>
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
