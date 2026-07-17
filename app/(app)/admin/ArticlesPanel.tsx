'use client'

// Admin → Articles: the editorial desk for /learn. List every article (repo
// drafts + DB), edit in markdown with live preview, publish with a toggle
// (DB saves go live instantly — no deploy), and generate new drafts via the
// Anthropic API. Repo articles are editable too: saving one writes a DB row
// with the same slug, which overrides the file.

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { renderMarkdown } from '@/lib/simple-markdown'
import { initLibrary, libraryGetAll, type LibraryEntry } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import { getAllChordRecipes } from '@/lib/practice-recipes'
import { groupIntoChords } from '@/lib/chord-analysis'
import { playMelodicNote } from '@/lib/instrument-synth'
import { encodeWav } from '@/lib/wav-codec'

interface Row {
  slug: string
  title: string
  description: string
  date: string
  tags: string
  draft: boolean
  body: string
  source: 'repo' | 'db'
}

const input: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8,
  background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
}

export default function ArticlesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sel, setSel] = useState<Row | null>(null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [genTopic, setGenTopic] = useState('')
  const [genNotes, setGenNotes] = useState('')
  const [reviseInstr, setReviseInstr] = useState('')
  const [prevBody, setPrevBody] = useState<string | null>(null)
  const [soundPicker, setSoundPicker] = useState(false)
  const [soundQuery, setSoundQuery] = useState('')
  const [soundResults, setSoundResults] = useState<Array<{ id: string; name: string; kind: string; authorName: string }> | null>(null)
  const [libPicker, setLibPicker] = useState(false)
  const [libTab, setLibTab] = useState<'samples' | 'recipes'>('samples')
  const [libQuery, setLibQuery] = useState('')
  const [libEntries, setLibEntries] = useState<LibraryEntry[] | null>(null)
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
  const { user } = useUser()

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/articles').catch(() => null)
    const next: Row[] = r?.ok ? (await r.json()).articles as Row[] : []
    setRows(next)
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/admin/articles')
      .then(async r => { if (alive) setRows(r.ok ? (await r.json()).articles as Row[] : []) })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [])

  async function save(row: Row, opts?: { thenReload?: boolean }) {
    setBusy('save'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: row.slug, title: row.title, description: row.description, date: row.date, tags: row.tags, draft: row.draft, body: row.body }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Save failed')
      setMsg('Saved ✓')
      if (opts?.thenReload !== false) await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(null) }
  }

  async function remove(slug: string) {
    if (!window.confirm(`Delete "${slug}" from the database? (A repo file with the same slug would become visible again.)`)) return
    await fetch(`/api/admin/articles?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
    setSel(null)
    await load()
  }

  async function generate() {
    if (!genTopic.trim()) return
    setBusy('gen'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: genTopic, notes: genNotes }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Generation failed')
      setSel({
        slug: d.slug, title: d.title, description: d.description,
        date: new Date().toISOString().slice(0, 10), tags: '', draft: true, body: d.body, source: 'db',
      })
      setPreview(true)
      setMsg('Draft generated — review, edit, and save.')
      setGenTopic(''); setGenNotes('')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Generation failed') } finally { setBusy(null) }
  }

  async function openLibraryPicker() {
    setLibPicker(v => !v)
    if (libEntries === null) {
      // The library IndexedDB is scoped per user — must be initialized before reading
      initLibrary(user?.id ?? null)
      const all = await libraryGetAll().catch(() => [] as LibraryEntry[])
      setLibEntries(all.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')))
    }
  }

  // Upload a blob into learn-audio/ and insert the @audio marker
  async function uploadBlobReturnUrl(blob: Blob, name: string): Promise<string> {
    const type = blob.type || 'audio/wav'
    // Bytes go to our server, which pushes to R2 — no browser→R2 request, so
    // no cross-origin CORS/CSP to fail on
    let r: Response
    try {
      r = await fetch(`/api/admin/articles/audio?name=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': type }, body: blob,
      })
    } catch { throw new Error('Could not reach the server. Check your connection and try again.') }
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error ?? `Upload failed (${r.status})`)
    return d.url as string
  }

  async function uploadBlobAsArticleAudio(blob: Blob, name: string) {
    const url = await uploadBlobReturnUrl(blob, name)
    appendToBody(`@audio(${url}) ${name}`)
  }

  async function insertLibrarySample(entry: LibraryEntry) {
    setBusy('lib'); setMsg('')
    try {
      let blob = entry.audioBlob
      if (!blob) {
        // Stub entry — render it first (same path the library's play button uses)
        const fulfilled = await libraryFulfill(entry.id)
        blob = fulfilled?.audioBlob ?? undefined
      }
      if (!blob) throw new Error('This sound has no audio yet — play it once in the library, then retry')
      await uploadBlobAsArticleAudio(blob, entry.name)
      setLibPicker(false)
      setMsg('Sample uploaded & inserted ✓')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Insert failed') } finally { setBusy(null) }
  }

  async function insertLibraryRecipe(recipeId: string) {
    setBusy('lib'); setMsg('')
    try {
      const recipe = getAllChordRecipes().find(r => r.id === recipeId)
      if (!recipe) throw new Error('Recipe not found')
      const spec = recipe.build()
      // Render a piano audition offline (100 bpm, 16-beat cap) into a WAV —
      // the synthesis is oscillator-based, so it renders without loading samples
      const spb = 60 / 100
      const capBeats = Math.min(16, Math.max(spec.durationBeats, ...spec.notes.map(n => n.startBeat + n.durationBeats)))
      const durSec = capBeats * spb + 2
      const rate = 44100
      const off = new OfflineAudioContext(2, Math.ceil(durSec * rate), rate)
      const g = off.createGain()
      g.gain.value = 0.7
      g.connect(off.destination)
      for (const n of spec.notes) {
        if (n.startBeat >= 16) continue
        playMelodicNote(off as unknown as AudioContext, 'piano-grand', n.pitch, 0.05 + n.startBeat * spb, (n.velocity ?? 100) / 127, g)
      }
      const rendered = await off.startRendering()
      const channels = Array.from({ length: rendered.numberOfChannels }, (_, ch) => rendered.getChannelData(ch))
      const blob = new Blob([encodeWav(channels, rate)], { type: 'audio/wav' })
      // Upload the piano render, then insert a @progression carrying the chord
      // data inline so the article's interactive piano works without a fetch
      const url = await uploadBlobReturnUrl(blob, `${recipe.title} (piano)`)
      const chords = groupIntoChords(spec.notes)
      const payload = { chords, audioUrl: url, originalKey: 0 }
      appendToBody(`@progression(${encodeURIComponent(JSON.stringify(payload))}) ${recipe.title}`)
      setLibPicker(false)
      setMsg('Recipe inserted with interactive piano ✓')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Insert failed') } finally { setBusy(null) }
  }

  async function reviseArticle() {
    const instruction = reviseInstr.trim()
    if (!instruction || !sel) return
    setBusy('revise'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles/revise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: sel.body, instruction }),
      }).catch(() => { throw new Error('Could not reach the server') })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? `Revision failed (${r.status})`)
      setPrevBody(sel.body)                       // enable one-step undo
      setSel(s => s ? { ...s, body: d.body } : s)
      setReviseInstr('')
      setMsg('Revised ✓ — review the body, then Save')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Revision failed') } finally { setBusy(null) }
  }

  const REVISE_PRESETS = ['Make it more casual', 'Make it more concise', 'Add a beginner tip box to each section', 'Expand the intro']

  function appendToBody(line: string) {
    setSel(s => s ? { ...s, body: `${s.body.replace(/\s+$/, '')}\n\n${line}\n` } : s)
  }

  async function uploadAudio(file: File) {
    setBusy('upload'); setMsg('')
    try {
      const named = file.type && !/^audio\//.test(file.type) ? new Blob([file], { type: 'audio/mpeg' }) : file
      await uploadBlobAsArticleAudio(named, file.name.replace(/\.[^.]+$/, ''))
      setMsg('Audio uploaded & inserted ✓')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Upload failed') } finally { setBusy(null) }
  }

  async function searchSounds(q: string) {
    setSoundQuery(q)
    const r = await fetch(`/api/community?q=${encodeURIComponent(q)}&sort=new`).catch(() => null)
    if (r?.ok) {
      const d = await r.json()
      setSoundResults((d.items as Array<{ id: string; name: string; kind: string; authorName: string }>).slice(0, 12))
    }
  }

  if (sel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => { setSel(null); setMsg('') }} style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>← All articles</button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{msg}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: sel.draft ? '#f59e0b' : '#34d399', fontWeight: 700, cursor: 'pointer' }}>
            <input type="checkbox" checked={!sel.draft} onChange={e => setSel({ ...sel, draft: !e.target.checked })} />
            {sel.draft ? 'Draft' : 'Published'}
          </label>
          <button onClick={() => setPreview(p => !p)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: preview ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button onClick={() => void save(sel)} disabled={busy === 'save'} style={{ fontSize: 12, fontWeight: 700, padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>

        {!preview ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>TITLE</label>
                <input style={input} value={sel.title} onChange={e => setSel({ ...sel, title: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>SLUG</label>
                <input style={input} value={sel.slug} onChange={e => setSel({ ...sel, slug: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>DATE</label>
                <input style={input} value={sel.date} onChange={e => setSel({ ...sel, date: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>DESCRIPTION (meta / list card)</label>
              <input style={input} value={sel.description} onChange={e => setSel({ ...sel, description: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>TAGS (comma-separated)</label>
              <input style={input} value={sel.tags} onChange={e => setSel({ ...sel, tags: e.target.value })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                {busy === 'upload' ? 'Uploading…' : '⬆ Upload audio file'}
                <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAudio(f); e.target.value = '' }} />
              </label>
              <button
                onClick={() => void openLibraryPicker()}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed rgba(52,211,153,0.5)', background: libPicker ? 'rgba(52,211,153,0.08)' : 'transparent', color: '#34d399', cursor: 'pointer' }}
              >♫ From my library</button>
              <button
                onClick={() => { setSoundPicker(v => !v); if (soundResults === null) void searchSounds('') }}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed var(--border)', background: soundPicker ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >♪ From the Community</button>
            </div>
            {libPicker && (
              <div style={{ border: '1px solid rgba(52,211,153,0.35)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {(['samples', 'recipes'] as const).map(t => (
                    <button key={t} onClick={() => setLibTab(t)} style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 12px', borderRadius: 99, border: '1px solid var(--border)', background: libTab === t ? 'rgba(52,211,153,0.15)' : 'transparent', color: libTab === t ? '#34d399' : 'var(--text-muted)', cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>
                  ))}
                  <input style={{ ...input, flex: 1, width: 'auto' }} placeholder="Search…" value={libQuery} onChange={e => setLibQuery(e.target.value)} />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{busy === 'lib' ? 'Uploading…' : 'Copies the sound to the site — no community share needed'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {libTab === 'samples' && (() => {
                    const entries = (libEntries ?? []).filter(e => !libQuery || e.name.toLowerCase().includes(libQuery.toLowerCase()))
                    // Group by folder (parentFolder › folder), like the library panel.
                    // A search flattens the tree so matches are never buried.
                    const groups = new Map<string, LibraryEntry[]>()
                    for (const e of entries) {
                      const label = libQuery ? '' : [e.parentFolder, e.folder].filter(Boolean).join(' › ')
                      const g = groups.get(label) ?? []
                      g.push(e)
                      groups.set(label, g)
                    }
                    const sampleRow = (e: LibraryEntry) => (
                      <button key={e.id} disabled={busy === 'lib'} onClick={() => void insertLibrarySample(e)}
                        style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', fontSize: 12, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                        {!e.audioBlob && <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>renders on insert</span>}
                        <span style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>{e.duration.toFixed(1)}s</span>
                      </button>
                    )
                    // Flat (searching) or ungrouped-only: no folder headers
                    if (libQuery || (groups.size === 1 && groups.has(''))) {
                      return entries.slice(0, 60).map(sampleRow)
                    }
                    const labels = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
                    return labels.map(label => {
                      const items = groups.get(label)!
                      if (label === '') return items.map(sampleRow)  // unfiled: show inline
                      const open = openFolders.has(label)
                      return (
                        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <button
                            onClick={() => setOpenFolders(prev => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n })}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, textAlign: 'left' }}>
                            <span style={{ fontSize: 9 }}>{open ? '▼' : '▶'}</span>
                            <span style={{ flex: 1 }}>📁 {label}</span>
                            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)' }}>{items.length}</span>
                          </button>
                          {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 10 }}>{items.map(sampleRow)}</div>}
                        </div>
                      )
                    })
                  })()}
                  {libTab === 'samples' && libEntries !== null && libEntries.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No sounds in your library on this browser. Your library lives in the browser you built it in — open the admin panel there.</span>}
                  {libTab === 'recipes' && getAllChordRecipes()
                    .filter(r => !libQuery || r.title.toLowerCase().includes(libQuery.toLowerCase()))
                    .slice(0, 40)
                    .map(r => (
                      <button key={r.id} disabled={busy === 'lib'} onClick={() => void insertLibraryRecipe(r.id)}
                        style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', fontSize: 12, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>♪ {r.title}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>renders piano WAV</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
            {soundPicker && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input style={input} placeholder="Search community sounds…" value={soundQuery} onChange={e => void searchSounds(e.target.value)} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                  {soundResults?.map(it => (
                    <button key={it.id} onClick={() => { appendToBody(`@sound(${it.id}) ${it.name}`); setSoundPicker(false); setMsg('Embed inserted ✓') }}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', fontSize: 12, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                      <span style={{ fontSize: 9.5, color: '#a78bfa', flexShrink: 0 }}>{it.kind}</span>
                      <span style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>{it.authorName.split(' ')[0]}</span>
                    </button>
                  ))}
                  {soundResults?.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No matches.</span>}
                </div>
              </div>
            )}
            <div>
              <div style={{ border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(124,58,237,0.06)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa' }}>Ask the AI to revise this article</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...input, flex: 1, width: 'auto' }}
                    placeholder="Add, remove, or change tone — e.g. “add a section on EQ”, “cut the FAQ”, “make it more casual”"
                    value={reviseInstr}
                    onChange={e => setReviseInstr(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void reviseArticle() }}
                  />
                  <button onClick={() => void reviseArticle()} disabled={busy === 'revise' || !reviseInstr.trim()}
                    style={{ fontSize: 12, fontWeight: 700, padding: '6px 16px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', opacity: reviseInstr.trim() ? 1 : 0.5, whiteSpace: 'nowrap' }}>
                    {busy === 'revise' ? 'Revising…' : 'Apply'}
                  </button>
                  {prevBody !== null && (
                    <button onClick={() => { setSel(s => s && prevBody !== null ? { ...s, body: prevBody } : s); setPrevBody(null); setMsg('Reverted') }}
                      style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Undo
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {REVISE_PRESETS.map(p => (
                    <button key={p} onClick={() => setReviseInstr(p)}
                      style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>{p}</button>
                  ))}
                </div>
              </div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>BODY — markdown; `@video caption` = clip slot · `@audio(url) caption` = audio file · `@sound(id) caption` = community embed</label>
              <textarea
                style={{ ...input, minHeight: 420, fontFamily: 'var(--font-geist-mono)', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }}
                value={sel.body}
                onChange={e => setSel({ ...sel, body: e.target.value })}
              />
            </div>
            <div>
              <button onClick={() => void remove(sel.slug)} style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', color: '#ef4444', cursor: 'pointer', padding: '5px 12px', borderRadius: 7 }}>Delete from database</button>
            </div>
          </>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', background: 'var(--bg-base)', maxWidth: 760 }}>
            {renderMarkdown(sel.body)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Generate */}
      <div style={{ border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(124,58,237,0.06)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#a78bfa' }}>Generate a draft</span>
        <input style={input} placeholder="Topic — e.g. Recording vocals at home with just a browser" value={genTopic} onChange={e => setGenTopic(e.target.value)} />
        <input style={input} placeholder="Optional direction — angle, audience, things to include…" value={genNotes} onChange={e => setGenNotes(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => void generate()} disabled={busy === 'gen' || !genTopic.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', opacity: genTopic.trim() ? 1 : 0.5 }}>
            {busy === 'gen' ? 'Writing… (30–60s)' : 'Generate draft'}
          </button>
          <span style={{ fontSize: 11, color: msg.includes('✓') || msg.includes('review') ? '#34d399' : '#ef4444' }}>{msg}</span>
        </div>
      </div>

      {/* New blank */}
      <div>
        <button
          onClick={() => setSel({ slug: '', title: '', description: '', date: new Date().toISOString().slice(0, 10), tags: '', draft: true, body: '# Title\n\nStart writing…', source: 'db' })}
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >+ New article</button>
      </div>

      {/* List */}
      {rows === null && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>}
      {rows?.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No articles yet.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows?.map(r => (
          <button key={r.slug} onClick={() => { setSel(r); setPreview(false); setMsg('') }} style={{
            display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 14px',
            borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>/learn/{r.slug} · {r.date}</div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 99, flexShrink: 0, color: r.source === 'repo' ? '#60a5fa' : '#a78bfa', border: `1px solid ${r.source === 'repo' ? 'rgba(96,165,250,0.4)' : 'rgba(167,139,250,0.4)'}` }}>
              {r.source === 'repo' ? 'REPO' : 'DB'}
            </span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 99, flexShrink: 0, color: r.draft ? '#f59e0b' : '#34d399', border: `1px solid ${r.draft ? 'rgba(245,158,11,0.4)' : 'rgba(52,211,153,0.4)'}` }}>
              {r.draft ? 'DRAFT' : 'LIVE'}
            </span>
            <a
              href={`/learn/${r.slug}`} target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none', flexShrink: 0 }}
            >View ↗</a>
          </button>
        ))}
      </div>
    </div>
  )
}
