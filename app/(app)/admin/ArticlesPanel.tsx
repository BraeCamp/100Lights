'use client'

// Admin → Articles: the editorial desk for /learn. List every article (repo
// drafts + DB), edit in markdown with live preview, publish with a toggle
// (DB saves go live instantly — no deploy), and generate new drafts via the
// Anthropic API. Repo articles are editable too: saving one writes a DB row
// with the same slug, which overrides the file.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import { renderMarkdown } from '@/lib/simple-markdown'
import { initLibrary, libraryGetAll, type LibraryEntry } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import { getAllChordRecipes } from '@/lib/practice-recipes'
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

const playBtn: React.CSSProperties = {
  flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 10, borderRadius: '50%', border: '1px solid rgba(52,211,153,0.5)', background: 'transparent',
  color: '#34d399', cursor: 'pointer', lineHeight: 1, padding: 0,
}

export default function ArticlesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sel, setSel] = useState<Row | null>(null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [genTopic, setGenTopic] = useState('')
  const [genNotes, setGenNotes] = useState('')
  const [soundPicker, setSoundPicker] = useState(false)
  const [soundQuery, setSoundQuery] = useState('')
  const [soundResults, setSoundResults] = useState<Array<{ id: string; name: string; kind: string; authorName: string }> | null>(null)
  const [libPicker, setLibPicker] = useState(false)
  const [libTab, setLibTab] = useState<'samples' | 'recipes'>('samples')
  const [libQuery, setLibQuery] = useState('')
  const [libEntries, setLibEntries] = useState<LibraryEntry[] | null>(null)
  const [auditioning, setAuditioning] = useState<string | null>(null) // id of the row currently playing / loading
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const { user } = useUser()

  // Stop any audition in flight and release its object URL
  const stopAudition = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null }
    setAuditioning(null)
  }, [])

  useEffect(() => () => stopAudition(), [stopAudition]) // clean up on unmount

  // Play a blob through a single shared <audio>; clicking a playing row stops it
  const auditionBlob = useCallback((id: string, blob: Blob) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioRef.current?.pause()
    const url = URL.createObjectURL(blob)
    audioUrlRef.current = url
    const el = new Audio(url)
    audioRef.current = el
    el.onended = () => setAuditioning(a => (a === id ? null : a))
    setAuditioning(id)
    void el.play().catch(() => setAuditioning(a => (a === id ? null : a)))
  }, [])

  async function auditionSample(entry: LibraryEntry) {
    if (auditioning === entry.id) { stopAudition(); return }
    setAuditioning(entry.id)
    try {
      let blob = entry.audioBlob
      if (!blob) blob = (await libraryFulfill(entry.id))?.audioBlob ?? undefined
      if (!blob) { setAuditioning(null); setMsg('This sound has no audio yet — play it once in the library, then retry'); return }
      auditionBlob(entry.id, blob)
    } catch { setAuditioning(null) }
  }

  async function auditionRecipe(recipeId: string) {
    if (auditioning === recipeId) { stopAudition(); return }
    setAuditioning(recipeId)
    try {
      auditionBlob(recipeId, await renderRecipeBlob(recipeId))
    } catch { setAuditioning(null) }
  }

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
  async function uploadBlobAsArticleAudio(blob: Blob, name: string) {
    const type = blob.type || 'audio/wav'
    const r = await fetch('/api/admin/articles/audio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `${name.replace(/[^\w.-]+/g, '_')}.${type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : 'mp3'}`, contentType: type }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error ?? 'Upload slot failed')
    const put = await fetch(d.url, { method: 'PUT', headers: { 'Content-Type': type }, body: blob })
    if (!put.ok) throw new Error('Upload failed')
    appendToBody(`@audio(/api/learn-audio?key=${encodeURIComponent(d.key)}) ${name}`)
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

  // Render a recipe's piano audition offline (100 bpm, 16-beat cap) into a WAV —
  // the synthesis is oscillator-based, so it renders without loading samples.
  // Shared by the play button (audition) and insert.
  async function renderRecipeBlob(recipeId: string): Promise<Blob> {
    const recipe = getAllChordRecipes().find(r => r.id === recipeId)
    if (!recipe) throw new Error('Recipe not found')
    const spec = recipe.build()
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
    return new Blob([encodeWav(channels, rate)], { type: 'audio/wav' })
  }

  async function insertLibraryRecipe(recipeId: string) {
    setBusy('lib'); setMsg('')
    try {
      const recipe = getAllChordRecipes().find(r => r.id === recipeId)
      if (!recipe) throw new Error('Recipe not found')
      const blob = await renderRecipeBlob(recipeId)
      await uploadBlobAsArticleAudio(blob, `${recipe.title} (piano)`)
      setLibPicker(false)
      setMsg('Recipe rendered & inserted ✓')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Insert failed') } finally { setBusy(null) }
  }

  function appendToBody(line: string) {
    setSel(s => s ? { ...s, body: `${s.body.replace(/\s+$/, '')}\n\n${line}\n` } : s)
  }

  async function uploadAudio(file: File) {
    setBusy('upload'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles/audio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type || 'audio/mpeg' }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Upload slot failed')
      const put = await fetch(d.url, { method: 'PUT', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file })
      if (!put.ok) throw new Error('Upload failed')
      appendToBody(`@audio(/api/learn-audio?key=${encodeURIComponent(d.key)}) ${file.name.replace(/\.[^.]+$/, '')}`)
      setMsg('Audio inserted ✓')
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
                  {libTab === 'samples' && (libEntries ?? [])
                    .filter(e => !libQuery || e.name.toLowerCase().includes(libQuery.toLowerCase()) || (e.folder ?? '').toLowerCase().includes(libQuery.toLowerCase()))
                    .slice(0, 40)
                    .map(e => (
                      <div key={e.id} onClick={() => { if (busy !== 'lib') void insertLibrarySample(e) }}
                        title="Insert this sample"
                        style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', fontSize: 12, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: busy === 'lib' ? 'default' : 'pointer', opacity: busy === 'lib' ? 0.6 : 1 }}>
                        <button onClick={ev => { ev.stopPropagation(); void auditionSample(e) }} title={auditioning === e.id ? 'Stop' : 'Play'}
                          style={playBtn}>{auditioning === e.id ? '◼' : '▶'}</button>
                        <span style={{ flexShrink: 0, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          📁 {e.folder || 'No folder'}{e.category ? ` · ${e.category}` : ''}
                        </span>
                        {!e.audioBlob && <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>renders on insert</span>}
                        <span style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>{e.duration.toFixed(1)}s</span>
                      </div>
                    ))}
                  {libTab === 'samples' && libEntries !== null && libEntries.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No sounds in your library on this browser.</span>}
                  {libTab === 'recipes' && getAllChordRecipes()
                    .filter(r => !libQuery || r.title.toLowerCase().includes(libQuery.toLowerCase()) || (r.genre ?? '').toLowerCase().includes(libQuery.toLowerCase()))
                    .slice(0, 40)
                    .map(r => (
                      <div key={r.id} onClick={() => { if (busy !== 'lib') void insertLibraryRecipe(r.id) }}
                        title="Insert this recipe (renders a piano WAV)"
                        style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', fontSize: 12, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: busy === 'lib' ? 'default' : 'pointer', opacity: busy === 'lib' ? 0.6 : 1 }}>
                        <button onClick={ev => { ev.stopPropagation(); void auditionRecipe(r.id) }} title={auditioning === r.id ? 'Stop' : 'Play piano preview'}
                          style={playBtn}>{auditioning === r.id ? '◼' : '▶'}</button>
                        <span style={{ flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>♪ {r.title}</span>
                        {r.genre && <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>📁 {r.genre}</span>}
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>renders piano WAV</span>
                      </div>
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
