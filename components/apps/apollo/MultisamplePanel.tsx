'use client'
// Multisample-engine editor: key/velocity zone table, SFZ import, zone add
// from library/upload, key-range visualization.

import React, { useRef, useState } from 'react'
import { useApollo, ToggleBtn, UI } from './ApolloContext'
import { LibrarySourcePicker } from '@/components/editor/SoundCreate'
import type { LibraryEntry } from '@/lib/sound-library'
import { decodeFileAudio } from '@/lib/media-import'
import { parseSfz, matchSfzFiles } from '@/lib/apollo/sfz'
import type { MultisampleZone } from '@/lib/apollo/patch'

const inputStyle: React.CSSProperties = {
  width: 44, background: 'var(--bg-surface)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 4, padding: '1px 3px', fontSize: 10,
}

const ZONE_COLORS = [UI.blue, UI.green, UI.yellow, '#e07d7d', '#b07de0', '#7dd8e0']

export default function MultisamplePanel() {
  const ctx = useApollo()
  const i = ctx.selectedOsc
  const cfg = ctx.patch.oscs[i].ms
  const [pickerOpen, setPickerOpen] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const sfzRef = useRef<HTMLInputElement>(null)

  const setZone = (zi: number, field: keyof MultisampleZone, value: number) => {
    ctx.update(p => {
      const z = p.oscs[i].ms.zones[zi]
      if (z) (z as unknown as Record<string, number | string>)[field] = value
    })
  }

  const addZoneFromBuffer = async (buf: AudioBuffer, name: string) => {
    await ctx.start()
    const id = 'user_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
    ctx.engine.loadSample(id, name, buf)
    ctx.update(p => {
      p.oscs[i].ms.zones.push({ sampleId: id, loKey: 0, hiKey: 127, loVel: 0, hiVel: 127, rootKey: 60, tune: 0, gain: 0, loopMode: 'off', loopStart: 0, loopEnd: 1 })
      if (!p.oscs[i].ms.name) p.oscs[i].ms.name = name
    })
    setPickerOpen(false)
  }

  const importSfz = async (files: FileList) => {
    setErr('')
    const all = Array.from(files)
    const sfzFile = all.find(f => f.name.toLowerCase().endsWith('.sfz'))
    if (!sfzFile) { setErr('Select the .sfz file together with its audio files'); return }
    try {
      await ctx.start()
      const regions = parseSfz(await sfzFile.text())
      if (!regions.length) { setErr('No <region> entries found'); return }
      const matched = matchSfzFiles(regions, all)
      const zones: MultisampleZone[] = []
      const loadedByPath = new Map<string, { id: string; len: number }>()
      let done = 0
      for (const r of regions) {
        const f = matched.get(r.sample)
        if (!f) continue
        setBusy(`Loading ${++done}/${matched.size}…`)
        let rec = loadedByPath.get(r.sample)
        if (!rec) {
          const buf = await decodeFileAudio(f)
          const id = 'sfz_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
          ctx.engine.loadSample(id, f.name.replace(/\.[^.]+$/, ''), buf)
          rec = { id, len: buf.length }
          loadedByPath.set(r.sample, rec)
        }
        zones.push({
          sampleId: rec.id, loKey: r.loKey, hiKey: r.hiKey, loVel: r.loVel, hiVel: r.hiVel,
          rootKey: r.rootKey, tune: r.tune, gain: r.gain, loopMode: r.loopMode,
          loopStart: rec.len > 0 ? r.loopStart / rec.len : 0,
          loopEnd: rec.len > 0 && r.loopEnd > 0 ? Math.min(1, r.loopEnd / rec.len) : 1,
        })
      }
      if (!zones.length) { setErr('SFZ regions found but no matching audio files were selected'); return }
      ctx.update(p => {
        p.oscs[i].ms.zones = zones
        p.oscs[i].ms.name = sfzFile.name.replace(/\.sfz$/i, '')
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'SFZ import failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* key range visualization */}
      <div style={{ position: 'relative', height: 22, background: UI.inset, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        {cfg.zones.map((z, zi) => (
          <div key={zi} style={{
            position: 'absolute', top: 2 + (zi % 3) * 6, height: 5,
            left: `${(z.loKey / 127) * 100}%`, width: `${Math.max(1, ((z.hiKey - z.loKey) / 127) * 100)}%`,
            background: ZONE_COLORS[zi % ZONE_COLORS.length], borderRadius: 2, opacity: 0.85,
          }} title={`${z.loKey}–${z.hiKey} root ${z.rootKey}`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600 }}>{cfg.name || 'No multisample'} · {cfg.zones.length} zones</span>
        <ToggleBtn on={false} label="+ Add Zone" onClick={() => setPickerOpen(true)} />
        <ToggleBtn on={false} label="Import SFZ…" title="Select the .sfz and its audio files together" onClick={() => sfzRef.current?.click()} />
        <input
          ref={sfzRef} type="file" multiple style={{ display: 'none' }}
          accept=".sfz,audio/*,.wav,.flac,.ogg,.mp3,.aif,.aiff"
          onChange={e => { if (e.target.files?.length) void importSfz(e.target.files); e.target.value = '' }}
        />
        {busy && <span style={{ fontSize: 10, color: 'var(--accent)' }}>{busy}</span>}
        {err && <span style={{ fontSize: 10, color: 'var(--error)' }}>{err}</span>}
      </div>
      {cfg.zones.length > 0 && (
        <div style={{ overflowX: 'auto', maxHeight: 180, overflowY: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 10, color: 'var(--text-secondary)', width: '100%' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                {['Sample', 'Lo', 'Hi', 'LoV', 'HiV', 'Root', 'Tune', 'Gain', ''].map(hd => <th key={hd} style={{ padding: '2px 4px', fontWeight: 600 }}>{hd}</th>)}
              </tr>
            </thead>
            <tbody>
              {cfg.zones.map((z, zi) => (
                <tr key={zi} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '2px 4px', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ctx.engine.samples.get(z.sampleId)?.name || z.sampleId}
                  </td>
                  {(['loKey', 'hiKey', 'loVel', 'hiVel', 'rootKey', 'tune', 'gain'] as const).map(f => (
                    <td key={f} style={{ padding: '1px 2px' }}>
                      <input
                        type="number" value={z[f]} style={inputStyle}
                        onChange={e => setZone(zi, f, Number(e.target.value))}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      onClick={() => ctx.update(p => { p.oscs[i].ms.zones = p.oscs[i].ms.zones.filter((_, j) => j !== zi) })}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pickerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPickerOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, width: 'min(520px, 92vw)', maxHeight: '80vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Add zone sample</div>
            <LibrarySourcePicker
              onPick={(buf: AudioBuffer, entry: LibraryEntry) => { void addZoneFromBuffer(buf, entry.name) }}
              onError={(msg: string) => setErr(msg)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
