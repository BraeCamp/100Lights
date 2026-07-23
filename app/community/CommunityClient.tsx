'use client'

// Community feed — a social stream (SoundCloud × marketplace, no payments).
// Reading is public; voting, reacting, sharing, and importing need a session.

import { useEffect, useRef, useState } from 'react'
import { Upload, Search, X } from 'lucide-react'
import { listCommunity, toggleVote, importItem, shareSample, sharePreset, sharePack, shareKit, sharePattern, COMMUNITY_TAGS, type CommunityItem } from '@/lib/community'
import { getPresets, noteRangeLabel, type MidiPreset } from '@/lib/midi-presets'
import { getKits, getPatterns, type DrumKit, type DrumPattern } from '@/lib/drum-presets'
import { libraryGetAll, initLibrary, CATEGORY_GROUPS, type LibraryEntry } from '@/lib/sound-library'
import { useUser } from '@clerk/nextjs'
import { FeedCard, KIND_META, stopFeedPlayback } from './FeedCard'

type Kind = 'all' | CommunityItem['kind']
const KINDS: Kind[] = ['all', 'song', 'sample', 'preset', 'recipe', 'kit', 'pattern', 'pack', 'project', 'theme']

export default function CommunityClient({ initialItems }: { initialItems?: CommunityItem[] }) {
  const { user, isLoaded, isSignedIn } = useUser()
  const [items, setItems] = useState<CommunityItem[] | null>(initialItems ?? null)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [kind, setKind] = useState<Kind>('all')  // ?kind= adopted client-side to avoid a hydration mismatch
  const [sort, setSort] = useState<'top' | 'new' | 'trending' | 'name' | null>(null)  // null → server's scale mode decides
  const [pulse, setPulse] = useState<{ items: number; authors: number } | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [catGroup, setCatGroup] = useState<string | null>(null)  // a CATEGORY_GROUPS label
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [author, setAuthor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => { if (isLoaded && isSignedIn) initLibrary(user?.id ?? null) }, [isLoaded, isSignedIn, user?.id])
  useEffect(() => () => { stopFeedPlayback() }, [])

  async function load(reset: boolean, pageNum: number) {
    try {
      const catList = catGroup ? CATEGORY_GROUPS.find(g => g.label === catGroup)?.categories.join(',') : undefined
      const r = await listCommunity({
        kind: kind === 'all' ? undefined : kind, sort: sort ?? undefined,
        q: query.trim() || undefined, tag: tag ?? undefined, author: author ?? undefined,
        category: catList, page: pageNum,
      })
      setItems(prev => reset || !prev ? r.items : [...prev, ...r.items])
      setHasMore(r.hasMore)
      setPulse(r.stats)
      setTotal(r.total)
      if (sort === null && (r.sortUsed === 'top' || r.sortUsed === 'new' || r.sortUsed === 'trending' || r.sortUsed === 'name')) setSort(r.sortUsed)
      setError(null)
    } catch {
      setError('Could not load the community feed.')
    }
  }

  const urlAdopted = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => {  // async boundary — no sync setState in the effect
      if (!urlAdopted.current) {
        urlAdopted.current = true
        const sp = new URLSearchParams(window.location.search)
        const k = sp.get('kind')
        const a = sp.get('author')
        let adopted = false
        if (k && KINDS.includes(k as Kind) && k !== kind) { setKind(k as Kind); adopted = true }
        if (a) { setAuthor(a); adopted = true }
        if (adopted) return  // effect re-runs with the adopted filters
      }
      setPage(0)
      void load(true, 0)
    }, query ? 300 : 0)  // debounce typing; instant for filter clicks
    return () => clearTimeout(t)
  }, [kind, sort, query, tag, author, catGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  function pickKind(k: Kind) {
    setKind(k)
    const url = k === 'all' ? '/community' : `/community?kind=${k}`
    window.history.replaceState(null, '', url)
  }

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  async function handleVote(item: CommunityItem) {
    try {
      const r = await toggleVote(item.id)
      setItems(prev => prev?.map(i => i.id === item.id ? { ...i, votes: r.votes, votedByMe: r.votedByMe } : i) ?? prev)
    } catch { flash('Vote failed') }
  }

  async function handleImport(item: CommunityItem) {
    setBusy(item.id)
    try {
      flash(await importItem(item))
      setItems(prev => prev?.map(i => i.id === item.id ? { ...i, downloads: i.downloads + 1 } : i) ?? prev)
    } catch (e) { flash(e instanceof Error ? e.message : 'Import failed') }
    finally { setBusy(null) }
  }

  async function handleDelete(item: CommunityItem) {
    if (!confirm(`Remove "${item.name}" from the community?`)) return
    await fetch(`/api/community/${item.id}`, { method: 'DELETE' }).catch(() => {})
    setPage(0)
    void load(true, 0)
  }

  async function loadMore() {
    setLoadingMore(true)
    const next = page + 1
    setPage(next)
    await load(false, next)
    setLoadingMore(false)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '26px 18px 80px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>Community</h1>
          <button onClick={() => isSignedIn ? setShowUpload(true) : (window.location.href = '/sign-in')} style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
            padding: '8px 15px', borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
          }}><Upload size={13} /> Share something</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
          Songs, samples, presets, recipes, packs, and project starters from other producers. Listen right here — every card has a public link anyone can open.
          {pulse && pulse.items > 0 && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: '#a78bfa' }}>
              {pulse.items} share{pulse.items !== 1 ? 's' : ''} from {pulse.authors} producer{pulse.authors !== 1 ? 's' : ''} so far.
            </span>
          )}
        </p>

        {/* Author filter banner */}
        {author && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(167,139,250,0.35)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>Shares by {author}</span>
            <button onClick={() => { setAuthor(null); window.history.replaceState(null, '', '/community') }} aria-label="Clear author filter"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><X size={14} /></button>
          </div>
        )}

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={query} onChange={e => setQuery(e.target.value)} placeholder="Search names, descriptions, authors…"
            aria-label="Search the community"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', fontSize: 13,
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>

        {/* Kind filters + sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {KINDS.map(k => {
            const active = kind === k
            const color = k === 'all' ? '#8b5cf6' : KIND_META[k].color
            return (
              <button key={k} onClick={() => pickKind(k)} style={{
                fontSize: 11.5, fontWeight: 700, padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
                background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : 'transparent',
                border: active ? `1px solid ${color}80` : '1px solid var(--border)',
                color: active ? (k === 'all' ? 'var(--text-primary)' : color) : 'var(--text-muted)',
              }}>{k === 'all' ? 'All' : KIND_META[k].plural}</button>
            )
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {(['trending', 'top', 'new', 'name'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)} style={{
                fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', textTransform: 'capitalize',
                background: sort === s ? 'var(--bg-card)' : 'transparent',
                border: sort === s ? '1px solid var(--border)' : '1px solid transparent',
                color: sort === s ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>{s === 'name' ? 'a–z' : s}</button>
            ))}
          </div>
        </div>

        {/* Tag chips */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
          {COMMUNITY_TAGS.map(t => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)} style={{
              fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
              background: tag === t ? 'rgba(124,58,237,0.18)' : 'transparent',
              border: tag === t ? '1px solid rgba(167,139,250,0.5)' : '1px solid var(--border)',
              color: tag === t ? '#a78bfa' : 'var(--text-muted)',
            }}>#{t}</button>
          ))}
        </div>

        {/* Instrument groups — the sound library's own taxonomy, for samples & packs */}
        {(kind === 'all' || kind === 'sample' || kind === 'pack') && (
          <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Instrument</span>
            {CATEGORY_GROUPS.map(g => (
              <button key={g.label} onClick={() => setCatGroup(catGroup === g.label ? null : g.label)} style={{
                fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                background: catGroup === g.label ? 'rgba(52,211,153,0.15)' : 'transparent',
                border: catGroup === g.label ? '1px solid rgba(52,211,153,0.5)' : '1px solid var(--border)',
                color: catGroup === g.label ? '#34d399' : 'var(--text-muted)',
              }}>{g.label}</button>
            ))}
          </div>
        )}

        {/* Result count when any filter narrows the feed */}
        {total !== null && (query.trim() || tag || catGroup || author || kind !== 'all') && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }} role="status">
            {total} result{total !== 1 ? 's' : ''}
          </p>
        )}

        {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}
        {items === null && !error && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
        {items?.length === 0 && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Nothing here{query || tag || author ? ' that matches' : ' yet — be the first to share something'}.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items?.map(item => (
            <FeedCard
              key={item.id} item={item} busy={busy === item.id} signedIn={!isLoaded || !!isSignedIn}
              onVote={() => handleVote(item)} onImport={() => handleImport(item)}
              onDelete={item.mine ? () => handleDelete(item) : undefined}
              onAuthorClick={a => { setAuthor(a); window.history.replaceState(null, '', `/community?author=${encodeURIComponent(a)}`) }}
              onTagClick={t => setTag(t)}
              onToast={flash}
            />
          ))}
        </div>

        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore} style={{
            display: 'block', margin: '20px auto 0', fontSize: 12, fontWeight: 700, padding: '9px 26px',
            borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)',
            color: 'var(--text-primary)', opacity: loadingMore ? 0.6 : 1,
          }}>{loadingMore ? 'Loading…' : 'Load more'}</button>
        )}
      </div>

      {toast && (
        <div role="status" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
          background: '#1e1e1e', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 18px',
          fontSize: 12.5, color: 'var(--text-primary)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', maxWidth: '80vw',
        }}>{toast}</div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onShared={() => { setShowUpload(false); flash('Shared!'); setPage(0); void load(true, 0) }} />}
    </div>
  )
}

// ── Upload modal ───────────────────────────────────────────────────────────────

function UploadModal({ onClose, onShared }: { onClose: () => void; onShared: () => void }) {
  const [mode, setMode] = useState<'sample' | 'preset' | 'kit' | 'pattern' | 'pack'>('sample')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [presets] = useState<MidiPreset[]>(() => typeof window === 'undefined' ? [] : getPresets().filter(p => !p.builtIn))
  const [kits] = useState<DrumKit[]>(() => typeof window === 'undefined' ? [] : getKits().filter(k => !k.builtIn))
  const [patterns] = useState<DrumPattern[]>(() => typeof window === 'undefined' ? [] : getPatterns().filter(p => !p.builtIn))
  const [pickedEntry, setPickedEntry] = useState('')
  const [pickedPreset, setPickedPreset] = useState('')
  const [pickedKit, setPickedKit] = useState('')
  const [pickedPattern, setPickedPattern] = useState('')
  const [packName, setPackName] = useState('')
  const [packPicks, setPackPicks] = useState<Set<string>>(new Set())

  useEffect(() => {
    // Own recordings/imports only — sharing the built-in library back would be noise
    libraryGetAll().then(all => setEntries(all.filter(e => !e.id.startsWith('seed:') && !e.id.startsWith('community:')))).catch(() => {})
  }, [])

  async function submit() {
    setWorking(true); setErr('')
    try {
      if (mode === 'sample') {
        const entry = entries.find(e => e.id === pickedEntry)
        if (!entry) throw new Error('Pick a sample from your library')
        await shareSample(entry, description, tags)
      } else if (mode === 'preset') {
        const preset = presets.find(p => p.id === pickedPreset)
        if (!preset) throw new Error('Pick one of your custom presets')
        await sharePreset(preset, description, tags)
      } else if (mode === 'kit') {
        const kit = kits.find(k => k.id === pickedKit)
        if (!kit) throw new Error('Pick one of your saved kits')
        await shareKit(kit, description)
      } else if (mode === 'pattern') {
        const pattern = patterns.find(p => p.id === pickedPattern)
        if (!pattern) throw new Error('Pick one of your saved patterns')
        await sharePattern(pattern, description)
      } else {
        if (!packName.trim()) throw new Error('Name the pack')
        const picked = entries.filter(e => packPicks.has(e.id))
        await sharePack(picked, packName.trim(), description, tags)
      }
      onShared()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Share failed')
      setWorking(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', background: '#161616', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Share to the community</span>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['sample', 'preset', 'kit', 'pattern', 'pack'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', textTransform: 'capitalize',
              background: mode === m ? 'var(--bg-card)' : 'transparent',
              border: mode === m ? '1px solid var(--border)' : '1px solid transparent',
              color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{m}</button>
          ))}
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
          Songs and project starters are shared from the editor’s Export dialog · recipes by right-clicking a MIDI clip.
        </p>

        {mode === 'sample' && (
          <select value={pickedEntry} onChange={e => setPickedEntry(e.target.value)} style={selStyle} aria-label="Pick a sample">
            <option value="">Pick a sample from your library…</option>
            {entries.map(e => <option key={e.id} value={e.id}>{e.name}{e.folder ? ` (${e.folder})` : ''}</option>)}
          </select>
        )}
        {mode === 'preset' && (
          <select value={pickedPreset} onChange={e => setPickedPreset(e.target.value)} style={selStyle} aria-label="Pick a preset">
            <option value="">Pick one of your custom presets…</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name} — {noteRangeLabel(p)}</option>)}
          </select>
        )}
        {mode === 'kit' && (
          <select value={pickedKit} onChange={e => setPickedKit(e.target.value)} style={selStyle} aria-label="Pick a kit">
            <option value="">Pick one of your saved kits…</option>
            {kits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
        {mode === 'pattern' && (
          <select value={pickedPattern} onChange={e => setPickedPattern(e.target.value)} style={selStyle} aria-label="Pick a pattern">
            <option value="">Pick one of your saved patterns…</option>
            {patterns.map(p => <option key={p.id} value={p.id}>{p.name} — {p.bars} bar{p.bars === 1 ? '' : 's'}</option>)}
          </select>
        )}
        {mode === 'kit' && kits.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No saved kits yet — in a beat, tune a kit and press ＋ next to KIT.</p>
        )}
        {mode === 'pattern' && patterns.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No saved patterns yet — in a beat, program some hits and press ＋ next to PATTERN.</p>
        )}
        {mode === 'pack' && (
          <>
            <input value={packName} onChange={e => setPackName(e.target.value)} placeholder="Pack name (e.g. Dusty 808 kit)"
              style={{ ...selStyle, marginBottom: 8 }} />
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {entries.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No shareable samples yet (built-ins are excluded).</span>}
              {entries.map(e => (
                <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={packPicks.has(e.id)} onChange={ev => {
                    setPackPicks(prev => {
                      const next = new Set(prev)
                      if (ev.target.checked) next.add(e.id); else next.delete(e.id)
                      return next
                    })
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}{e.folder ? ` (${e.folder})` : ''}</span>
                </label>
              ))}
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>{packPicks.size} selected</p>
          </>
        )}
        {mode === 'preset' && presets.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No custom presets yet — create one from the piano roll’s sound menu (+ New Preset).</p>
        )}
        {mode === 'sample' && entries.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No shareable samples yet — record or import something first (built-ins are excluded).</p>
        )}

        {/* Tags */}
        <div style={{ display: 'flex', gap: 4, marginTop: 12, flexWrap: 'wrap' }}>
          {COMMUNITY_TAGS.map(t => (
            <button key={t} onClick={() => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : prev.length < 4 ? [...prev, t] : prev)} style={{
              fontSize: 9.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
              background: tags.includes(t) ? 'rgba(124,58,237,0.18)' : 'transparent',
              border: tags.includes(t) ? '1px solid rgba(167,139,250,0.5)' : '1px solid var(--border)',
              color: tags.includes(t) ? '#a78bfa' : 'var(--text-muted)',
            }}>#{t}</button>
          ))}
        </div>

        <textarea
          value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (what is it, how to use it)…"
          style={{ width: '100%', marginTop: 12, height: 64, resize: 'none', background: '#101010', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', boxSizing: 'border-box', outline: 'none' }}
        />

        {err && <p style={{ color: '#ef4444', fontSize: 11.5, margin: '8px 0 0' }}>{err}</p>}

        <button onClick={submit} disabled={working} style={{
          marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, opacity: working ? 0.6 : 1,
        }}>{working ? 'Sharing…' : 'Share'}</button>
      </div>
    </div>
  )
}

const selStyle: React.CSSProperties = {
  width: '100%', background: '#101010', border: '1px solid var(--border)', borderRadius: 7,
  color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
}
