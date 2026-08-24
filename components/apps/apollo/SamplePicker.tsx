'use client'
// Compact sample slot: shows the loaded sample name + modal picker pulling
// from the 100Lights sound library or an uploaded audio file.

import React, { useRef, useState } from 'react'
import { useApollo } from '@/components/apps/apollo/ApolloContext'
import { LibrarySourcePicker } from '@/components/editor/SoundCreate'
import type { LibraryEntry } from '@/lib/sound-library'
import { decodeFileAudio } from '@/lib/media-import'
import { persistApolloSample, sampleDisplayName } from '@/lib/apollo/sample-store'
import { combineBuffers, combinedName, type CombineMode } from '@/lib/apollo/sample-combine'

export type SampleTarget = 'smp' | 'gran' | 'spec' | 'noise'


const selStyle: React.CSSProperties = {
  background: 'var(--bg-surface)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px',
  fontSize: 10, fontWeight: 600,
}

export default function SamplePicker({ oscIndex, target }: { oscIndex: number; target: SampleTarget }) {
  const ctx = useApollo()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Combine mode: two picked sources become one sample. Lives inside the
  // picker on purpose — every sample slot in Apollo renders this component, so
  // building it here gives it to the sampler, granular, spectral and noise
  // slots at once, in the standalone app and in the card hosted by Beacon.
  const [combining, setCombining] = useState(false)
  const [slotA, setSlotA] = useState<{ buf: AudioBuffer; name: string } | null>(null)
  const [slotB, setSlotB] = useState<{ buf: AudioBuffer; name: string } | null>(null)
  const [mode, setMode] = useState<CombineMode>('layer')
  const [balance, setBalance] = useState(0.5)
  const [offset, setOffset] = useState(0)
  const [info, setInfo] = useState<string | null>(null)

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
      // A combine keeps the dialog up so its result line can be read; a plain
      // pick is done and gets out of the way.
      if (!combining) setOpen(false)
      audition()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load sample')
    } finally {
      setBusy(false)
    }
  }

  /** First pick fills A, second fills B, third starts over at A. */
  const takeSlot = (buf: AudioBuffer, name: string) => {
    setErr(''); setInfo(null)
    if (!slotA) { setSlotA({ buf, name }); return }
    if (!slotB) { setSlotB({ buf, name }); return }
    setSlotA({ buf, name }); setSlotB(null)
  }

  const doCombine = async () => {
    if (!slotA || !slotB) return
    setBusy(true); setErr(''); setInfo(null)
    try {
      await ctx.start()
      const audioCtx = ctx.engine.ctx
      if (!audioCtx) throw new Error('Audio engine is not running')
      const res = combineBuffers(audioCtx, slotA.buf, slotB.buf, {
        mode, balance, offsetSec: offset, normalize: true,
      })
      const name = combinedName(slotA.name, slotB.name, mode)
      await applyBuffer(res.buffer, name)
      // Say what happened to the level: summing two samples routinely needs
      // pulling down, and silently losing 6dB is confusing.
      setInfo(res.gain < 1
        ? `${name} — ${res.buffer.duration.toFixed(2)}s, turned down ${(20 * Math.log10(res.gain)).toFixed(1)}dB to fit`
        : `${name} — ${res.buffer.duration.toFixed(2)}s`)
      setSlotA(null); setSlotB(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not combine those')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <div data-apollo-sample-slot={target} data-apollo-sample-id={currentId || ''}
        style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }} title={currentName}>
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
        onClick={() => { setCombining(false); setOpen(true) }}
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
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                {combining ? 'Combine two samples' : 'Pick a sample'}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => { setCombining(c => !c); setErr(''); setInfo(null) }}
                  data-apollo-combine-toggle={combining ? 'on' : 'off'}
                  style={{
                    background: combining ? 'var(--accent)' : 'var(--bg-surface)',
                    color: combining ? 'var(--accent-contrast, #fff)' : 'var(--text-primary)',
                    border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px',
                    fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >{combining ? 'Single sample' : 'Combine two…'}</button>
                <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
            </div>
            {combining && (
              <div data-apollo-combine style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['A', slotA], ['B', slotB]] as const).map(([label, slot]) => (
                    <div key={label} data-apollo-combine-slot={label} style={{
                      flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 7,
                      background: 'var(--bg-surface)', border: `1px solid ${slot ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                      <div style={{ fontSize: 9, letterSpacing: 0.6, color: 'var(--text-muted)' }}>{label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {slot ? `${slot.name} · ${slot.buf.duration.toFixed(2)}s` : 'pick below'}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={mode} data-apollo-combine-mode
                    onChange={e => setMode(e.target.value as CombineMode)}
                    style={selStyle}
                  >
                    <option value="layer">Layer (both at once)</option>
                    <option value="sequence">Sequence (A then B)</option>
                    <option value="crossfade">Crossfade (A into B)</option>
                  </select>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    A/B
                    <input type="range" min={0} max={1} step={0.01} value={balance}
                      data-apollo-combine-balance
                      onChange={e => setBalance(Number(e.target.value))} style={{ width: 80 }} />
                  </label>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {mode === 'crossfade' ? 'FADE' : 'OFFSET'}
                    <input type="range" min={mode === 'crossfade' ? 0.01 : -1} max={2} step={0.01}
                      value={offset} data-apollo-combine-offset
                      onChange={e => setOffset(Number(e.target.value))} style={{ width: 80 }} />
                    <span style={{ minWidth: 34 }}>{offset.toFixed(2)}s</span>
                  </label>
                  <button
                    onClick={() => void doCombine()}
                    disabled={!slotA || !slotB || busy}
                    data-apollo-combine-go
                    style={{
                      background: slotA && slotB ? 'var(--accent)' : 'var(--bg-surface)',
                      color: slotA && slotB ? 'var(--accent-contrast, #fff)' : 'var(--text-muted)',
                      border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px',
                      fontSize: 10, fontWeight: 700, cursor: slotA && slotB ? 'pointer' : 'not-allowed',
                    }}
                  >{busy ? 'Combining…' : 'Combine'}</button>
                  {(slotA || slotB) && (
                    <button onClick={() => { setSlotA(null); setSlotB(null); setInfo(null) }}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}
                    >Clear</button>
                  )}
                </div>
                {info && <div data-apollo-combine-info style={{ fontSize: 10, color: 'var(--accent)' }}>{info}</div>}
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {!slotA ? 'Pick the first sample below.' : !slotB ? 'Now pick the second.' : 'Both picked — combine them.'}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
              >{busy ? 'Loading…' : 'Upload audio file…'}</button>
              <input
                ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a" style={{ display: 'none' }}
                data-apollo-sample-file
                onChange={async e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const buf = await decodeFileAudio(f)
                    const nm = f.name.replace(/\.[^.]+$/, '')
                    if (combining) { takeSlot(buf, nm); return }
                    await applyBuffer(buf, nm)
                  } catch (er) {
                    setErr(er instanceof Error ? er.message : 'Decode failed')
                  }
                }}
              />
              {err && <div style={{ fontSize: 10, color: 'var(--error)' }}>{err}</div>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>…or pick from your sound library:</div>
            <LibrarySourcePicker
              onPick={(buf: AudioBuffer, entry: LibraryEntry) => {
                if (combining) { takeSlot(buf, sampleDisplayName(entry)); return }
                void applyBuffer(buf, sampleDisplayName(entry))
              }}
              onError={(msg: string) => setErr(msg)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
