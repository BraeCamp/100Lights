'use client'

import { useCallback, useEffect, useState } from 'react'

const CATEGORIES = ['sound', 'sample', 'preset', 'drum kit', 'loop', 'article audio', 'image', 'font', 'other']

interface License {
  id: string
  name: string
  category: string
  source: string | null
  license: string | null
  url: string | null
  notes: string | null
  updatedAt: string
}

const BLANK = { id: '', name: '', category: 'sound', source: '', license: '', url: '', notes: '' }

export default function LicensesPanel() {
  const [rows, setRows] = useState<License[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/licenses')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRows((await res.json() as { licenses: License[] }).licenses)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600) }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))
  const reset = () => setForm({ ...BLANK })

  function edit(l: License) {
    setForm({ id: l.id, name: l.name, category: l.category, source: l.source ?? '', license: l.license ?? '', url: l.url ?? '', notes: l.notes ?? '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    try {
      const res = await fetch('/api/admin/licenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      showToast(form.id ? 'Saved' : 'Added'); reset(); await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function remove(l: License) {
    if (!confirm(`Delete the license record for “${l.name}”?`)) return
    try {
      const res = await fetch(`/api/admin/licenses?id=${encodeURIComponent(l.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      showToast('Deleted'); if (form.id === l.id) reset(); await load()
    } catch { showToast('Delete failed') }
  }

  const input: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none', width: '100%' }
  const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }

  const q = query.trim().toLowerCase()
  const filtered = q ? rows.filter(l => [l.name, l.category, l.source, l.license, l.notes].some(v => (v ?? '').toLowerCase().includes(q))) : rows
  const missing = rows.filter(l => !l.source || !l.license).length

  return (
    <>
      <form onSubmit={save} className="rounded-xl border p-4 mb-5" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{form.id ? 'Editing entry' : 'Add content'}</span>
          {form.id && <button type="button" onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>+ New instead</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div><label style={label}>Name / what it is</label><input required value={form.name} onChange={set('name')} placeholder="e.g. Studio drum kit, Reese bass preset" style={input} /></div>
          <div><label style={label}>Category</label><select value={form.category} onChange={set('category')} style={input}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label style={label}>Source <span style={{ fontWeight: 400 }}>(where it came from)</span></label><input value={form.source} onChange={set('source')} placeholder="Splice / self-made / freesound…" style={input} /></div>
          <div><label style={label}>License</label><input value={form.license} onChange={set('license')} placeholder="CC0, royalty-free, original, purchased…" style={input} /></div>
          <div><label style={label}>Source / license URL</label><input value={form.url} onChange={set('url')} placeholder="https://…" style={input} /></div>
        </div>
        <div style={{ marginBottom: 12 }}><label style={label}>Notes</label><input value={form.notes} onChange={set('notes')} placeholder="Purchase date, attribution required, terms…" style={input} /></div>
        <button type="submit" disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'rgba(139,92,246,0.2)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.35)', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : form.id ? 'Save changes' : '+ Add entry'}</button>
      </form>

      {!loading && !err && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} tracked</span>
          {missing > 0 && <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>⚠ {missing} missing source or license</span>}
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" style={{ ...input, width: 200, marginLeft: 'auto' }} />
        </div>
      )}

      {loading ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>
        : err ? <p style={{ fontSize: 12, color: 'var(--error)' }}>{err}</p>
        : rows.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No content logged yet. Add every bundled sound/sample/preset with its source + license so provenance is always on record.</p>
        : (
          <div className="rounded-xl border" style={{ borderColor: 'var(--border)', overflowX: 'auto' }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {['Name', 'Category', 'Source', 'License', '', ''].map(h => <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map((l, i) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                    <td className="px-3 py-2.5" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{l.name}{l.notes && <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-muted)' }}>{l.notes}</div>}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{l.category}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: l.source ? 'var(--text-secondary)' : '#f59e0b' }}>{l.source || '— missing'}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: l.license ? 'var(--text-secondary)' : '#f59e0b' }}>
                      {l.url ? <a href={/^https?:\/\//.test(l.url) ? l.url : undefined} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)' }}>{l.license || 'link'}</a> : (l.license || '— missing')}
                    </td>
                    <td className="px-3 py-2.5 text-xs"><button onClick={() => edit(l)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11 }}>Edit</button></td>
                    <td className="px-3 py-2.5 text-xs"><button onClick={() => remove(l)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9001, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>{toast}</div>}
    </>
  )
}
