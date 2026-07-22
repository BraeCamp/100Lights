'use client'

// Fix any demo clip by replacing its file. Each clip shows the current audio,
// a download, and an "Upload replacement" — drop in your own corrected file and
// it serves everywhere the clip is used. Revert goes back to the generated one.

import { useEffect, useRef, useState } from 'react'

type Clip = { file: string; label: string }
type Group = { title: string; clips: Clip[] }

const GROUPS: Group[] = [
  {
    title: 'Can You Hear the Difference',
    clips: [
      { file: 'hear-comp-off', label: '1 · Compression — DRY' },
      { file: 'hear-comp-on', label: '1 · Compression — COMPRESSED' },
      { file: 'hear-eq-cut', label: '2 · EQ — low-mids CUT' },
      { file: 'hear-eq-boost', label: '2 · EQ — low-mids BOOSTED' },
      { file: 'hear-verb-08', label: '3 · Reverb — SHORT tail' },
      { file: 'hear-verb-14', label: '3 · Reverb — LONG tail' },
      { file: 'hear-hats-0', label: '4 · Hats — normal' },
      { file: 'hear-hats-plus1', label: '4 · Hats — louder' },
    ],
  },
  { title: 'Sidechain', clips: [{ file: 'duck-off', label: 'Bass held' }, { file: 'duck-on', label: 'Bass ducked' }] },
  { title: 'Mixing — high-pass', clips: [{ file: 'mix-mud', label: 'Full-range (mud)' }, { file: 'mix-hp', label: 'High-passed' }] },
  { title: 'Mixing — panning', clips: [{ file: 'mix-pan-center', label: 'Centre' }, { file: 'mix-pan-wide', label: 'Panned wide' }] },
  { title: 'Looping — the click', clips: [{ file: 'loop-clean', label: 'Clean seam' }, { file: 'loop-click', label: 'Clicks' }] },
  { title: 'Ten licks — pedal point', clips: [{ file: 'pedal-roots', label: 'Roots' }, { file: 'pedal-drone', label: 'Drone' }] },
  { title: 'Piano roll — the hook', clips: [{ file: 'hook-identical', label: 'Identical repeat' }, { file: 'hook-moved', label: 'Moved repeat' }] },
  { title: 'Song structure', clips: [{ file: 'eight-static', label: 'Never changes' }, { file: 'eight-developed', label: 'Drops an element' }] },
  { title: 'Free sample packs', clips: [{ file: 'snare-clean', label: 'Clean snare' }, { file: 'snare-layered', label: 'Layered clap' }] },
  { title: 'You don’t need better gear', clips: [{ file: 'gear-competing', label: 'Competing' }, { file: 'gear-rebalanced', label: 'Rebalanced' }] },
  { title: 'What is a DAW', clips: [{ file: 'daw-loop', label: 'Bored-loop demo' }] },
]

export default function AudioManager() {
  const [overrides, setOverrides] = useState<Set<string>>(new Set())
  const [ver, setVer] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const refresh = () => fetch('/api/admin/demo-audio').then(r => r.ok ? r.json() : null).then(d => { if (d) setOverrides(new Set(d.overrides as string[])) }).catch(() => {})
  useEffect(() => { refresh() }, [])

  const bump = (clip: string) => setVer(v => ({ ...v, [clip]: (v[clip] ?? 0) + 1 }))

  async function upload(clip: string, file: File) {
    if (!/^audio\//.test(file.type)) { setMsg(`${clip}: not an audio file`); return }
    setBusy(clip); setMsg('')
    const r = await fetch(`/api/admin/demo-audio/${clip}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    setBusy(null)
    if (r?.ok) { setOverrides(s => new Set(s).add(clip)); bump(clip); setMsg(`${clip}: replaced ✓`) }
    else setMsg(`${clip}: ${d?.error ?? 'upload failed'}`)
  }

  async function revert(clip: string) {
    setBusy(clip); setMsg('')
    const r = await fetch(`/api/admin/demo-audio/${clip}`, { method: 'DELETE' }).catch(() => null)
    setBusy(null)
    if (r?.ok) { setOverrides(s => { const n = new Set(s); n.delete(clip); return n }); bump(clip); setMsg(`${clip}: reverted to generated`) }
    else setMsg(`${clip}: revert failed`)
  }

  const btn: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'none' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '36px 20px 90px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px' }}>Fix the demo clips</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 6px', lineHeight: 1.6 }}>
          If a clip is wrong, fix it however you like — make a corrected version (the studio works), then <strong>Upload replacement</strong>.
          It replaces the generated one everywhere that clip is used. <strong>Revert</strong> puts the generated one back.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 26px' }}>{msg || 'Changes go live within about a minute (players cache briefly).'}</p>

        {GROUPS.map(g => (
          <section key={g.title} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 750, margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{g.title}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {g.clips.map(c => {
                const overridden = overrides.has(c.file)
                const src = `/api/demo-audio/${c.file}?v=${ver[c.file] ?? 0}`
                return (
                  <div key={c.file} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{c.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, letterSpacing: '0.04em', color: overridden ? '#34d399' : 'var(--text-muted)', border: `1px solid ${overridden ? 'rgba(52,211,153,0.4)' : 'var(--border)'}` }}>
                        {overridden ? 'REPLACED' : 'generated'}
                      </span>
                    </div>
                    <audio key={src} controls preload="none" src={src} style={{ width: '100%', height: 38 }} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a href={`/new?modules=audio&importAudio=${encodeURIComponent(`/api/demo-audio/${c.file}`)}&importName=${encodeURIComponent(c.label)}`} target="_blank" rel="noreferrer"
                        style={{ ...btn, borderColor: 'var(--accent)', color: 'var(--accent-light)' }}>Edit in studio ↗</a>
                      <a href={`/api/demo-audio/${c.file}`} download={`${c.file}.wav`} style={btn}>Download</a>
                      <label style={{ ...btn, opacity: busy === c.file ? 0.5 : 1 }}>
                        {busy === c.file ? 'Uploading…' : 'Upload replacement'}
                        <input ref={el => { inputs.current[c.file] = el }} type="file" accept="audio/*" style={{ display: 'none' }}
                          onChange={e => { const f = e.target.files?.[0]; if (f) void upload(c.file, f); e.target.value = '' }} />
                      </label>
                      {overridden && <button onClick={() => void revert(c.file)} disabled={busy === c.file} style={{ ...btn, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Revert to generated</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
