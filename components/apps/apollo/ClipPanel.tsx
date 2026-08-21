'use client'
// Clip sequencer: clip list + launcher, piano-roll editor with velocity and
// chance, macro automation lane, overdub recording, transport.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApollo, useMeters, Sel, Section, ToggleBtn, UI } from './ApolloContext'
import { ClipNote, ClipConfig, SCALES, uid, ClipAutoPoint } from '@/lib/apollo/patch'

const NOTE_H = 10
const LOW_NOTE = 36
const HIGH_NOTE = 96
const SNAPS = [
  { label: '1/4', beats: 1 }, { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 }, { label: '1/32', beats: 0.125 },
]

type DragState =
  | { kind: 'move'; idx: number; startBeat: number; startNote: number; origStart: number; origNote: number }
  | { kind: 'resize'; idx: number; startBeat: number; origLen: number }
  | { kind: 'chance'; idx: number; startY: number; orig: number }
  | null

export default function ClipPanel() {
  const ctx = useApollo()
  const meters = useMeters()
  const p = ctx.patch
  const clip: ClipConfig | null = p.activeClip >= 0 ? p.clips[p.activeClip] || null : null
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const autoRef = useRef<HTMLCanvasElement>(null)
  const [snapIdx, setSnapIdx] = useState(2)
  const [localNotes, setLocalNotes] = useState<ClipNote[] | null>(null)
  const [overdub, setOverdub] = useState(false)
  // Click state lives in the patch (shared with the header transport)
  const click = !!p.global.click
  const [autoLane, setAutoLane] = useState('macro1')
  const [renaming, setRenaming] = useState(-1)
  const dragRef = useRef<DragState>(null)
  const scrollNote = useRef(60)
  const recStarts = useRef(new Map<number, { beat: number; vel: number }>())
  const autoDrag = useRef(false)
  const autoPts = useRef<ClipAutoPoint[] | null>(null)
  const snap = SNAPS[snapIdx].beats
  const notes = localNotes || clip?.notes || []
  const len = clip?.lengthBeats || 4
  const playing = meters.playing

  const commitNotes = useCallback((next: ClipNote[]) => {
    setLocalNotes(null)
    ctx.update(pp => { const c = pp.clips[pp.activeClip]; if (c) c.notes = next })
  }, [ctx])

  // overdub capture from engine voice events
  useEffect(() => {
    if (!overdub || !clip) return
    const eng = ctx.engine
    const onOn = (e: Event) => {
      const d = (e as CustomEvent).detail as { note: number; fromSeq: boolean }
      if (d.fromSeq) return
      recStarts.current.set(d.note, { beat: eng.meters.beat % len, vel: 0.9 })
    }
    const onOff = (e: Event) => {
      const d = (e as CustomEvent).detail as { note: number; fromSeq: boolean }
      if (d.fromSeq) return
      const st = recStarts.current.get(d.note)
      if (!st) return
      recStarts.current.delete(d.note)
      let end = eng.meters.beat % len
      if (end <= st.beat) end = st.beat + snap
      const start = Math.round(st.beat / snap) * snap
      ctx.update(pp => {
        const c = pp.clips[pp.activeClip]
        if (c) c.notes.push({ start: start % len, len: Math.max(snap, end - st.beat), note: d.note, vel: st.vel, chance: 1 })
      })
    }
    eng.addEventListener('voiceOn', onOn)
    eng.addEventListener('voiceOff', onOff)
    return () => { eng.removeEventListener('voiceOn', onOn); eng.removeEventListener('voiceOff', onOff) }
  }, [overdub, clip, ctx, len, snap])

  const dims = () => {
    const cv = canvasRef.current
    if (!cv) return { w: 0, h: 0 }
    return { w: cv.clientWidth, h: cv.clientHeight }
  }
  const beatX = (b: number, w: number) => (b / len) * w
  const noteY = (n: number, h: number) => h - (n - scrollNote.current + 12) * NOTE_H
  const yToNote = (y: number, h: number) => Math.round((h - y) / NOTE_H) + scrollNote.current - 12
  const xToBeat = (x: number, w: number) => (x / w) * len

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    if (!clip) {
      g.fillStyle = '#666'; g.font = '11px system-ui'; g.textAlign = 'center'
      g.fillText('Create a clip to sequence', w / 2, h / 2)
      return
    }
    const scale = SCALES[p.global.scaleName] || SCALES.Minor
    // note rows
    for (let n = LOW_NOTE; n <= HIGH_NOTE; n++) {
      const y = noteY(n, h)
      if (y < -NOTE_H || y > h) continue
      const inScale = scale.includes(((n - p.global.scaleRoot) % 12 + 12) % 12)
      g.fillStyle = inScale ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.012)'
      g.fillRect(0, y - NOTE_H, w, NOTE_H - 1)
      if (n % 12 === 0) {
        g.fillStyle = 'rgba(125,224,125,0.5)'
        g.font = '7px system-ui'
        g.textAlign = 'left'
        g.fillText(`C${n / 12 - 1}`, 2, y - 2)
      }
    }
    // beat grid
    for (let b = 0; b <= len; b += snap) {
      const x = beatX(b, w)
      g.strokeStyle = b % 1 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)'
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke()
    }
    // notes
    for (const nt of notes) {
      const x = beatX(nt.start, w), y = noteY(nt.note, h)
      const nw = Math.max(3, beatX(nt.len, w))
      g.fillStyle = `rgba(61,143,239,${0.35 + nt.vel * 0.55})`
      g.globalAlpha = 0.35 + nt.chance * 0.65
      g.fillRect(x, y - NOTE_H, nw - 1, NOTE_H - 1)
      g.globalAlpha = 1
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      g.strokeRect(x + 0.5, y - NOTE_H + 0.5, nw - 2, NOTE_H - 2)
    }
    // playhead
    if (playing && p.clipMode) {
      const ph = (meters.beat % len) / len
      g.strokeStyle = UI.green
      g.lineWidth = 1.5
      g.beginPath(); g.moveTo(ph * w, 0); g.lineTo(ph * w, h); g.stroke()
      g.lineWidth = 1
    }
  }, [clip, notes, len, snap, p.global.scaleName, p.global.scaleRoot, p.clipMode, playing, meters.beat])

  useEffect(() => { draw() }, [draw, ctx.version, meters])

  // automation lane rendering
  useEffect(() => {
    const cv = autoRef.current
    if (!cv || !clip) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    const lane = autoPts.current || clip.automation.find(a => a.param === autoLane)?.points || []
    g.strokeStyle = UI.yellow
    g.lineWidth = 1.5
    g.beginPath()
    if (lane.length) {
      lane.forEach((pt, k) => {
        const x = pt.x * w, y = (1 - pt.y) * (h - 4) + 2
        if (k === 0) { g.moveTo(0, y); g.lineTo(x, y) }
        g.lineTo(x, y)
      })
      g.lineTo(w, (1 - lane[lane.length - 1].y) * (h - 4) + 2)
    } else {
      g.moveTo(0, h / 2); g.lineTo(w, h / 2)
    }
    g.stroke()
  }, [clip, autoLane, ctx.version, meters])

  const findNote = (x: number, y: number, w: number, h: number): { idx: number; nearEdge: boolean } => {
    for (let k = notes.length - 1; k >= 0; k--) {
      const nt = notes[k]
      const nx = beatX(nt.start, w), ny = noteY(nt.note, h)
      const nw = Math.max(3, beatX(nt.len, w))
      if (x >= nx && x <= nx + nw && y >= ny - NOTE_H && y <= ny) {
        return { idx: k, nearEdge: x > nx + nw - 6 }
      }
    }
    return { idx: -1, nearEdge: false }
  }

  const onDown = (e: React.PointerEvent) => {
    if (!clip) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    const { w, h } = dims()
    const { idx, nearEdge } = findNote(x, y, w, h)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (e.button === 2) { // delete
      if (idx >= 0) commitNotes(notes.filter((_, k) => k !== idx))
      return
    }
    if (idx >= 0) {
      const cur = [...notes]
      setLocalNotes(cur)
      if (e.altKey) dragRef.current = { kind: 'chance', idx, startY: e.clientY, orig: cur[idx].chance }
      else if (nearEdge) dragRef.current = { kind: 'resize', idx, startBeat: xToBeat(x, w), origLen: cur[idx].len }
      else dragRef.current = { kind: 'move', idx, startBeat: xToBeat(x, w), startNote: yToNote(y, h), origStart: cur[idx].start, origNote: cur[idx].note }
    } else {
      const start = Math.floor(xToBeat(x, w) / snap) * snap
      const note = yToNote(y, h)
      if (note < LOW_NOTE || note > HIGH_NOTE) return
      const next = [...notes, { start, len: snap, note, vel: 0.8, chance: 1 }]
      commitNotes(next)
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !localNotes) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    const { w, h } = dims()
    const next = [...localNotes]
    const nt = { ...next[d.idx] }
    if (d.kind === 'move') {
      const db = xToBeat(x, w) - d.startBeat
      nt.start = Math.max(0, Math.min(len - nt.len, Math.round((d.origStart + db) / snap) * snap))
      nt.note = Math.max(LOW_NOTE, Math.min(HIGH_NOTE, d.origNote + (yToNote(y, h) - d.startNote)))
    } else if (d.kind === 'resize') {
      const db = xToBeat(x, w) - d.startBeat
      nt.len = Math.max(snap / 2, Math.round((d.origLen + db) / (snap / 2)) * (snap / 2))
    } else {
      nt.chance = Math.max(0.05, Math.min(1, d.orig + (d.startY - e.clientY) / 100))
    }
    next[d.idx] = nt
    setLocalNotes(next)
  }
  const onUp = () => {
    if (dragRef.current && localNotes) commitNotes(localNotes)
    dragRef.current = null
  }

  const paintAuto = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    const pts = autoPts.current || [...(clip?.automation.find(a => a.param === autoLane)?.points || [])]
    autoPts.current = pts
    const existing = pts.findIndex(pt => Math.abs(pt.x - x) < 0.02)
    if (existing >= 0) pts[existing] = { x, y }
    else { pts.push({ x, y }); pts.sort((a, b) => a.x - b.x) }
  }

  return (
    <Section
      title="Clips"
      right={
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <ToggleBtn on={p.clipMode} label="Clip Launch" onClick={() => ctx.update(pp => { pp.clipMode = !pp.clipMode })} />
          <ToggleBtn
            on={playing} accent="var(--success)"
            label={playing ? '■ Stop' : '▶ Play'}
            onClick={async () => {
              await ctx.start()
              ctx.engine.setTransport({ playing: !playing, bpm: p.global.bpm, beat: 0, click })
            }}
          />
          <ToggleBtn on={click} label="Click" onClick={() => {
            // Shared with the header transport — both write the patch so the
            // two copies can never disagree.
            const next = !click
            ctx.update(d => { d.global.click = next })
            ctx.engine.setTransport({ click: next })
          }} />
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', width: 46 }}>
            {playing ? `${(Math.floor(meters.beat / 4) + 1)}.${(Math.floor(meters.beat) % 4) + 1}` : '—'}
          </span>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 8, minHeight: 0 }}>
        {/* clip list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 120, flexShrink: 0 }}>
          {p.clips.map((c, ci) => (
            <div key={c.id} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {renaming === ci ? (
                <input
                  autoFocus defaultValue={c.name}
                  onBlur={e => { setRenaming(-1); const nm = e.target.value.trim(); if (nm) ctx.update(pp => { pp.clips[ci].name = nm }) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 76, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--accent)', borderRadius: 4, fontSize: 10, padding: '2px 4px' }}
                />
              ) : (
                <button
                  onClick={() => ctx.update(pp => { pp.activeClip = ci })}
                  onDoubleClick={() => setRenaming(ci)}
                  style={{
                    flex: 1, textAlign: 'left', padding: '3px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: ci === p.activeClip ? 'var(--accent)' : 'var(--bg-surface)',
                    color: ci === p.activeClip ? '#fff' : 'var(--text-secondary)',
                    border: '1px solid ' + (ci === p.activeClip ? 'var(--accent)' : 'var(--border)'),
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >{c.name}</button>
              )}
              <button style={miniBtn} title="Duplicate" onClick={() => ctx.update(pp => {
                const src = pp.clips[ci]
                pp.clips.push({ ...structuredClone(src), id: uid(), name: src.name + ' copy' })
              })}>⧉</button>
              <button style={miniBtn} title="Delete" onClick={() => ctx.update(pp => {
                pp.clips = pp.clips.filter((_, k) => k !== ci)
                if (pp.activeClip >= pp.clips.length) pp.activeClip = pp.clips.length - 1
              })}>✕</button>
            </div>
          ))}
          <ToggleBtn on={false} label="+ Clip" onClick={() => ctx.update(pp => {
            pp.clips.push({ id: uid(), name: `Clip ${pp.clips.length + 1}`, lengthBeats: 4, notes: [], automation: [] })
            pp.activeClip = pp.clips.length - 1
            pp.clipMode = true
          })} />
        </div>
        {/* roll */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            onContextMenu={e => e.preventDefault()}
            onWheel={e => { scrollNote.current = Math.max(LOW_NOTE + 8, Math.min(HIGH_NOTE - 8, scrollNote.current + (e.deltaY > 0 ? -2 : 2))); draw() }}
            style={{ width: '100%', height: 220, display: 'block', borderRadius: 8, border: '1px solid var(--border)', cursor: 'crosshair', touchAction: 'none' }}
            title="Click adds • drag moves • right edge resizes • right-click deletes • alt-drag = chance • wheel scrolls pitch"
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Sel width={56} value={String(snapIdx)} options={SNAPS.map((s, k) => ({ value: String(k), label: s.label }))} onChange={v => setSnapIdx(Number(v))} />
            {clip && (
              <>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  Bars
                  <input type="number" min={1} max={32} value={clip.lengthBeats}
                    onChange={e => ctx.update(pp => { const c = pp.clips[pp.activeClip]; if (c) c.lengthBeats = Math.max(1, Math.min(32, Number(e.target.value))) })}
                    style={{ width: 40, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 10, padding: '1px 3px' }} />
                  <span style={{ fontSize: 8 }}>beats</span>
                </label>
                <ToggleBtn on={false} label="Conform to scale" onClick={() => ctx.update(pp => {
                  const c = pp.clips[pp.activeClip]
                  if (!c) return
                  const iv = SCALES[pp.global.scaleName] || SCALES.Minor
                  c.notes = c.notes.map(nt => {
                    const rel = ((nt.note - pp.global.scaleRoot) % 12 + 12) % 12
                    let best = iv[0], bd = 99
                    for (const s of iv) { const d = Math.min(Math.abs(s - rel), 12 - Math.abs(s - rel)); if (d < bd) { bd = d; best = s } }
                    return { ...nt, note: nt.note - rel + best }
                  })
                })} />
                <ToggleBtn on={overdub} accent="var(--error)" label="● Overdub" title="Record played notes into the clip while playing" onClick={() => setOverdub(!overdub)} />
                <ToggleBtn on={false} label="Clear" onClick={() => commitNotes([])} />
              </>
            )}
          </div>
          {clip && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Sel width={72} value={autoLane} options={Array.from({ length: 8 }, (_, k) => ({ value: `macro${k + 1}`, label: p.macroNames[k] || `Macro ${k + 1}` }))} onChange={setAutoLane} />
              <canvas
                ref={autoRef}
                onPointerDown={e => { autoDrag.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); paintAuto(e) }}
                onPointerMove={e => { if (autoDrag.current) paintAuto(e) }}
                onPointerUp={() => {
                  autoDrag.current = false
                  const pts = autoPts.current
                  autoPts.current = null
                  if (!pts) return
                  ctx.update(pp => {
                    const c = pp.clips[pp.activeClip]
                    if (!c) return
                    const lane = c.automation.find(a => a.param === autoLane)
                    if (lane) lane.points = pts
                    else c.automation.push({ param: autoLane, points: pts })
                  })
                }}
                style={{ flex: 1, height: 44, display: 'block', borderRadius: 6, border: '1px solid var(--border)', cursor: 'crosshair', touchAction: 'none' }}
                title="Draw macro automation across the clip"
              />
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

const miniBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, padding: 1,
}
