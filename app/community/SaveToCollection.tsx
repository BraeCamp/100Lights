'use client'

import { useEffect, useRef, useState } from 'react'
import { listMyCollections, createCollection, addToCollection, removeFromCollection, type CommunityCollection } from '@/lib/community'

// A "Save" button that opens a popover of the user's collections (checkboxes,
// pre-checked for the ones already containing this item) plus an inline
// "New collection" field. Optimistic; reverts on failure.
export function SaveToCollection({ itemId, signedIn, onToast }: { itemId: string; signedIn: boolean; onToast: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const [cols, setCols] = useState<CommunityCollection[] | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function openPicker() {
    if (!signedIn) { window.location.assign('/sign-in'); return }
    setOpen(true)
    if (cols === null) setCols(await listMyCollections(itemId))
  }

  async function toggle(c: CommunityCollection) {
    if (busy) return
    setBusy(true)
    const nowIn = !c.contains
    setCols(list => (list ?? []).map(x => x.id === c.id ? { ...x, contains: nowIn, count: Math.max(0, x.count + (nowIn ? 1 : -1)) } : x))
    try {
      if (nowIn) await addToCollection(c.id, itemId); else await removeFromCollection(c.id, itemId)
    } catch {
      onToast('Could not update that collection')
      setCols(list => (list ?? []).map(x => x.id === c.id ? { ...x, contains: !nowIn, count: Math.max(0, x.count + (nowIn ? -1 : 1)) } : x))
    } finally { setBusy(false) }
  }

  async function create() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const c = await createCollection(name)
      await addToCollection(c.id, itemId)
      setCols(list => [{ ...c, contains: true, count: 1 }, ...(list ?? [])])
      setNewName('')
      onToast(`Saved to “${name}”`)
    } catch (e) { onToast(e instanceof Error ? e.message : 'Could not create collection') }
    finally { setBusy(false) }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={openPicker} title="Save this to a collection" style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
        color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)',
        borderRadius: 999, padding: '3px 10px', cursor: 'pointer',
      }}>🔖 Save</button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100, width: 240,
          background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #2a2a30)',
          borderRadius: 10, boxShadow: '0 10px 34px rgba(0,0,0,0.5)', padding: 8,
          textTransform: 'none', letterSpacing: 0,
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 6px 6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Save to collection</div>
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {cols === null ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6 }}>Loading…</span>
            ) : cols.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 6px' }}>No collections yet — make one below.</span>
            ) : cols.map(c => (
              <button key={c.id} onClick={() => toggle(c)} style={{
                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', width: '100%',
                background: 'transparent', border: 'none', borderRadius: 6, padding: '6px 6px', cursor: 'pointer',
                color: 'var(--text-primary)', fontSize: 13,
              }}>
                <span aria-hidden style={{
                  width: 15, height: 15, flexShrink: 0, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${c.contains ? '#a78bfa' : 'var(--border)'}`, background: c.contains ? '#7c3aed' : 'transparent', color: '#fff', fontSize: 11,
                }}>{c.contains ? '✓' : ''}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{c.count}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create() }}
              placeholder="New collection…"
              maxLength={80}
              style={{ flex: 1, minWidth: 0, background: 'var(--bg-base, #0f0f11)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, borderRadius: 6, padding: '5px 8px', outline: 'none' }}
            />
            <button onClick={create} disabled={!newName.trim() || busy} style={{
              flexShrink: 0, background: 'var(--accent, #7c3aed)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
              borderRadius: 6, padding: '5px 12px', cursor: newName.trim() && !busy ? 'pointer' : 'default', opacity: newName.trim() && !busy ? 1 : 0.5,
            }}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}
