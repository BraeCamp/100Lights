'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  STATIONS, STATION_STYLES, STATION_PALETTES, STATION_LOOKS, STATION_MODES, STATION_BRIGHTNESS, STATION_SPEEDS,
  type Station, type BroadcastTrack, type StationScene,
} from '@/lib/stations'
import { BG_CATEGORIES } from '@/lib/bg-library'
import { Radio, Search, ExternalLink, ChevronDown, Save, Trash2, Plus, Play, Copy, Check, ListMusic, ArrowUp, ArrowDown, X, RotateCcw, Sparkles } from 'lucide-react'

type StationRow = Station & { enabled: boolean; sort: number; edited?: boolean; fullScene?: Record<string, unknown>; updatedAt?: string; __new?: boolean }
interface JTrack { id: string; title: string; artist: string; audio: string; license: string; album?: string; duration?: number; shareurl?: string }

const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')
const inp = { padding: '8px 11px', borderRadius: 9, fontSize: 13, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)' } as const
const lbl = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 5px', display: 'block' } as const

const blankStation = (): StationRow => ({
  slug: '', title: 'New station', tagline: '', enabled: true, sort: 999, __new: true,
  scene: { style: 'bars', paletteId: 'aurora', videoLook: 'none', videoMode: 'none', videoSet: [], brightnessSet: [], speedSet: [], matchEnergy: true, reactive: true },
  jamendo: { tags: '', order: 'popularity_total', limit: 40 }, tracks: [], shuffle: true, showNowPlaying: true,
})

export default function RadioAdmin() {
  const [origin, setOrigin] = useState('https://100lights.com')
  useEffect(() => { setOrigin(window.location.origin) }, [])

  // ── stations (editable, DB-backed) ───────────────────────────────────────────
  const [stations, setStations] = useState<StationRow[]>(() => STATIONS.map((s, i) => ({ ...s, enabled: true, sort: i })))
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [credCopied, setCredCopied] = useState<string | null>(null)
  const load = () => fetch('/api/admin/broadcast/stations').then(r => r.json()).then(d => { if (Array.isArray(d.stations)) setStations(d.stations) }).catch(() => {})
  useEffect(() => { load() }, [])

  const patch = (slug: string, p: Partial<StationRow>) => setStations(prev => prev.map(s => s.slug === slug ? { ...s, ...p } : s))
  const patchScene = (slug: string, p: Partial<StationScene>) => setStations(prev => prev.map(s => s.slug === slug ? { ...s, scene: { ...s.scene, ...p } } : s))
  const patchTracks = (slug: string, tracks: BroadcastTrack[]) => patch(slug, { tracks })

  const save = async (s: StationRow) => {
    const slug = (s.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) { setSavedMsg('Give the station a slug first.'); return }
    setSaving(s.slug); setSavedMsg(null)
    try {
      const r = await fetch('/api/admin/broadcast/stations', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ station: { ...s, slug, __new: undefined } }) })
      const d = await r.json()
      if (d.error) { setSavedMsg(d.error) } else { setSavedMsg(`Saved “${s.title}” — live now.`); if (Array.isArray(d.stations)) setStations(d.stations); setOpen(slug); preview(slug) }   // re-resolve so the playlist + credits reflect the save
    } catch (e) { setSavedMsg(String(e)) } finally { setSaving(null) }
  }
  const remove = async (s: StationRow) => {
    if (s.__new) { setStations(prev => prev.filter(x => x !== s)); return }
    if (!window.confirm(`Delete station “${s.title}”? (The code default in lib/stations.ts is unaffected and can reseed if the table is emptied.)`)) return
    await fetch(`/api/admin/broadcast/stations?slug=${encodeURIComponent(s.slug)}`, { method: 'DELETE' })
    setStations(prev => prev.filter(x => x.slug !== s.slug)); if (open === s.slug) setOpen(null)
  }
  const toggleEnabled = async (s: StationRow) => {
    const enabled = !s.enabled; patch(s.slug, { enabled })
    if (!s.__new) await fetch('/api/admin/broadcast/stations', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: s.slug, enabled }) })
  }
  const addStation = () => { const s = blankStation(); setStations(prev => [...prev, s]); setOpen(s.slug); setSavedMsg(null) }
  const codeSlugs = useMemo(() => new Set(STATIONS.map(s => s.slug)), [])
  const resetAll = async () => {
    if (!window.confirm('Reset ALL stations to the built-in defaults?\n\nThis discards every edit in the panel and any custom/test stations, restoring the original lineup. (Files in public/broadcast/ are untouched.)')) return
    setSavedMsg('Resetting…')
    try { const r = await fetch('/api/admin/broadcast/stations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reset-all' }) }); const d = await r.json(); if (Array.isArray(d.stations)) setStations(d.stations); setPl({}); setOpen(null); setSavedMsg('Reset to defaults — live now.') } catch (e) { setSavedMsg(String(e)) }
  }
  const clearFullScene = async (s: StationRow) => {
    if (!window.confirm(`Clear the authored full look for “${s.title}”? The stream will fall back to the panel's Look settings.`)) return
    const r = await fetch('/api/admin/broadcast/stations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save-scene', slug: s.slug, fullScene: null }) })
    const d = await r.json(); if (d.error) { setSavedMsg(d.error); return }
    setStations(prev => prev.map(x => x.slug === s.slug ? { ...x, fullScene: undefined } : x)); setSavedMsg(`Cleared full look for “${s.title}”.`)
  }
  const resetOne = async (s: StationRow) => {
    if (!window.confirm(`Reset “${s.title}” to its built-in default? Discards this station's edits.`)) return
    const r = await fetch('/api/admin/broadcast/stations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reset', slug: s.slug }) })
    const d = await r.json(); if (d.error) { setSavedMsg(d.error); return }
    if (Array.isArray(d.stations)) setStations(d.stations); setPl(p => { const n = { ...p }; delete n[s.slug]; return n }); setSavedMsg(`Reset “${s.title}” to default — live now.`); if (open === s.slug) preview(s.slug)
  }

  // add a track to the currently-open station (used by the search results below)
  const addTrackToOpen = (t: BroadcastTrack) => {
    if (!open) { setSavedMsg('Open a station first, then add tracks to it.'); return }
    const s = stations.find(x => x.slug === open); if (!s) return
    patchTracks(open, [...(s.tracks || []), t])
    setSavedMsg(`Added “${t.title}” to ${s.title} — press Save to publish.`)
  }
  // Build a stored track from a Jamendo search hit, carrying a READABLE license + full attribution +
  // its Jamendo page — so the auto-generated credits (which read each track's `attribution`) stay
  // correct when you add/replace tracks. `license` is normalized to e.g. "CC BY-NC-SA 3.0" so the CC
  // detection in the credits block works (a raw CC url has no "CC" in it).
  const jToTrack = (t: JTrack): BroadcastTrack => {
    const lic = ccName(t.license)
    const cc = lic.startsWith('CC ')
    const attribution = cc
      ? `“${t.title}” by ${t.artist} (${lic}) — via Jamendo${t.shareurl ? ` · ${t.shareurl}` : ''}`
      : `“${t.title}” — ${t.artist} · Jamendo`
    return { title: t.title, artist: t.artist, url: t.audio, license: lic, attribution }
  }

  const url = (slug: string) => `${origin}/apps/lightningbug?station=${slug}&broadcast=1`
  const copyUrl = async (slug: string) => { try { await navigator.clipboard.writeText(url(slug)); setCopied(slug); setTimeout(() => setCopied(c => c === slug ? null : c), 1500) } catch {} }

  // ── playlist preview (what the station actually resolves to right now) ────────
  const [pl, setPl] = useState<Record<string, { tracks: BroadcastTrack[]; source: string } | 'loading'>>({})
  const preview = async (slug: string) => {
    setPl(p => ({ ...p, [slug]: 'loading' }))
    try { const r = await fetch(`/api/broadcast/playlist?station=${slug}`); const d = await r.json(); setPl(p => ({ ...p, [slug]: { tracks: d.tracks || [], source: d.source || '' } })) }
    catch { setPl(p => ({ ...p, [slug]: { tracks: [], source: 'error' } })) }
  }

  // ── Jamendo search + inspired-by (find tracks to add) ────────────────────────
  const [q, setQ] = useState(''); const [tagMode, setTagMode] = useState(false)
  const [order, setOrder] = useState('popularity_total'); const [commercialOnly, setCommercialOnly] = useState(false)
  const [results, setResults] = useState<JTrack[]>([]); const [sLoading, setSLoading] = useState(false); const [searched, setSearched] = useState(false); const [msg, setMsg] = useState<string | null>(null)
  const search = async () => {
    if (!q.trim()) return
    setSLoading(true); setSearched(true); setMsg(null)
    try {
      const parts = [tagMode ? `tags=${encodeURIComponent(q.trim().replace(/\s+/g, '+'))}` : `q=${encodeURIComponent(q.trim())}`, `order=${order}`]
      if (commercialOnly) parts.push('commercialOnly=1')
      const r = await fetch(`/api/admin/jamendo?${parts.join('&')}`); const d = await r.json()
      if (d.error) { setMsg(d.message || d.error); setResults([]) } else setResults(d.tracks || [])
    } catch { setResults([]) } finally { setSLoading(false) }
  }
  const ORDERS: [string, string][] = [['popularity_total', 'Popular (all-time)'], ['popularity_month', 'Popular (month)'], ['relevance', 'Relevance'], ['downloads_total', 'Most downloaded'], ['listens_total', 'Most listened'], ['releasedate_desc', 'Newest']]
  // Manual add-by-link: paste a jamendo.com/track/<id>/… URL (or a bare id) → resolve + add to the open station.
  const [pasteUrl, setPasteUrl] = useState(''); const [pasting, setPasting] = useState(false)
  const addByLink = async () => {
    if (!pasteUrl.trim()) return
    if (!open) { setMsg('Open a station first.'); return }
    setPasting(true); setMsg(null)
    try {
      const r = await fetch(`/api/admin/jamendo?id=${encodeURIComponent(pasteUrl.trim())}${commercialOnly ? '&commercialOnly=1' : ''}`); const d = await r.json()
      if (d.error) { setMsg(d.message || d.error); return }
      const t = (d.tracks || [])[0]; if (t) { addTrackToOpen(jToTrack(t)); setPasteUrl('') } else setMsg('No track found for that link.')
    } catch { setMsg('Could not resolve that link.') } finally { setPasting(false) }
  }
  const [prompt, setPrompt] = useState(''); const [iRes, setIRes] = useState<JTrack[]>([]); const [iLoading, setILoading] = useState(false); const [iMethod, setIMethod] = useState<string | null>(null); const [iNote, setINote] = useState<string | null>(null); const [iSearched, setISearched] = useState(false)
  const findInspired = async () => {
    if (!prompt.trim()) return
    setILoading(true); setISearched(true); setIMethod(null); setINote(null)
    try {
      const r = await fetch('/api/admin/inspired', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.trim() }) })
      const d = await r.json(); setIRes(d.tracks || []); setIMethod(d.method || null); setINote(d.interpretation?.note || d.note || null)
    } catch { setIRes([]) } finally { setILoading(false) }
  }
  const openStation = useMemo(() => stations.find(s => s.slug === open), [stations, open])

  // ── small UI helpers ─────────────────────────────────────────────────────────
  const Select = ({ value, opts, onChange }: { value: string; opts: readonly string[]; onChange: (v: string) => void }) => {
    const list = opts.includes(value) ? opts : [value, ...opts]
    return <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, padding: '7px 9px' }}>{list.map(o => <option key={o} value={o}>{o}</option>)}</select>
  }
  const Chips = ({ all, sel, onToggle }: { all: readonly string[]; sel: string[]; onToggle: (v: string) => void }) => (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {all.map(v => { const on = sel.includes(v); return (
        <button key={v} type="button" onClick={() => onToggle(v)} style={{ padding: '4px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'transparent', color: on ? '#0e0d12' : 'var(--text-secondary)' }}>{v}</button>
      ) })}
    </div>
  )
  const toggleIn = (arr: string[] | undefined, v: string) => { const a = arr || []; return a.includes(v) ? a.filter(x => x !== v) : [...a, v] }
  const Toggle = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'transparent', color: on ? '#0e0d12' : 'var(--text-secondary)' }}>{on ? '●' : '○'} {children}</button>
  )
  const btn = (bg: string, fg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: bg === 'transparent' ? '1px solid var(--border)' : 'none', background: bg, color: fg })

  // Two rows: title/meta + actions on top, then a FULL-WIDTH player so the scrubber is usable
  // (drag to seek anywhere in the track). preload="metadata" loads the duration for the seek bar.
  const trackRow = (title: string, sub: string, audio: string, right?: React.ReactNode) => (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
        </div>
        {right}
      </div>
      <audio controls preload="metadata" src={audio} style={{ height: 34, width: '100%', marginTop: 5 }} />
    </div>
  )
  const addBtn = (t: BroadcastTrack) => open ? <button type="button" onClick={() => addTrackToOpen(t)} title={`Add to ${openStation?.title}`} style={{ ...btn('var(--accent)', '#0e0d12'), padding: '6px 10px', flexShrink: 0 }}><Plus size={13} /> Add</button> : null

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: 720 }}>
        Create + edit broadcast stations — visual look, audio source, and playlist. Changes save to the database and take effect on the live stream with no redeploy. Open a station to add tracks (Jamendo search or paste a link). <a href="/apps/lightningbug/broadcast" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>Broadcast launcher →</a>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 10px' }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-secondary)', margin: 0 }}>Stations</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={resetAll} title="Restore every station to the built-in defaults (discards panel edits)" style={btn('transparent', 'var(--text-secondary)')}><RotateCcw size={15} /> Reset to defaults</button>
          <button type="button" onClick={addStation} style={btn('var(--accent)', '#0e0d12')}><Plus size={15} /> New station</button>
        </div>
      </div>
      {savedMsg && <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', margin: '0 0 10px' }}>{savedMsg}</p>}

      <div style={{ display: 'grid', gap: 10, marginBottom: 34 }}>
        {stations.map(s => {
          const isOpen = open === s.slug
          const scene = s.scene || {}
          const p = pl[s.slug]
          return (
            <div key={s.slug || '__new'} style={{ borderRadius: 12, border: `1px solid ${isOpen ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-card)', padding: '12px 16px', opacity: s.enabled ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" onClick={() => { const nowOpen = !isOpen; setOpen(nowOpen ? s.slug : null); if (nowOpen && !s.__new && !pl[s.slug]) preview(s.slug) }} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{s.title || '(untitled)'} {!s.enabled && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· disabled</span>}
                      {!s.__new && (s.edited
                        ? <span title="Customized in this panel — it no longer follows edits to lib/stations" style={{ fontSize: 10, fontWeight: 800, marginLeft: 6, padding: '1px 6px', borderRadius: 999, background: 'var(--accent)', color: '#0e0d12' }}>customized</span>
                        : codeSlugs.has(s.slug) ? <span title="Follows lib/stations — code edits show up automatically" style={{ fontSize: 10, fontWeight: 700, marginLeft: 6, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>follows code</span> : null)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.tagline || 'no tagline'} · <code>{s.slug || 'set a slug'}</code></div>
                  </div>
                  <ChevronDown size={18} style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
                </button>
                <Toggle on={s.enabled} onClick={() => toggleEnabled(s)}>on</Toggle>
              </div>

              {isOpen && (
                <div style={{ marginTop: 14, display: 'grid', gap: 16 }}>
                  {/* identity */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
                    <div><span style={lbl}>Title</span><input value={s.title} onChange={e => patch(s.slug, { title: e.target.value })} style={{ ...inp, width: '100%' }} /></div>
                    <div><span style={lbl}>Tagline</span><input value={s.tagline} onChange={e => patch(s.slug, { tagline: e.target.value })} style={{ ...inp, width: '100%' }} /></div>
                    <div><span style={lbl}>Slug {s.__new ? '' : '(fixed)'}</span><input value={s.slug} disabled={!s.__new} onChange={e => patch(s.slug, { slug: e.target.value })} placeholder="my-station" style={{ ...inp, width: '100%', opacity: s.__new ? 1 : 0.6 }} /></div>
                  </div>

                  {/* look */}
                  <div>
                    <span style={lbl}>Look</span>
                    {s.fullScene && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 8, borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--bg-base)' }}>
                        <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>A <strong>full look</strong> is authored — it overrides these controls on the stream. Re-author it with <strong>Author full look</strong> below, or</span>
                        <button type="button" onClick={() => clearFullScene(s)} style={{ ...btn('transparent', 'var(--text-secondary)'), padding: '4px 10px' }}>clear it</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Style <Select value={scene.style || 'none'} opts={STATION_STYLES} onChange={v => patchScene(s.slug, { style: v })} /></label>
                      <label style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Palette <Select value={scene.paletteId || 'aurora'} opts={STATION_PALETTES} onChange={v => patchScene(s.slug, { paletteId: v })} /></label>
                      <label style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Grade <Select value={scene.videoLook || 'none'} opts={STATION_LOOKS} onChange={v => patchScene(s.slug, { videoLook: v })} /></label>
                      <label style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Mode <Select value={scene.videoMode || 'none'} opts={STATION_MODES} onChange={v => patchScene(s.slug, { videoMode: v })} /></label>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div><span style={{ ...lbl, margin: '0 0 4px' }}>Background categories {scene.videoSet?.length ? '' : '(all)'}</span><Chips all={BG_CATEGORIES} sel={scene.videoSet || []} onToggle={v => patchScene(s.slug, { videoSet: toggleIn(scene.videoSet, v) })} /></div>
                      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                        <div><span style={{ ...lbl, margin: '0 0 4px' }}>Brightness</span><Chips all={STATION_BRIGHTNESS} sel={scene.brightnessSet || []} onToggle={v => patchScene(s.slug, { brightnessSet: toggleIn(scene.brightnessSet, v) as StationScene['brightnessSet'] })} /></div>
                        <div><span style={{ ...lbl, margin: '0 0 4px' }}>Motion speed</span><Chips all={STATION_SPEEDS} sel={scene.speedSet || []} onToggle={v => patchScene(s.slug, { speedSet: toggleIn(scene.speedSet, v) as StationScene['speedSet'] })} /></div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Toggle on={!!scene.matchEnergy} onClick={() => patchScene(s.slug, { matchEnergy: !scene.matchEnergy })}>match energy</Toggle>
                        <Toggle on={scene.reactive !== false} onClick={() => patchScene(s.slug, { reactive: !(scene.reactive !== false) })}>reactive</Toggle>
                      </div>
                    </div>
                  </div>

                  {/* auto editing — how busy the cuts/effects get (calm radio → off/low; hype → on/high) */}
                  <div>
                    <span style={lbl}>Auto editing</span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                      <Toggle on={scene.autoEdit !== false} onClick={() => patchScene(s.slug, { autoEdit: !(scene.autoEdit !== false) })}>effects &amp; cuts</Toggle>
                      <Toggle on={scene.autoSpeed !== false} onClick={() => patchScene(s.slug, { autoSpeed: !(scene.autoSpeed !== false) })}>speed to music</Toggle>
                      <Toggle on={!!scene.beatColor} onClick={() => patchScene(s.slug, { beatColor: !scene.beatColor })}>colour on beat</Toggle>
                    </div>
                    <label style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, maxWidth: 340 }}>
                      cut rate <span style={{ color: 'var(--text-muted)' }}>slower</span>
                      <input type="range" min={0.5} max={2} step={0.1} value={scene.editRate ?? 1} onChange={e => patchScene(s.slug, { editRate: +e.target.value })} style={{ flex: 1 }} />
                      <span style={{ color: 'var(--text-muted)' }}>faster</span>
                      <strong style={{ minWidth: 30, textAlign: 'right' }}>{(scene.editRate ?? 1).toFixed(1)}×</strong>
                    </label>
                  </div>

                  {/* audio source */}
                  <div>
                    <span style={lbl}>Audio source <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>— resolved newest-wins: local files → the list below → Jamendo tags</span></span>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Jamendo tags <input value={s.jamendo?.tags || ''} onChange={e => patch(s.slug, { jamendo: { ...(s.jamendo || { order: 'popularity_total', limit: 40 }), tags: e.target.value } })} placeholder="lofi+chill+study" style={{ ...inp, padding: '6px 9px', width: 200 }} /></label>
                      <label style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>limit <input type="number" value={s.jamendo?.limit ?? 40} onChange={e => patch(s.slug, { jamendo: { ...(s.jamendo || { tags: '' }), limit: Number(e.target.value) } })} style={{ ...inp, padding: '6px 9px', width: 64 }} /></label>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Most reliable for 24/7: drop files in <code>public/broadcast/{s.slug || '<slug>'}/</code></span>
                    </div>
                    {/* fixed playlist */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>Fixed playlist ({s.tracks?.length || 0}) — plays before Jamendo</span>
                        <button type="button" onClick={() => preview(s.slug)} style={{ ...btn('transparent', 'var(--text-secondary)'), padding: '5px 10px' }}><ListMusic size={13} /> Refresh playlist</button>
                      </div>
                      {(s.tracks || []).map((t, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div><div style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.artist || ''}{t.license ? ` · ${t.license}` : ''}</div></div>
                          <button type="button" onClick={() => patchTracks(s.slug, move(s.tracks!, i, -1))} disabled={i === 0} style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}><ArrowUp size={14} /></button>
                          <button type="button" onClick={() => patchTracks(s.slug, move(s.tracks!, i, 1))} disabled={i === (s.tracks!.length - 1)} style={{ ...iconBtn, opacity: i === (s.tracks!.length - 1) ? 0.3 : 1 }}><ArrowDown size={14} /></button>
                          <button type="button" onClick={() => patchTracks(s.slug, s.tracks!.filter((_, j) => j !== i))} title="Remove this song" style={iconBtn}><X size={14} /></button>
                        </div>
                      ))}

                      {/* Add songs — Jamendo search + paste-a-link, both add to THIS station's fixed list */}
                      <div style={{ marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>Add songs</span>
                        <form onSubmit={e => { e.preventDefault(); search() }} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0' }}>
                          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tagMode ? 'tags (ambient, lofi…)' : 'search Jamendo — song or artist'} style={{ ...inp, flex: '1 1 190px', minWidth: 150, padding: '7px 10px' }} />
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-secondary)' }}><input type="checkbox" checked={tagMode} onChange={e => setTagMode(e.target.checked)} /> by tag</label>
                          <select value={order} onChange={e => setOrder(e.target.value)} style={{ ...inp, padding: '7px 8px' }}>{ORDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-secondary)' }} title="Exclude NonCommercial (CC BY-NC*)"><input type="checkbox" checked={commercialOnly} onChange={e => setCommercialOnly(e.target.checked)} /> commercial-safe</label>
                          <button type="submit" disabled={sLoading || !q.trim()} style={{ ...btn('var(--accent)', '#0e0d12'), padding: '7px 12px', opacity: sLoading || !q.trim() ? 0.5 : 1 }}><Search size={13} /> {sLoading ? '…' : 'Search'}</button>
                        </form>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>or paste a Jamendo link</span>
                          <input value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addByLink() } }} placeholder="https://www.jamendo.com/track/1886512/…" style={{ ...inp, flex: '1 1 210px', minWidth: 170, padding: '7px 10px' }} />
                          <button type="button" onClick={addByLink} disabled={pasting || !pasteUrl.trim()} style={{ ...btn('transparent', 'var(--text-secondary)'), padding: '7px 12px', opacity: pasting || !pasteUrl.trim() ? 0.5 : 1 }}><Plus size={13} /> {pasting ? 'Adding…' : 'Add link'}</button>
                        </div>
                        {msg && <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', margin: '0 0 6px' }}>{msg}</p>}
                        {searched && !sLoading && (results.length
                          ? <div style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>{results.map(t => trackRow(t.title, [t.artist, t.album, dur(t.duration), ccName(t.license)].filter(Boolean).join(' · '), t.audio, <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>{addBtn(jToTrack(t))}{t.shareurl && <a href={t.shareurl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}><ExternalLink size={15} /></a>}</div>))}</div>
                          : <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>No results — try different words or “by tag”.</p>)}
                      </div>

                      {p === 'loading' && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>Resolving…</p>}
                      {p && p !== 'loading' && (
                        <div style={{ marginTop: 6 }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 2px' }}>Now on air: {p.tracks.length} track{p.tracks.length === 1 ? '' : 's'} · source: <strong>{p.source}</strong>{s.shuffle !== false ? ' · shuffled' : ' · in order'}</p>
                          {p.source === 'local' && <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 4px' }}>Files in public/broadcast/{s.slug}/ (these override the fixed list + Jamendo).</p>}
                          {p.tracks.length === 0
                            ? <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '2px 0 0' }}>Empty — add tracks below, set Jamendo tags, or drop files in public/broadcast/{s.slug}/.</p>
                            : <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                                {p.tracks.map((t, i) => trackRow(
                                  `${i + 1}. ${t.title}`,
                                  [t.artist, t.genre, ccName(t.license)].filter(Boolean).join(' · '),
                                  t.url,
                                ))}
                              </div>}
                          {/* Credits — generated LIVE from this playlist, so add/remove/replace here updates them too. */}
                          {p.tracks.length > 0 && (
                            <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Credits (auto from this playlist)</span>
                                <button type="button" onClick={() => { navigator.clipboard.writeText(creditBlock(s.title, p.tracks)).then(() => { setCredCopied(s.slug); setTimeout(() => setCredCopied(c => c === s.slug ? null : c), 1500) }).catch(() => {}) }} style={{ ...btn('transparent', 'var(--text-secondary)'), padding: '4px 10px' }}>{credCopied === s.slug ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy for description</>}</button>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, maxHeight: 140, overflowY: 'auto', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
                                {creditLines(p.tracks).map((l, i) => <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>• {l}</div>)}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* flags + actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Toggle on={s.shuffle !== false} onClick={() => patch(s.slug, { shuffle: !(s.shuffle !== false) })}>shuffle</Toggle>
                    <Toggle on={s.showNowPlaying !== false} onClick={() => patch(s.slug, { showNowPlaying: !(s.showNowPlaying !== false) })}>now-playing card</Toggle>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <button type="button" onClick={() => save(s)} disabled={saving === s.slug} style={btn('var(--accent)', '#0e0d12')}><Save size={15} /> {saving === s.slug ? 'Saving…' : 'Save'}</button>
                    {!s.__new && <a href={`${origin}/apps/lightningbug?broadcastEdit=${encodeURIComponent(s.slug)}`} target="_blank" rel="noreferrer" title="Open the full Lightning Bug editor for this broadcast (all settings), then Save to broadcast" style={{ ...btn('transparent', 'var(--text-secondary)'), textDecoration: 'none' }}><Sparkles size={15} /> Author full look{s.fullScene ? ' ✓' : ''}</a>}
                    {!s.__new && <a href={url(s.slug)} target="_blank" rel="noreferrer" style={{ ...btn('transparent', 'var(--text-secondary)'), textDecoration: 'none' }}><Play size={15} /> Open</a>}
                    {!s.__new && <button type="button" onClick={() => copyUrl(s.slug)} style={btn('transparent', 'var(--text-secondary)')}>{copied === s.slug ? <><Check size={15} /> Copied</> : <><Copy size={15} /> OBS URL</>}</button>}
                    {!s.__new && codeSlugs.has(s.slug) && <button type="button" onClick={() => resetOne(s)} title="Restore this station to its built-in default" style={btn('transparent', 'var(--text-secondary)')}><RotateCcw size={15} /> Reset</button>}
                    <button type="button" onClick={() => remove(s)} style={{ ...btn('transparent', '#f87171'), marginLeft: 'auto' }}><Trash2 size={15} /> Delete</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Discover by vibe (inspired-by). Per-song search + paste-link live inside each open station. */}
      <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Discover by vibe {open ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>· “Add” → {openStation?.title}</span> : <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>· open a station to add</span>}</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 8px' }}>To add/remove specific songs, open a station and use its <strong>Add songs</strong> search (or paste a Jamendo link) — each song has a ✕ to delete it.</p>

      {/* Inspired by… */}
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '8px 0 6px', fontWeight: 700 }}>Inspired by…</p>
      <form onSubmit={e => { e.preventDefault(); findInspired() }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. dreamy dark synthpop · tense dungeon exploration · warm cozy jazz" style={{ ...inp, flex: '1 1 320px', minWidth: 220 }} />
        <button type="submit" disabled={iLoading || !prompt.trim()} style={{ ...btn('var(--accent)', '#0e0d12'), opacity: iLoading || !prompt.trim() ? 0.5 : 1 }}><Search size={14} /> {iLoading ? 'Thinking…' : 'Find'}</button>
      </form>
      {iSearched && !iLoading && (
        <>
          {iMethod && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 6px' }}>{iMethod === 'audio-embeddings' ? '🔊 matched by sound' : '🤖 AI-interpreted search'}{iNote ? ` · ${iNote}` : ''}</p>}
          {iRes.length ? <div style={{ maxHeight: 460, overflowY: 'auto', paddingRight: 4, marginBottom: 24 }}>{iRes.map(t => trackRow(t.title, t.artist, t.audio, <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>{addBtn(jToTrack(t))}{t.shareurl && <a href={t.shareurl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}><ExternalLink size={15} /></a>}</div>))}</div>
            : <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 24px' }}>Nothing came back — try describing the vibe differently.</p>}
        </>
      )}

    </div>
  )
}

const iconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', flexShrink: 0 }
function move<T>(arr: T[], i: number, dir: number): T[] {
  const j = i + dir; if (j < 0 || j >= arr.length) return arr
  const next = [...arr];[next[i], next[j]] = [next[j], next[i]]; return next
}

// Normalize a Jamendo/CC license (a raw creativecommons URL, or already-readable text) to a short
// human label like "CC BY-NC-SA 3.0" — used in the track sub-line AND stored so credits read right.
function ccName(license: string | undefined): string {
  const s = license || ''
  const m = s.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/i)
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`
  if (/^cc\b/i.test(s)) return s
  return s || 'Jamendo'
}

// The deduped credit lines for a set of tracks (same rule the broadcast launcher's "Copy credits" uses).
function creditLines(tracks: { title: string; artist?: string; attribution?: string }[]): string[] {
  return [...new Set(tracks.map(t => t.attribution || `${t.title}${t.artist ? ` — ${t.artist}` : ''}`))]
}
function creditBlock(title: string, tracks: { title: string; artist?: string; attribution?: string; license?: string }[]): string {
  const anyCC = tracks.some(t => (t.license || '').toUpperCase().includes('CC'))
  return [
    `♪ Music in this stream — ${title}:`,
    ...creditLines(tracks).map(l => `• ${l}`),
    '',
    anyCC ? 'Some tracks under Creative Commons — see each line for the specific licence: https://creativecommons.org/licenses/' : '',
    'Visuals: Lightning Bug (100lights.com).',
  ].filter(Boolean).join('\n')
}
