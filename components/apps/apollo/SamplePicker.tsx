'use client'
// Compact sample slot: shows the loaded sample name + modal picker pulling
// from the 100Lights sound library or an uploaded audio file.

import React, { useRef, useState } from 'react'
import { useApollo } from '@/components/apps/apollo/ApolloContext'
import { LibrarySourcePicker } from '@/components/editor/SoundCreate'
import type { LibraryEntry } from '@/lib/sound-library'
import { decodeFileAudio } from '@/lib/media-import'
import { persistApolloSample } from '@/lib/apollo/sample-store'

export type SampleTarget = 'smp' | 'gran' | 'spec' | 'noise'

export default function SamplePicker({ oscIndex, target }: { oscIndex: number; target: SampleTarget }) {
  const ctx = useApollo()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const currentId = target === 'noise'
    ? ctx.patch.noise.sampleId
    : ctx.patch.oscs[oscIndex][target].sampleId
  const currentName = currentId ? (ctx.engine.samples.get(currentId)?.name || currentId) : '— none —'

  // short audition note so a freshly loaded sample is immediately audible
  const audition = () => {
    void ctx.start().then(() => {
      ctx.engine.noteOn(60, 0.85)
      setTimeout(() => ctx.engine.noteOff(60), 900)
    })
  }

  const applyBuffer = async (buffer: AudioBuffer, name: string) => {
    setBusy(true)
    setErr('')
    try {
      await ctx.start()
      const id = 'user_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
      ctx.engine.loadSample(id, name, buffer)
      void persistApolloSample(id, name, buffer) // survive reloads via Sound Library
      ctx.update(p => {
        if (target === 'noise') p.noise.sampleId = id
        else p.oscs[oscIndex][target].sampleId = id
      })
      if (target === 'spec') await ctx.engine.ensureSpectral(id)
      setOpen(false)
      audition()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load sample')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }} title={currentName}>
        {currentName}
      </div>
      {currentId && (
        <button
          onClick={audition}
          title="Preview (plays C4 — or use the keyboard below to play it)"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >▶</button>
      )}
      <button
        onClick={() => setOpen(true)}
        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >Load…</button>
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, width: 'min(520px, 92vw)', maxHeight: '80vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Pick a sample</div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
              >{busy ? 'Loading…' : 'Upload audio file…'}</button>
              <input
                ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a" style={{ display: 'none' }}
                onChange={async e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const buf = await decodeFileAudio(f)
                    await applyBuffer(buf, f.name.replace(/\.[^.]+$/, ''))
                  } catch (er) {
                    setErr(er instanceof Error ? er.message : 'Decode failed')
                  }
                }}
              />
              {err && <div style={{ fontSize: 10, color: 'var(--error)' }}>{err}</div>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>…or pick from your sound library:</div>
            <LibrarySourcePicker
              onPick={(buf: AudioBuffer, entry: LibraryEntry) => { void applyBuffer(buf, entry.name) }}
              onError={(msg: string) => setErr(msg)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
