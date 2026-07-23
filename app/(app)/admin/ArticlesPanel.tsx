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
import { VOICES, VOICE_LIST, type VoiceId } from '@/lib/article-voice'
import { parseTags, MAX_TAGS } from '@/lib/tags'
import type { AudioFile } from '@/app/api/admin/articles/audio/list/route'
import ArticleScheduleCalendar from './ArticleScheduleCalendar'

interface TrashItem {
  slug: string
  title: string
  deletedAt: string
  expiresAt: string
  daysLeft: number
  repoShadow: boolean
}

interface Row {
  slug: string
  title: string
  description: string
  date: string
  tags: string
  draft: boolean
  /** Set while a draft is waiting for its scheduled slot (ISO datetime). */
  scheduledFor?: string
  body: string
  source: 'repo' | 'db'
  /** True when a committed .md file exists for this slug — if the row is also
   *  DB-sourced, that file is being shadowed and can be resynced from. */
  hasRepo?: boolean
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
  // '' means "let the topic choose" — pickVoice runs server-side.
  const [genVoice, setGenVoice] = useState<VoiceId | ''>('')
  const [reviseInstr, setReviseInstr] = useState('')
  const [prevBody, setPrevBody] = useState<string | null>(null)
  const [soundPicker, setSoundPicker] = useState(false)
  const [soundQuery, setSoundQuery] = useState('')
  const [soundResults, setSoundResults] = useState<Array<{ id: string; name: string; kind: string; authorName: string }> | null>(null)
  const [libPicker, setLibPicker] = useState(false)
  const [audioPicker, setAudioPicker] = useState(false)
  const [audioFiles, setAudioFiles] = useState<AudioFile[] | null>(null)
  const [libTab, setLibTab] = useState<'samples' | 'recipes'>('samples')
  const [libQuery, setLibQuery] = useState('')
  const [libEntries, setLibEntries] = useState<LibraryEntry[] | null>(null)
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
  const [schedOpen, setSchedOpen] = useState(false)
  const [schedStart, setSchedStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [schedTime, setSchedTime] = useState('09:00')
  const [schedEvery, setSchedEvery] = useState(1)
  const [filter, setFilter] = useState<'all' | 'live' | 'draft' | 'scheduled'>('all')
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<TrashItem[] | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
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

  // Copy a shadowed .md file's content back over its frozen DB row, then pull
  // the refreshed article back into the editor.
  async function syncFromRepo(row: Row) {
    setBusy('sync'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles/resync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: row.slug }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Sync failed')
      const list = await fetch('/api/admin/articles').then(x => x.ok ? x.json() : null).catch(() => null)
      const next = (list?.articles as Row[] | undefined) ?? null
      if (next) {
        setRows(next)
        const fresh = next.find(a => a.slug === row.slug)
        if (fresh) setSel(fresh)
      }
      setMsg('Synced from repo file ✓')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Sync failed') } finally { setBusy(null) }
  }

  async function remove(slug: string) {
    if (!window.confirm(`Move "${slug}" to the trash? You can restore it for 7 days.`)) return
    await fetch(`/api/admin/articles?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
    setSel(null)
    await load()
    if (trash !== null) await loadTrash()
    setMsg('Moved to trash — restorable for 7 days')
  }

  const loadTrash = useCallback(async () => {
    const r = await fetch('/api/admin/articles/trash').catch(() => null)
    setTrash(r?.ok ? (await r.json()).items as TrashItem[] : [])
  }, [])

  async function restore(slug: string) {
    await fetch('/api/admin/articles', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
    await Promise.all([load(), loadTrash()])
    setMsg(`Restored "${slug}" ✓`)
  }

  async function purge(slug: string, repoShadow: boolean) {
    const warn = repoShadow
      ? `Delete "${slug}" for good?\n\nThis article comes from a committed file, so a hidden marker has to stay behind to keep it off the site. Everything else is erased.`
      : `Delete "${slug}" for good? This cannot be undone.`
    if (!window.confirm(warn)) return
    await fetch(`/api/admin/articles?slug=${encodeURIComponent(slug)}&permanent=1`, { method: 'DELETE' })
    await Promise.all([load(), loadTrash()])
    setMsg('Permanently deleted')
  }

  async function generate() {
    if (!genTopic.trim()) return
    setBusy('gen'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: genTopic, notes: genNotes, ...(genVoice ? { voice: genVoice } : {}) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Generation failed')
      setSel({
        slug: d.slug, title: d.title, description: d.description,
        date: new Date().toISOString().slice(0, 10), tags: '', draft: true, body: d.body, source: 'db',
      })
      setPreview(true)
      setMsg(`Draft generated in ${VOICES[d.voice as VoiceId]?.label ?? 'the house voice'} — review, edit, and save.`)
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

  // Upload a screenshot/image or a screen recording, host it on R2, and insert
  // the matching marker — ![name](url) for an image, @video(url) for a video.
  async function uploadMedia(file: File) {
    setBusy('media'); setMsg('')
    try {
      const isVideo = /^video\//.test(file.type)
      const name = file.name.replace(/\.[^.]+$/, '')
      let r: Response
      try {
        r = await fetch(`/api/admin/articles/media?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'Content-Type': file.type || (isVideo ? 'video/mp4' : 'image/png') },
          body: file,
        })
      } catch { throw new Error('Could not reach the server. Check your connection and try again.') }
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? `Upload failed (${r.status})`)
      if (d.kind === 'video') appendToBody(`@video(${d.url}) ${name}`)
      else appendToBody(`![${name}](${d.url})`)
      setMsg(`${d.kind === 'video' ? 'Video' : 'Image'} uploaded & inserted ✓`)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Upload failed') } finally { setBusy(null) }
  }

  /** Unscheduled drafts, oldest first — the order they'll be published in. */
  const queue = (rows ?? []).filter(r => r.draft && !r.scheduledFor)
    .sort((a, b) => a.date.localeCompare(b.date))
  const pending = (rows ?? []).filter(r => r.scheduledFor)
    .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))

  /**
   * Assign one slot per interval, starting at the chosen local date and time.
   * Dates are built in the browser so they mean what the editor's clock says —
   * computing them server-side would silently schedule for UTC.
   */
  function plannedSlots(slugs: string[]) {
    const [h, m] = schedTime.split(':').map(Number)
    return slugs.map((slug, i) => {
      const d = new Date(`${schedStart}T00:00:00`)
      d.setDate(d.getDate() + i * Math.max(1, schedEvery))
      d.setHours(h || 0, m || 0, 0, 0)
      return { slug, publishAt: d.toISOString() }
    })
  }

  async function applySchedule(slots: Array<{ slug: string; publishAt: string | null }>) {
    setBusy('sched'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles/schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Scheduling failed')
      const bits = []
      if (d.scheduled) bits.push(`${d.scheduled} scheduled`)
      if (d.cleared) bits.push(`${d.cleared} unscheduled`)
      if (d.skipped?.length) bits.push(`${d.skipped.length} skipped (already live)`)
      setMsg(`${bits.join(', ')} ✓`)
      await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Scheduling failed') } finally { setBusy(null) }
  }

  async function openAudioPicker() {
    setAudioPicker(v => !v)
    if (audioFiles !== null) return
    const r = await fetch('/api/admin/articles/audio/list').catch(() => null)
    if (r?.ok) setAudioFiles((await r.json()).files as AudioFile[])
    else setAudioFiles([])
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
          {sel.source === 'db' && sel.hasRepo && (
            <button onClick={() => void syncFromRepo(sel)} disabled={busy === 'sync'} title="This article was published from its committed file, then frozen in the database. Pull the file's current content back in." style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent-light)', cursor: 'pointer' }}>
              {busy === 'sync' ? 'Syncing…' : '↻ Sync from repo file'}
            </button>
          )}
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
              {(() => {
                const n = parseTags(sel.tags).length
                const raw = sel.tags.split(',').filter(t => t.trim()).length
                const over = raw > MAX_TAGS
                return (
                  <p style={{ fontSize: 10, color: over ? '#f59e0b' : 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
                    {n}/{MAX_TAGS} tags
                    {over && ` — only the first ${MAX_TAGS} are used, so put the most applicable first.`}
                    {!over && ' · these drive which articles get recommended, so keep them to what the piece is really about.'}
                  </p>
                )
              })()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                {busy === 'upload' ? 'Uploading…' : '⬆ Upload audio file'}
                <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAudio(f); e.target.value = '' }} />
              </label>
              <label style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed rgba(167,139,250,0.5)', color: '#a78bfa', cursor: 'pointer' }}>
                {busy === 'media' ? 'Uploading…' : '🖼 Upload image / video'}
                <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadMedia(f); e.target.value = '' }} />
              </label>
              <button
                onClick={() => void openLibraryPicker()}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed rgba(52,211,153,0.5)', background: libPicker ? 'rgba(52,211,153,0.08)' : 'transparent', color: '#34d399', cursor: 'pointer' }}
              >♫ From my library</button>
              <button
                onClick={() => { setSoundPicker(v => !v); if (soundResults === null) void searchSounds('') }}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed var(--border)', background: soundPicker ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >♪ From the Community</button>
              <button
                onClick={() => void openAudioPicker()}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed rgba(56,189,248,0.5)', background: audioPicker ? 'rgba(56,189,248,0.08)' : 'transparent', color: '#38bdf8', cursor: 'pointer' }}
              >🎵 Existing audio files</button>
              {/* Interactive-widget templates — insert VALID pre-encoded markers so
                  the JSON never gets hand-typed (the build validator enforces this too). */}
              <button
                onClick={() => { appendToBody(`@grid(${encodeURIComponent(JSON.stringify({ lanes: [{ name: 'Kick', sound: 'kick' }, { name: 'Snare', sound: 'snare' }, { name: 'Hat', sound: 'hat' }], steps: 16, bpm: 120, pattern: [[0, 4, 8, 12], [4, 12], [2, 6, 10, 14]] }))}) A playable beat — click any cell to change it`); setMsg('Beat grid inserted — edit the pattern, then preview ✓') }}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed rgba(248,113,113,0.5)', background: 'transparent', color: '#f87171', cursor: 'pointer' }}
              >◼ Beat grid</button>
              <button
                onClick={() => { appendToBody(`@synth(${encodeURIComponent(JSON.stringify({ caption: 'Drag the controls to hear each one' }))}) `); setMsg('Synth widget inserted ✓') }}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed rgba(251,191,36,0.5)', background: 'transparent', color: '#fbbf24', cursor: 'pointer' }}
              >🎛 Synth demo</button>
              <button
                onClick={() => { appendToBody(`@ab(${encodeURIComponent(JSON.stringify({ treatedSrc: 'REPLACE_WITH_TREATED_AUDIO_URL', plainSrc: 'REPLACE_WITH_PLAIN_AUDIO_URL', question: 'Which one has the effect?', explanation: 'What to listen for next time.' }))}) A/B blind test`); setMsg('A/B widget inserted — set the two audio URLs ✓') }}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px dashed rgba(167,139,250,0.5)', background: 'transparent', color: '#a78bfa', cursor: 'pointer' }}
              >🔀 A/B test</button>
            </div>
            {audioPicker && (
              <div style={{ border: '1px solid rgba(56,189,248,0.35)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Every audio file an article can use. Play one to check it, download it to fix in a DAW, or insert the marker.
                  <strong style={{ color: 'var(--text-secondary)' }}> Repo</strong> files come from <code>scripts/</code> and are replaced by re-running the script and committing;
                  <strong style={{ color: 'var(--text-secondary)' }}> uploaded</strong> files are replaced by uploading again.
                </span>
                {audioFiles === null && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</span>}
                {audioFiles?.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No audio files yet.</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                  {audioFiles?.map(f => (
                    <div key={f.url} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg-card)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span style={{ fontSize: 9.5, color: f.source === 'repo' ? '#a78bfa' : '#34d399', flexShrink: 0 }}>{f.source}</span>
                        <span style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>{(f.bytes / 1024).toFixed(0)} KB</span>
                      </div>
                      <audio controls preload="none" src={f.url} style={{ width: '100%', height: 32, display: 'block', marginBottom: 6 }} />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => { appendToBody(`@audio(${f.url}) ${f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')}`); setAudioPicker(false); setMsg('Audio marker inserted ✓') }}
                          style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer' }}
                        >Insert into article</button>
                        <a href={f.url} download={f.name} style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Download</a>
                        <button
                          onClick={() => { void navigator.clipboard.writeText(f.url); setMsg(`Copied ${f.name} URL ✓`) }}
                          style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        >Copy URL</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>BODY — markdown. Use the buttons above to insert widgets (beat grid, synth, A/B, chords, audio, embeds) so the encoded markers are always valid.</label>
              <textarea
                style={{ ...input, minHeight: 420, fontFamily: 'var(--font-geist-mono)', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }}
                value={sel.body}
                onChange={e => setSel({ ...sel, body: e.target.value })}
              />
            </div>
            <div>
              <button onClick={() => void remove(sel.slug)} style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', color: '#ef4444', cursor: 'pointer', padding: '5px 12px', borderRadius: 7 }}>Move to trash</button>
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
      {calendarOpen && (
        <ArticleScheduleCalendar
          rows={(rows ?? []).map(r => ({ slug: r.slug, title: r.title, draft: r.draft, scheduledFor: r.scheduledFor }))}
          onSchedule={async (slug, publishAt) => { await applySchedule([{ slug, publishAt }]) }}
          onClose={() => setCalendarOpen(false)}
        />
      )}
      {/* Generate */}
      <div style={{ border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(124,58,237,0.06)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#a78bfa' }}>Generate a draft</span>
        <input style={input} placeholder="Topic — e.g. Recording vocals at home with just a browser" value={genTopic} onChange={e => setGenTopic(e.target.value)} />
        <input style={input} placeholder="Optional direction — angle, audience, things to include…" value={genNotes} onChange={e => setGenNotes(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            style={{ ...input, width: 'auto', minWidth: 190, cursor: 'pointer' }}
            value={genVoice}
            onChange={e => setGenVoice(e.target.value as VoiceId | '')}
          >
            <option value="">Voice: choose from topic</option>
            {VOICE_LIST.map(v => <option key={v.id} value={v.id}>{v.label} — {v.blurb}</option>)}
          </select>
          {genVoice && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: '1 1 240px' }}>
              {VOICES[genVoice].bestFor}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => void generate()} disabled={busy === 'gen' || !genTopic.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', opacity: genTopic.trim() ? 1 : 0.5 }}>
            {busy === 'gen' ? 'Writing… (30–60s)' : 'Generate draft'}
          </button>
          <span style={{ fontSize: 11, color: msg.includes('✓') || msg.includes('review') ? '#34d399' : '#ef4444' }}>{msg}</span>
        </div>
      </div>

      {/* New blank + IndexNow */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => setSel({ slug: '', title: '', description: '', date: new Date().toISOString().slice(0, 10), tags: '', draft: true, body: '# Title\n\nStart writing…', source: 'db' })}
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >+ New article</button>
        <button
          onClick={async () => {
            setMsg('Pinging search engines…')
            const r = await fetch('/api/admin/indexnow', { method: 'POST' }).catch(() => null)
            const d = r ? await r.json().catch(() => null) : null
            setMsg(r?.ok ? `Submitted ${d?.submitted} URLs to Bing/Yandex ✓` : 'IndexNow ping failed')
          }}
          title="Tell Bing/Yandex to re-crawl everything now (e.g. after scheduled articles go live). Google uses Search Console, not this."
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >⚡ Ping search engines</button>
      </div>

      {/* Publishing schedule */}
      <div style={{ border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.05)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={() => setSchedOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ fontSize: 12, fontWeight: 800, color: '#34d399' }}>Publishing schedule</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {pending.length > 0
              ? `${pending.length} queued · next ${new Date(pending[0].scheduledFor!).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : `${queue.length} unscheduled draft${queue.length === 1 ? '' : 's'}`}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{schedOpen ? '▲' : '▼'}</span>
        </button>

        <button
          onClick={() => setCalendarOpen(true)}
          style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.5)', background: 'rgba(52,211,153,0.1)', color: '#34d399', cursor: 'pointer' }}
        >📅 Open schedule — pick dates on a calendar</button>

        {schedOpen && (
          <>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
              Drafts publish themselves at their slot — no deploy, and nothing to come back and click.
              Pages refresh about once a minute, so an article appears within a minute of its time.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                First post
                <input type="date" value={schedStart} onChange={e => setSchedStart(e.target.value)} style={{ ...input, marginTop: 3 }} />
              </label>
              <label style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                Time
                <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} style={{ ...input, marginTop: 3 }} />
              </label>
              <label style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                Every
                <select value={schedEvery} onChange={e => setSchedEvery(Number(e.target.value))} style={{ ...input, marginTop: 3, cursor: 'pointer' }}>
                  <option value={1}>1 day</option>
                  <option value={2}>2 days</option>
                  <option value={3}>3 days</option>
                  <option value={7}>1 week</option>
                </select>
              </label>
              <button
                onClick={() => void applySchedule(plannedSlots(queue.map(q => q.slug)))}
                disabled={busy === 'sched' || queue.length === 0}
                style={{ fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', opacity: queue.length ? 1 : 0.5 }}
              >
                {busy === 'sched' ? 'Scheduling…' : `Schedule ${queue.length} draft${queue.length === 1 ? '' : 's'}`}
              </button>
              {pending.length > 0 && (
                <button
                  onClick={() => void applySchedule(pending.map(p => ({ slug: p.slug, publishAt: null })))}
                  disabled={busy === 'sched'}
                  style={{ fontSize: 11, fontWeight: 700, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >Clear queue</button>
              )}
            </div>

            {queue.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                Preview — first three of {queue.length}:
                {plannedSlots(queue.map(q => q.slug)).slice(0, 3).map(s => (
                  <div key={s.slug} style={{ marginLeft: 8 }}>
                    · {new Date(s.publishAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — {s.slug}
                  </div>
                ))}
                {queue.length > 3 && (
                  <div style={{ marginLeft: 8 }}>
                    · … last one {new Date(plannedSlots(queue.map(q => q.slug)).at(-1)!.publishAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>
            )}

            {pending.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                {pending.map(p => (
                  <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
                    <span style={{ color: '#34d399', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(p.scheduledFor!).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{p.title}</span>
                    <button
                      onClick={() => void applySchedule([{ slug: p.slug, publishAt: null }])}
                      style={{ fontSize: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                    >unschedule</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Filter + trash */}
      {rows !== null && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {([
            ['all', 'All', rows.length],
            ['live', 'Live', rows.filter(r => !r.draft).length],
            ['draft', 'Drafts', rows.filter(r => r.draft && !r.scheduledFor).length],
            ['scheduled', 'Scheduled', rows.filter(r => r.scheduledFor).length],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              style={{
                fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
                border: `1px solid ${filter === id ? 'var(--accent)' : 'var(--border)'}`,
                background: filter === id ? 'rgba(124,58,237,0.15)' : 'transparent',
                color: filter === id ? 'var(--accent-light)' : 'var(--text-muted)',
              }}
            >{label} <span style={{ opacity: 0.7 }}>{count}</span></button>
          ))}
          <button
            onClick={() => { setTrashOpen(v => !v); if (trash === null) void loadTrash() }}
            style={{
              fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 99, cursor: 'pointer', marginLeft: 'auto',
              border: `1px solid ${trashOpen ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`,
              background: trashOpen ? 'rgba(239,68,68,0.08)' : 'transparent',
              color: trashOpen ? '#ef4444' : 'var(--text-muted)',
            }}
          >🗑 Trash{trash?.length ? ` ${trash.length}` : ''}</button>
        </div>
      )}

      {trashOpen && (
        <div style={{ border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Deleted articles stay here for 7 days, then go for good. They&rsquo;re already off the public site.
          </span>
          {trash === null && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</span>}
          {trash?.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Trash is empty.</span>}
          {trash?.map(t => (
            <div key={t.slug} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-card)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 10, color: t.daysLeft <= 1 ? '#ef4444' : 'var(--text-muted)', marginTop: 2 }}>
                  {t.daysLeft === 0 ? 'deletes today' : `${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'} left`}
                  {t.repoShadow && ' · from a committed file'}
                </div>
              </div>
              <button onClick={() => void restore(t.slug)}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', flexShrink: 0 }}
              >Restore</button>
              <button onClick={() => void purge(t.slug, t.repoShadow)}
                style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: '#ef4444', cursor: 'pointer', flexShrink: 0 }}
              >Delete now</button>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {rows === null && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>}
      {rows?.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No articles yet.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows?.filter(r =>
          filter === 'all' ? true
          : filter === 'live' ? !r.draft
          : filter === 'draft' ? r.draft && !r.scheduledFor
          : !!r.scheduledFor,
        ).map(r => (
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
            {r.scheduledFor ? (
              <span title={new Date(r.scheduledFor).toLocaleString()} style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 99, flexShrink: 0, color: '#38bdf8', border: '1px solid rgba(56,189,248,0.4)', whiteSpace: 'nowrap' }}>
                ⏱ {new Date(r.scheduledFor).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            ) : (
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 99, flexShrink: 0, color: r.draft ? '#f59e0b' : '#34d399', border: `1px solid ${r.draft ? 'rgba(245,158,11,0.4)' : 'rgba(52,211,153,0.4)'}` }}>
                {r.draft ? 'DRAFT' : 'LIVE'}
              </span>
            )}
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
