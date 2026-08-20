'use client'
// Preset management: name, browse factory/user presets, save/load,
// import/export JSON, init, randomize.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApollo, ToggleBtn } from './ApolloContext'
import { ApolloPatch, initPatch, defaultFx, uid, ModSource, FxType, WarpMode, FilterType } from '@/lib/apollo/patch'
import { FACTORY_PRESETS } from '@/lib/apollo/presets'
import { saveBounceToLibrary, getApolloSourceSample, overwriteLibrarySample } from '@/lib/apollo/sample-store'
import { audioBufferToWav } from '@/lib/wav-encoder'
import { shareAppItem, getCommunityItem, countDownload } from '@/lib/community'

const LS_PRESETS = 'apollo_presets_v1'

interface UserPreset { name: string; json: string }

function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS)
    if (raw) return JSON.parse(raw) as UserPreset[]
  } catch { /* corrupt list */ }
  return []
}

// Merge downloaded presets into the user's list. Name clashes get " (2)"-style
// suffixes instead of overwriting anything the user already saved.
function mergePresets(existing: UserPreset[], incoming: UserPreset[]): UserPreset[] {
  const out = [...existing]
  const names = new Set(out.map(u => u.name))
  for (const inc of incoming) {
    if (!inc?.name || typeof inc.json !== 'string') continue
    let name = inc.name
    for (let i = 2; names.has(name); i++) name = `${inc.name} (${i})`
    names.add(name)
    out.push({ name, json: inc.json })
  }
  return out
}

export default function PresetBar() {
  const ctx = useApollo()
  const [editingName, setEditingName] = useState(false)
  const [fileOpen, setFileOpen] = useState(false)
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])
  const [installedMsg, setInstalledMsg] = useState('')
  useEffect(() => { setUserPresets(loadUserPresets()) }, [])
  const fileRef = useRef<HTMLInputElement>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!fileOpen) return
    const onDown = (e: PointerEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) setFileOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [fileOpen])

  const applyPatch = useCallback((loaded: Partial<ApolloPatch>) => {
    const merged = { ...initPatch(), ...loaded } as ApolloPatch
    ctx.update(p => {
      for (const key of Object.keys(merged) as (keyof ApolloPatch)[]) {
        ;(p as unknown as Record<string, unknown>)[key] = merged[key]
      }
      // re-send LFO luts + tables happens inside sendPatch via update
    })
  }, [ctx])

  // Community install: /apollo?communityPatch=<id> loads a shared patch (the
  // Community feed's "Open in Apollo" action). One-shot on mount.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('communityPatch')
    if (!id) return
    void getCommunityItem(id).then(item => {
      const patch = (item?.payload as { patch?: Partial<ApolloPatch> } | null)?.patch
      if (patch) applyPatch(patch)
    }).catch(() => { /* item gone — start normally */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pack install: /apollo?communityPack=<id> downloads every preset in a shared
  // pack into the user's preset list ("Install in Apollo" on Preset Pack cards).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('communityPack')
    if (!id) return
    void getCommunityItem(id).then(item => {
      const presets = (item?.payload as { presets?: UserPreset[] } | null)?.presets
      if (!Array.isArray(presets) || presets.length === 0) return
      setUserPresets(prev => {
        const next = mergePresets(prev, presets)
        try { localStorage.setItem(LS_PRESETS, JSON.stringify(next)) } catch { /* quota */ }
        return next
      })
      setInstalledMsg(`Installed ${presets.length} preset${presets.length === 1 ? '' : 's'} from “${item?.name ?? 'pack'}”`)
      void countDownload(id)
    }).catch(() => { /* item gone — start normally */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allPresets = useMemo(() => [
    ...FACTORY_PRESETS.map(fp => ({ group: 'Factory', name: fp.name, load: () => applyPatch(structuredClone(fp.patch)) })),
    ...userPresets.map(up => ({ group: 'User', name: up.name, load: () => { try { applyPatch(JSON.parse(up.json) as Partial<ApolloPatch>) } catch { /* bad json */ } } })),
  ], [userPresets, applyPatch])

  const currentIdx = allPresets.findIndex(pr => pr.name === ctx.patch.name)

  const step = (dir: number) => {
    if (!allPresets.length) return
    const next = ((currentIdx < 0 ? 0 : currentIdx + dir) + allPresets.length) % allPresets.length
    allPresets[next].load()
  }

  const save = () => {
    const name = ctx.patch.name.trim() || 'Untitled'
    const json = JSON.stringify(ctx.patch)
    const next = [...userPresets.filter(u => u.name !== name), { name, json }]
    setUserPresets(next)
    try { localStorage.setItem(LS_PRESETS, JSON.stringify(next)) } catch { /* quota */ }
  }

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(ctx.patch, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${ctx.patch.name || 'apollo-patch'}.apollo.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }


  // Mutate: small musical nudges instead of a full re-roll

  // A/B compare: store a B snapshot, then swap back and forth
  const abRef = useRef<string | null>(null)
  const [abStored, setAbStored] = useState(false)
  const abToggle = () => {
    if (abRef.current == null) {
      abRef.current = JSON.stringify(ctx.patch)
      setAbStored(true)
      return
    }
    const other = abRef.current
    abRef.current = JSON.stringify(ctx.patch)
    try { applyPatch(JSON.parse(other) as Partial<ApolloPatch>) } catch { /* bad snapshot */ }
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button style={navBtn} onClick={() => step(-1)} title="Previous preset">◀</button>
      <select
        value={currentIdx >= 0 ? String(currentIdx) : ''}
        onChange={e => { const k = Number(e.target.value); if (!Number.isNaN(k) && allPresets[k]) allPresets[k].load() }}
        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 11, width: 128 }}
      >
        <option value="" disabled>{ctx.patch.name || 'Presets…'}</option>
        <optgroup label="Factory">
          {allPresets.map((pr, k) => pr.group === 'Factory' && <option key={pr.name} value={String(k)}>{pr.name}</option>)}
        </optgroup>
        <optgroup label="User">
          {allPresets.map((pr, k) => pr.group === 'User' && <option key={pr.name + k} value={String(k)}>{pr.name}</option>)}
        </optgroup>
      </select>
      <button style={navBtn} onClick={() => step(1)} title="Next preset">▶</button>
      {editingName ? (
        <input
          autoFocus defaultValue={ctx.patch.name}
          onBlur={e => { setEditingName(false); const nm = e.target.value.trim(); if (nm) ctx.update(p => { p.name = nm }) }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={{ width: 120, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--accent)', borderRadius: 6, fontSize: 11, padding: '3px 6px' }}
        />
      ) : (
        <span
          onDoubleClick={() => setEditingName(true)}
          title="Double-click to rename"
          style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', cursor: 'text', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{ctx.patch.name}</span>
      )}
      <ToggleBtn on={false} label="Save" onClick={save} title="Save to browser presets" />
      <ToggleBtn on={false} label="Init" onClick={() => applyPatch(initPatch())} />
      <ToggleBtn on={abStored} label="A/B" title={abStored ? 'Swap with the stored B patch' : 'Store current as B, then swap back and forth'} onClick={abToggle} />
      {/* File ▾ — Export / Import / Bounce / Share in one place (fewer buttons;
          Random/Mutate moved onto the modules they affect, as 🎲 dice) */}
      <div ref={fileMenuRef} style={{ position: 'relative' }}>
        <ToggleBtn on={fileOpen} label="File ▾" title="Export, import, bounce to audio, share to Community" onClick={() => setFileOpen(o => !o)} />
        {fileOpen && (
          <div
            style={{
              position: 'absolute', top: '110%', right: 0, zIndex: 210, minWidth: 190,
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
              padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <ToggleBtn on={false} label="Export patch (.json)" onClick={() => { exportFile(); setFileOpen(false) }} />
            <ToggleBtn on={false} label="Import patch…" onClick={() => { fileRef.current?.click(); setFileOpen(false) }} />
            <div style={{ borderTop: '1px solid var(--border)' }} />
            <BounceButton />
            <ShareButton />
            <SharePackButton userPresets={userPresets} />
          </div>
        )}
      </div>
      {installedMsg && (
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: 'var(--accent, #5eead4)', background: 'rgba(94,234,212,0.08)',
          border: '1px solid rgba(94,234,212,0.35)', borderRadius: 999, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {installedMsg}
          <button onClick={() => setInstalledMsg('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
        </span>
      )}
      <input
        ref={fileRef} type="file" accept=".json,.apollo.json,application/json" style={{ display: 'none' }}
        onChange={async e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try { applyPatch(JSON.parse(await f.text()) as Partial<ApolloPatch>) } catch { /* invalid file */ }
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Share: publish the patch to the Community feed (kind 'patch', app 'apollo')
// with a rendered audio preview so anyone can listen before installing.

function ShareButton() {
  const ctx = useApollo()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [desc, setDesc] = useState('')

  const usesSamples = (p: ApolloPatch): boolean =>
    p.oscs.some(o => o.enabled && (
      (o.engine === 'sample' && o.smp.sampleId) ||
      (o.engine === 'granular' && o.gran.sampleId) ||
      (o.engine === 'spectral' && o.spec.sampleId) ||
      (o.engine === 'multisample' && o.ms?.zones?.length)
    )) || (p.noise.enabled && !!p.noise.sampleId)

  const share = async () => {
    setBusy('Rendering preview…')
    setDone('')
    try {
      await ctx.start()
      const p = ctx.patch
      const patchCopy = JSON.parse(JSON.stringify(p)) as ApolloPatch
      patchCopy.clipMode = false
      const seconds = p.arp.on ? 5 : 4.2
      const notes = [{ t: 0.03, dur: p.arp.on ? seconds - 1.8 : 2, note: 48, vel: 0.9 }]
      const buf = await ctx.engine.renderToBuffer(patchCopy, notes, seconds)
      setBusy('Publishing…')
      const id = await shareAppItem({
        kind: 'patch',
        appSlug: 'apollo',
        name: p.name?.trim() || 'Untitled patch',
        description: desc.trim(),
        payload: { patch: patchCopy, usesSamples: usesSamples(p) },
        previewBlob: audioBufferToWav(buf),
      })
      setDone('Shared! Opening…')
      window.open(`/community/${id}`, '_blank')
    } catch (e) {
      setDone(e instanceof Error ? e.message : 'Share failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <ToggleBtn on={open} label="Share" title="Publish this patch to the Community (with an audio preview)" onClick={() => { setOpen(!open); setDone('') }} />
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 200, minWidth: 250,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          padding: 10, display: 'flex', flexDirection: 'column', gap: 7, boxShadow: '0 8px 26px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Share “{ctx.patch.name || 'Untitled'}” to Community
          </div>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="What does it sound like? (optional)"
            rows={2}
            maxLength={500}
            style={{ fontSize: 11, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit' }}
          />
          {usesSamples(ctx.patch) && (
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              ⚠︎ This patch uses samples. Listeners hear your rendered preview; the installed
              patch loads its synthesis settings but not your sample audio (yet).
            </div>
          )}
          {busy
            ? <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{busy}</div>
            : <ToggleBtn on={false} label="Publish patch" onClick={() => { void share() }} />}
          {done && <div style={{ fontSize: 10, color: 'var(--success)' }}>{done}</div>}
          <div style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>Anyone can listen; one click installs it into their Apollo.</div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Share a preset PACK: pick several saved presets, publish them as one
// installable Community item (kind 'patchpack'). Anyone can install the whole
// set into their Apollo with one click.

function SharePackButton({ userPresets }: { userPresets: UserPreset[] }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [packName, setPackName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const toggle = (name: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const publish = async () => {
    const chosen = userPresets.filter(u => picked.has(u.name))
    if (!chosen.length) { setDone('Pick at least one preset.'); return }
    setBusy(true); setDone('')
    try {
      const id = await shareAppItem({
        kind: 'patchpack',
        appSlug: 'apollo',
        name: packName.trim() || 'Apollo preset pack',
        description: desc.trim(),
        payload: { presets: chosen },
      })
      setDone('Shared! Opening…')
      window.open(`/community/${id}`, '_blank')
    } catch (e) {
      setDone(e instanceof Error ? e.message : 'Share failed — are you signed in?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <ToggleBtn on={open} label="Share preset pack…" title="Publish several saved presets as one installable pack" onClick={() => { setOpen(!open); setDone('') }} />
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 200, minWidth: 260, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          padding: 10, display: 'flex', flexDirection: 'column', gap: 7, boxShadow: '0 8px 26px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Share a preset pack to Community
          </div>
          {userPresets.length === 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Save some presets first (the Save button) — a pack is a bundle of your saved presets.
            </div>
          )}
          {userPresets.map(u => (
            <label key={u.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(u.name)} onChange={() => toggle(u.name)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
            </label>
          ))}
          {userPresets.length > 0 && (
            <>
              <input
                value={packName}
                onChange={e => setPackName(e.target.value)}
                placeholder="Pack name"
                maxLength={120}
                style={{ fontSize: 11, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="What's inside? (optional)"
                rows={2}
                maxLength={500}
                style={{ fontSize: 11, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit' }}
              />
              <ToggleBtn on={false} label={busy ? 'Publishing…' : `Publish ${picked.size || ''} preset${picked.size === 1 ? '' : 's'}`} onClick={() => { if (!busy) void publish() }} />
            </>
          )}
          {done && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{done}</div>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bounce: offline-render the patch and save into the Sound Library (usable
// across 100Lights) or download as WAV.

function BounceButton() {
  const ctx = useApollo()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')

  const source = getApolloSourceSample()

  const bounce = async (mode: 'note' | 'clip', dest: 'library' | 'download' | 'replace') => {
    setBusy('Rendering…')
    setDone('')
    try {
      await ctx.start()
      const p = ctx.patch
      let notes: { t: number; dur: number; note: number; vel: number }[] = []
      let seconds = 4
      const patchCopy = JSON.parse(JSON.stringify(p)) as ApolloPatch
      if (mode === 'clip' && p.activeClip >= 0 && p.clips[p.activeClip]) {
        const clip = p.clips[p.activeClip]
        patchCopy.clipMode = true
        seconds = (clip.lengthBeats * 60 / p.global.bpm) * 2 + 2
      } else {
        notes = [{ t: 0.03, dur: p.arp.on ? seconds - 1.8 : 2, note: 48, vel: 0.9 }]
        seconds = p.arp.on ? 5 : 4.2
        patchCopy.clipMode = false
        if (dest === 'replace' && source) {
          // render the full processed source (held for its whole length + FX tail)
          const smp = ctx.engine.samples.get(source.id)
          const dur = smp ? smp.len / smp.sr : 2
          notes = [{ t: 0.03, dur, note: p.oscs[0].smp.rootKey ?? 60, vel: 0.9 }]
          seconds = Math.max(3, dur + 2)
        }
      }
      const buf = await ctx.engine.renderToBuffer(patchCopy, notes, seconds)
      const name = `${p.name || 'Apollo'} ${mode === 'clip' ? 'clip' : 'note'}`
      if (dest === 'replace' && source) {
        const ok = await overwriteLibrarySample(source.id, buf)
        setDone(ok ? `Replaced “${source.name}” in the library` : 'Original no longer in the library')
      } else if (dest === 'library') {
        await saveBounceToLibrary(name, buf)
        setDone('Saved to Sound Library → Apollo Bounces')
      } else {
        const blob = audioBufferToWav(buf)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${name}.wav`
        a.click()
        URL.revokeObjectURL(a.href)
        setDone('Downloaded')
      }
    } catch (e) {
      setDone(e instanceof Error ? e.message : 'Bounce failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <ToggleBtn on={open} label="⭳ Bounce" title="Render this patch to audio" onClick={() => { setOpen(!open); setDone('') }} />
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 200, minWidth: 210,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          padding: 8, display: 'flex', flexDirection: 'column', gap: 5, boxShadow: '0 8px 26px rgba(0,0,0,0.5)',
        }}>
          {busy
            ? <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 4 }}>{busy}</div>
            : (
              <>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Note (C3{ctx.patch.arp.on ? ' + arp' : ''})</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <ToggleBtn on={false} label="→ Library" onClick={() => { void bounce('note', 'library') }} />
                  <ToggleBtn on={false} label="Download" onClick={() => { void bounce('note', 'download') }} />
                </div>
                {source && (
                  <ToggleBtn
                    on={false}
                    label={`Replace “${source.name.slice(0, 18)}”`}
                    title="Overwrite the library sound this session opened — every project using it hears the new take"
                    onClick={() => { void bounce('note', 'replace') }}
                  />
                )}
                {ctx.patch.activeClip >= 0 && ctx.patch.clips[ctx.patch.activeClip] && (
                  <>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Clip “{ctx.patch.clips[ctx.patch.activeClip].name}” ×2</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <ToggleBtn on={false} label="→ Library" onClick={() => { void bounce('clip', 'library') }} />
                      <ToggleBtn on={false} label="Download" onClick={() => { void bounce('clip', 'download') }} />
                    </div>
                  </>
                )}
              </>
            )}
          {done && <div style={{ fontSize: 10, color: 'var(--success)', padding: 2 }}>{done}</div>}
          <div style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>Library bounces appear in the studio’s Sound Library.</div>
        </div>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = {
  background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
  borderRadius: 6, width: 22, height: 22, fontSize: 10, cursor: 'pointer', padding: 0,
}
