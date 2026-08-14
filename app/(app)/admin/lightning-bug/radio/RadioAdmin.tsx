'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  STATIONS, STATION_STYLES, STATION_PALETTES, STATION_LOOKS, STATION_MODES, STATION_BRIGHTNESS, STATION_SPEEDS,
  type Station, type BroadcastTrack, type StationScene,
} from '@/lib/stations'
import { BG_CATEGORIES } from '@/lib/bg-library'
import { Radio, Search, ExternalLink, ChevronDown, Save, Trash2, Plus, Play, Copy, Check, ListMusic, ArrowUp, ArrowDown, X } from 'lucide-react'

type StationRow = Station & { enabled: boolean; sort: number; updatedAt?: string; __new?: boolean }
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
      if (d.error) { setSavedMsg(d.error) } else { setSavedMsg(`Saved “${s.title}” — live now.`); if (Array.isArray(d.stations)) setStations(d.stations); setOpen(slug) }
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

  // add a track to the currently-open station (used by the search results below)
  const addTrackToOpen = (t: BroadcastTrack) => {
    if (!open) { setSavedMsg('Open a station first, then add tracks to it.'); return }
    const s = stations.find(x => x.slug === open); if (!s) return
    patchTracks(open, [...(s.tracks || []), t])
    setSavedMsg(`Added “${t.title}” to ${s.title} — press Save to publish.`)
  }
  const jToTrack = (t: JTrack): BroadcastTrack => ({ title: t.title, artist: t.artist, url: t.audio, license: t.license, attribution: `${t.title} — ${t.artist} · Jamendo` })

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
  const [results, setResults] = useState<JTrack[]>([]); const [sLoading, setSLoading] = useState(false); const [searched, setSearched] = useState(false); const [msg, setMsg] = useState<string | null>(null)
  const search = async () => {
    if (!q.trim()) return
    setSLoading(true); setSearched(true); setMsg(null)
    try {
      const param = tagMode ? `tags=${encodeURIComponent(q.trim().replace(/\s+/g, '+'))}` : `q=${encodeURIComponent(q.trim())}`
      const r = await fetch(`/api/admin/jamendo?${param}`); const d = await r.json()
      if (d.error) { setMsg(d.message || d.error); setResults([]) } else setResults(d.tracks || [])
    } catch { setResults([]) } finally { setSLoading(false) }
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

  const trackRow = (title: string, sub: string, audio: string, right?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      <audio controls preload="none" src={audio} style={{ height: 30, flex: '1 1 200px', maxWidth: 300 }} />
      {right}
    </div>
  )
  const addBtn = (t: BroadcastTrack) => open ? <button type="button" onClick={() => addTrackToOpen(t)} title={`Add to ${openStation?.title}`} style={{ ...btn('var(--accent)', '#0e0d12'), padding: '6px 10px', flexShrink: 0 }}><Plus size={13} /> Add</button> : null

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 18px 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}><Radio size={22} /> Lightning Bug — Radio control panel</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px', maxWidth: 720 }}>
        Create + edit broadcast stations — visual look, audio source, and playlist. Changes save to the database and take effect on the live stream with no redeploy. Search Jamendo below to add tracks to whichever station is open.
      </p>
      <p style={{ fontSize: 12.5, margin: '0 0 20px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href="/admin/lightning-bug" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>← Background library</a>
        <a href="/apps/lightningbug/broadcast" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>Broadcast launcher →</a>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 10px' }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-secondary)', margin: 0 }}>Stations</h2>
        <button type="button" onClick={addStation} style={btn('var(--accent)', '#0e0d12')}><Plus size={15} /> New station</button>
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
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{s.title || '(untitled)'} {!s.enabled && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· disabled</span>}</div>
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
                          <button type="button" onClick={() => patchTracks(s.slug, s.tracks!.filter((_, j) => j !== i))} style={iconBtn}><X size={14} /></button>
                        </div>
                      ))}
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
                                  [t.artist, t.genre, t.license?.replace('http://creativecommons.org/licenses/', 'CC ').replace(/\/$/, '')].filter(Boolean).join(' · '),
                                  t.url,
                                ))}
                              </div>}
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
                    {!s.__new && <a href={url(s.slug)} target="_blank" rel="noreferrer" style={{ ...btn('transparent', 'var(--text-secondary)'), textDecoration: 'none' }}><Play size={15} /> Open</a>}
                    {!s.__new && <button type="button" onClick={() => copyUrl(s.slug)} style={btn('transparent', 'var(--text-secondary)')}>{copied === s.slug ? <><Check size={15} /> Copied</> : <><Copy size={15} /> OBS URL</>}</button>}
                    <button type="button" onClick={() => remove(s)} style={{ ...btn('transparent', '#f87171'), marginLeft: 'auto' }}><Trash2 size={15} /> Delete</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add tracks — Jamendo + inspired-by. Results add to whichever station is open. */}
      <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Find tracks {open ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>· “Add” → {openStation?.title}</span> : <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>· open a station above to add</span>}</h2>

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

      {/* Jamendo search */}
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 6px', fontWeight: 700 }}>Search Jamendo</p>
      <form onSubmit={e => { e.preventDefault(); search() }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tagMode ? 'tags (e.g. ambient cinematic drone)' : 'song or artist name'} style={{ ...inp, flex: '1 1 260px', minWidth: 200 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)' }}><input type="checkbox" checked={tagMode} onChange={e => setTagMode(e.target.checked)} /> by tag</label>
        <button type="submit" disabled={sLoading || !q.trim()} style={{ ...btn('var(--accent)', '#0e0d12'), opacity: sLoading || !q.trim() ? 0.5 : 1 }}><Search size={14} /> {sLoading ? 'Searching…' : 'Search'}</button>
        {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>{msg}</span>}
      </form>
      {searched && !sLoading && (
        results.length ? <div style={{ maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>{results.map(t => trackRow(t.title, `${t.artist}${t.album ? ` · ${t.album}` : ''}${t.duration ? ` · ${dur(t.duration)}` : ''}`, t.audio, <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>{addBtn(jToTrack(t))}{t.shareurl && <a href={t.shareurl} target="_blank" rel="noreferrer" title="Open on Jamendo" style={{ color: 'var(--text-muted)' }}><ExternalLink size={15} /></a>}</div>))}</div>
          : <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No results — try different words, or toggle “by tag”.</p>
      )}
    </main>
  )
}

const iconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', flexShrink: 0 }
function move<T>(arr: T[], i: number, dir: number): T[] {
  const j = i + dir; if (j < 0 || j >= arr.length) return arr
  const next = [...arr];[next[i], next[j]] = [next[j], next[i]]; return next
}
