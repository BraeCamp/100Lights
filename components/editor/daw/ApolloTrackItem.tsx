'use client'

// The hosted track's own clip, playing inside Apollo.
//
// Apollo's worklet already contains a clip sequencer (it loops patch.clips
// [patch.activeClip] whenever patch.clipMode is on), so nothing here schedules
// notes — we hand it the track's chord progression and switch it on. That is
// also why playback loops for free.
//
// Apollo runs its own AudioContext, separate from the DAW's, so this is an
// audition of the item rather than a synchronised second voice against
// Beacon's transport. It matches the check-out model: the item travels to
// Apollo, you shape it there, the result comes back.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip, isMidiClip, type AudioClip, type MidiClip, type MidiNote } from '@/lib/daw-types'
import { notesToApollo } from '@/lib/apollo/checkout'
import { SAMPLE_ENGINES, clipSampleId, patchWithClipSource } from '@/lib/apollo/daw-sample'
import { ApolloLfoBake } from './ApolloLfoBake'
import { chordFromNotes, printArp } from '@/lib/apollo/daw-arp'
import { getApolloEngine } from '@/lib/apollo/engine-client'
import type { ApolloPatch, ClipConfig, OscEngine } from '@/lib/apollo/patch'

/** Read-only note strip. Scales to the clip's own pitch range rather than the
 *  full 0..127, which is the only way a few-pixel-tall strip stays legible. */
export function NoteStrip({ notes, lengthBeats, height = 44, playhead, color = 'var(--accent, #4aa9ff)' }: {
  notes: MidiNote[]
  lengthBeats: number
  height?: number
  /** 0..1 across the strip, or null when stopped. */
  playhead?: number | null
  color?: string
}) {
  const span = Math.max(1, lengthBeats)
  // Math.min(...[]) is Infinity, so an empty clip must not reach the scaling.
  const pitches = notes.map(n => n.pitch)
  const minPitch = pitches.length ? Math.min(...pitches) : 60
  const maxPitch = pitches.length ? Math.max(...pitches) : 72
  const range = Math.max(1, maxPitch - minPitch)
  const noteH = Math.max(2, Math.min((height / (range + 2)) * 0.8, 8))
  const usableH = Math.max(1, height - noteH - 4)
  return (
    <div
      data-apollo-notestrip
      style={{
        position: 'relative', height, flex: 1, minWidth: 0, overflow: 'hidden',
        background: 'var(--bg-deep, #06080a)', border: '1px solid var(--border, #262c35)', borderRadius: 5,
      }}
    >
      {/* bar lines, so the progression reads in musical time */}
      {Array.from({ length: Math.max(1, Math.ceil(span / 4)) }, (_, i) => (
        <div key={i} style={{
          position: 'absolute', left: `${((i * 4) / span) * 100}%`, top: 0, bottom: 0,
          width: 1, background: 'var(--border, #262c35)', opacity: 0.6,
        }} />
      ))}
      {notes.map(n => (
        <div key={n.id} style={{
          position: 'absolute',
          left: `${(n.startBeat / span) * 100}%`,
          width: `${Math.max(0.4, (n.durationBeats / span) * 100)}%`,
          top: maxPitch === minPitch ? (height - noteH) / 2 : 2 + ((maxPitch - n.pitch) / range) * usableH,
          height: noteH, borderRadius: 1, background: color,
          opacity: 0.35 + 0.65 * Math.min(1, n.velocity / 127),
        }} />
      ))}
      {playhead != null && (
        <div data-apollo-playhead style={{
          position: 'absolute', left: `${Math.min(1, Math.max(0, playhead)) * 100}%`, top: 0, bottom: 0,
          width: 1.5, background: '#fff', opacity: 0.85, pointerEvents: 'none',
        }} />
      )}
      {!notes.length && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: 9, letterSpacing: 0.4, color: 'var(--text-muted, #8b93a0)',
        }}>NO NOTES ON THIS TRACK</div>
      )}
    </div>
  )
}

/** The clip Apollo hosts for a track: the earliest arrangement clip, else the
 *  first session-grid clip. Session clips matter because a track being built in
 *  the clip launcher has no arrangement clip at all yet. */
export function trackItemClip(
  arrangementClips: { trackId: string; startBeat: number }[],
  sessionGrid: Record<string, (unknown | null)[]>,
  trackId: string,
): MidiClip | null {
  const arr = (arrangementClips as unknown[])
    .filter((c): c is MidiClip => {
      const cl = c as MidiClip
      return cl.trackId === trackId && isMidiClip(cl as never)
    })
    .sort((a, b) => a.startBeat - b.startBeat)
  if (arr.length) return arr[0]
  for (const slot of sessionGrid[trackId] ?? []) {
    if (slot && isMidiClip(slot as never)) return slot as MidiClip
  }
  return null
}

export function useApolloTrackItem(trackId: string, getPatch?: () => unknown) {
  const { project, engine: daw, dispatch } = useDaw()
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState(0)
  const engine = useMemo(() => getApolloEngine(), [])
  const playingRef = useRef(false)
  playingRef.current = playing

  const clip = useMemo(
    () => trackItemClip(project.arrangementClips as never, project.sessionGrid as never, trackId),
    [project.arrangementClips, project.sessionGrid, trackId],
  )

  // A looping clip tiles its pattern, so the loop length is what repeats.
  const lengthBeats = clip
    ? Math.max(1, clip.loopEnabled && clip.loopLengthBeats ? clip.loopLengthBeats : clip.durationBeats)
    : 0
  const notes = useMemo(
    () => (clip ? clip.notes.filter(n => n.startBeat < lengthBeats) : []),
    [clip, lengthBeats],
  )

  /** The clip in Apollo's own shape, ready to drop into a patch. */
  const apolloClip: ClipConfig | null = useMemo(() => (
    clip && notes.length
      ? { id: clip.id, name: clip.name ?? 'Track item', lengthBeats, notes: notesToApollo(notes), automation: [] }
      : null
  ), [clip, notes, lengthBeats])

  // Apollo's engine is a singleton the card's provider will otherwise init
  // against a brand-new AudioContext of its own. Two contexts means two clocks
  // and two output paths for one instrument, so claim it for the DAW's graph
  // first — init() is a no-op once ready, and whoever gets there first decides.
  useEffect(() => { void engine.init({ ctx: daw.ctx, destination: daw.masterGain, analyse: true }) }, [engine, daw])

  // Follow Apollo's clock for the playhead. The worklet owns the beat; the UI
  // only reads it off the meters message.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => { setBeat(engine.meters.beat); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, engine])

  const stop = useCallback(() => {
    setPlaying(false)
    engine.setTransport({ playing: false })
    engine.allOff()
  }, [engine])

  const toggle = useCallback(async () => {
    if (playingRef.current) { stop(); return }
    if (!apolloClip) return
    // post() drops messages when there is no worklet node yet, so a transport
    // sent before init is silently lost and nothing ever plays. init() is
    // idempotent, and this runs from a click, which is the gesture the
    // AudioContext needs anyway.
    await engine.init({ ctx: daw.ctx, destination: daw.masterGain, analyse: true })
    // The worklet returns early on every block until it has a patch — no
    // voices, no sequencer, not even a meters post. ApolloProvider only sends
    // one from its own start() gesture, which never happens when Beacon is
    // driving, so the host sends it here. Without this the synth is inert and
    // looks, from the outside, exactly like a dead transport.
    const current = getPatch?.()
    if (current) engine.sendPatch(current as ApolloPatch)
    engine.resume()
    void daw.ctx.resume()
    engine.setTransport({ playing: true, bpm: project.tempo, beat: 0 })
    setPlaying(true)
  }, [apolloClip, engine, project.tempo, stop, daw, getPatch])

  // Never leave the synth running after the window goes away.
  useEffect(() => () => { if (playingRef.current) { engine.setTransport({ playing: false }); engine.allOff() } }, [engine])
  // Retargeting to another track must not keep playing the previous item.
  useEffect(() => { if (playingRef.current) stop() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [trackId])

  // Audio on this track that Apollo could take as an oscillator source.
  const audioClips = useMemo(
    () => (project.arrangementClips as unknown[])
      .filter((c): c is AudioClip => {
        const cl = c as AudioClip
        return cl.trackId === trackId && isAudioClip(cl as never)
      })
      .sort((a, b) => a.startBeat - b.startBeat),
    [project.arrangementClips, trackId],
  )

  const [loading, setLoading] = useState<string | null>(null)

  /**
   * Hand a Beacon audio clip to Apollo as oscillator 1's source, and make that
   * the TRACK's instrument — so the clip is playable from the piano roll in
   * Beacon's own playback, not merely auditionable inside the Apollo window.
   *
   * Returns the patch the card should adopt, or null if the clip's audio could
   * not be decoded (a dead blob: URL after a reload, typically).
   */
  const sendClipToApollo = useCallback(async (clip: AudioClip, oscEngine: OscEngine): Promise<ApolloPatch | null> => {
    const base = getPatch?.() as ApolloPatch | undefined
    if (!base) return null
    setLoading(clip.id)
    try {
      await engine.init({ ctx: daw.ctx, destination: daw.masterGain, analyse: true })
      const buf = await daw.loadClipBuffer(clip)
      if (!buf) return null
      const id = clipSampleId(clip.id)
      engine.loadSample(id, clip.name || 'Clip', buf)
      // Persist it into Apollo's sample library too. Beacon's per-track engine
      // calls restorePatchSamples on load, and it can only restore what the
      // library holds — without this the instrument survives a reload as a
      // patch pointing at a sample that no longer exists, and plays silence.
      const { persistApolloSample, persistApolloSpectral } = await import('@/lib/apollo/sample-store')
      await persistApolloSample(id, clip.name || 'Clip', buf).catch(() => {})

      // The spectral engine reads an FFT analysis, not the raw buffer — handed
      // only a sample it renders pure silence. Analyse up front so the option
      // is real rather than a button that does nothing.
      if (oscEngine === 'spectral') {
        const { analyzeSpectralInWorker } = await import('@/lib/apollo/spectral')
        const mono = buf.getChannelData(0)
        const an = await analyzeSpectralInWorker(new Float32Array(mono), buf.sampleRate)
        engine.loadSpectralData(id, an)
        await persistApolloSpectral(id, clip.name || 'Clip', an).catch(() => {})
      }

      const next = patchWithClipSource(base, id, oscEngine)
      engine.sendPatch(next)

      // The instrument gets the VOICE only — the track's own effect chain still
      // applies downstream, and storing the FX here as well would process it
      // twice.
      const voice: ApolloPatch = JSON.parse(JSON.stringify(next))
      voice.fxMain = []; voice.fxBus1 = []; voice.fxBus2 = []
      dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'apollo', params: voice } as never })
      return next
    } finally {
      setLoading(null)
    }
  }, [engine, daw, getPatch, dispatch, trackId])

  const loopBeat = lengthBeats ? beat % lengthBeats : 0
  // ApolloProvider takes the host patch as a snapshot on mount and never reads
  // the prop again, so an item edited in Beacon while the window is open would
  // otherwise never reach the synth. The host keys the card on this.
  const itemKey = clip
    ? `${clip.id}:${notes.length}:${lengthBeats}:${notes.reduce((a, n) => a + n.pitch * 31 + n.startBeat * 7 + n.durationBeats, 0)}`
    : 'none'
  return {
    clip, notes, lengthBeats, apolloClip, playing, toggle, stop, itemKey,
    audioClips, sendClipToApollo, loadingClip: loading, sampleEngines: SAMPLE_ENGINES,
    /** 0..1 across the strip. */
    playhead: playing && lengthBeats ? loopBeat / lengthBeats : null,
    /** Apollo's loop position mapped onto the arrangement timeline, so moves
     *  captured here land on the same beats the clip occupies in Beacon. */
    timelineBeat: () => (clip && lengthBeats && playingRef.current ? clip.startBeat + loopBeat : null),
  }
}

/** The footer strip: the hosted item, its transport, and motion capture.
 *  Capture lives here rather than in the header because it only means anything
 *  while this clip is looping — the two controls belong together. */
export function ApolloTrackItemBar({ item, trackName, canPlay, recording, onToggleRecord, lanes, onRevert, onRevertAll, onPatch, patch, trackId }: {
  item: ReturnType<typeof useApolloTrackItem>
  trackName: string
  canPlay: boolean
  recording: boolean
  onToggleRecord: () => void
  lanes: { id: string; label: string; parameter: string }[]
  onRevert: (laneId: string) => void
  onRevertAll: () => void
  /** A patch the card must adopt (sending a clip rewrites osc 1). */
  onPatch: (p: unknown) => void
  /** The live patch, for reading the LFO shapes out of. */
  patch: unknown
  trackId: string
}) {
  const playable = canPlay && !!item.apolloClip
  const why = !item.clip ? `${trackName} has no MIDI clip to play`
    : !item.notes.length ? 'This clip has no notes yet'
    : !canPlay ? 'This track\u2019s instrument is a sampled one, which Apollo cannot voice \u2014 the clip still shows, but Apollo has no sound to play it with'
    : 'Loop this track\u2019s notes through the patch'

  const btn = (on: boolean, tone?: string): React.CSSProperties => ({
    height: 22, padding: '0 9px', borderRadius: 5, cursor: 'pointer', flex: 'none',
    fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
    background: on ? (tone ?? 'var(--accent, #4aa9ff)') : 'transparent',
    color: on ? '#0b0d10' : 'var(--text-muted, #8b93a0)',
    border: `1px solid ${on ? (tone ?? 'var(--accent, #4aa9ff)') : 'var(--border, #262c35)'}`,
  })

  return (
    <div data-apollo-trackitem style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px',
      background: 'var(--bg-panel, #0d1014)', border: '1px solid var(--border, #262c35)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: 'var(--text-primary, #dbe1e8)' }}>
          TRACK ITEM
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted, #8b93a0)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.clip ? (item.clip.name || trackName) : `${trackName} \u2014 no clip`}
          {item.notes.length > 0 && ` \u00b7 ${item.notes.length} notes \u00b7 ${Math.max(1, Math.round(item.lengthBeats / 4))} bars`}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={item.toggle}
          disabled={!playable}
          data-apollo-item-play={item.playing ? 'on' : 'off'}
          title={why}
          style={{ ...btn(item.playing), opacity: playable ? 1 : 0.4, cursor: playable ? 'pointer' : 'not-allowed' }}
        >{item.playing ? '\u25a0 Stop' : '\u25b6 Play'}</button>
        <button
          onClick={onToggleRecord}
          disabled={!playable}
          data-apollo-item-record={recording ? 'on' : 'off'}
          title="Capture the filter and effect moves you make while this plays, as graphs on this track"
          style={{ ...btn(recording, '#ef4444'), opacity: playable ? 1 : 0.4 }}
        >{recording ? '\u25cf Capturing' : '\u25cf Capture'}</button>
      </div>

      <NoteStrip notes={item.notes} lengthBeats={item.lengthBeats || 4} playhead={item.playhead} />

      {/* Audio on this track can become Apollo's oscillator — the sampler,
          granular and spectral engines all read one buffer, and Beacon has
          never had a way to hand one over. */}
      {item.audioClips.length > 0 && (
        <div data-apollo-audiosource style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, letterSpacing: 0.4, color: 'var(--text-muted, #8b93a0)' }}>
            {item.audioClips.length === 1
              ? `AUDIO: ${item.audioClips[0].name || 'clip'} \u2192`
              : `${item.audioClips.length} AUDIO CLIPS \u2014 FIRST \u2192`}
          </span>
          {item.sampleEngines.map(se => (
            <button
              key={se.id}
              data-apollo-send-clip={se.id}
              disabled={!!item.loadingClip}
              title={`${se.blurb} \u2014 loads "${item.audioClips[0].name || 'clip'}" into Apollo as oscillator 1`}
              onClick={async () => {
                const next = await item.sendClipToApollo(item.audioClips[0], se.id)
                if (next) onPatch(next)
              }}
              style={{
                height: 22, padding: '0 9px', borderRadius: 5, flex: 'none',
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                background: 'transparent', color: 'var(--text-muted, #8b93a0)',
                border: '1px solid var(--border, #262c35)',
                cursor: item.loadingClip ? 'wait' : 'pointer', opacity: item.loadingClip ? 0.5 : 1,
              }}
            >{item.loadingClip === item.audioClips[0].id ? '\u2026' : se.label}</button>
          ))}
        </div>
      )}

      <ApolloLfoBake trackId={trackId} patch={patch as never} spanBeats={item.lengthBeats || 4} />

      <ApolloArpPrint trackId={trackId} patch={patch} item={item} trackName={trackName} />

      {lanes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, letterSpacing: 0.4, color: 'var(--text-muted, #8b93a0)' }}>
            {lanes.length} captured as {lanes.length === 1 ? 'a graph' : 'graphs'} on this track
          </span>
          {lanes.map(l => (
            <button key={l.id} onClick={() => onRevert(l.id)} data-apollo-revert={l.parameter}
              title={`Drop ${l.label} and put that control back where it was`}
              style={{ ...btn(false), textTransform: 'none', fontWeight: 600 }}>{l.label} ×</button>
          ))}
          <button onClick={onRevertAll} style={{ ...btn(false), textTransform: 'none' }}>Reset all</button>
        </div>
      )}
    </div>
  )
}

/** Print Apollo's arpeggiator into a real Beacon clip.
 *
 *  The arp only exists while keys are held — nothing it plays is written down.
 *  This runs the same algorithm over the chord already on the track and commits
 *  the result as notes, so the pattern becomes something you can edit. */
function ApolloArpPrint({ trackId, patch, item, trackName }: {
  trackId: string
  patch: unknown
  item: ReturnType<typeof useApolloTrackItem>
  trackName: string
}) {
  const { project, dispatch } = useDaw()
  const [done, setDone] = useState<string | null>(null)
  const p = patch as ApolloPatch | null
  const arp = p?.arp
  const chord = useMemo(() => chordFromNotes(item.notes.map(n => n.pitch)), [item.notes])
  if (!p || !arp) return null

  const span = Math.max(1, item.lengthBeats || 4)
  const canPrint = chord.length > 0
  const preview = canPrint ? printArp(p, chord, span).length : 0

  const print = () => {
    const notes = printArp(p, chord, span)
    if (!notes.length) return
    const startBeat = item.clip ? item.clip.startBeat : 0
    dispatch({ type: 'ADD_CLIP', clip: {
      kind: 'midi', id: crypto.randomUUID(), trackId,
      name: `${trackName} arp`,
      startBeat, durationBeats: span,
      gain: 1, loopEnabled: false, reverse: false, fadeIn: 0, fadeOut: 0,
      trimStart: 0, trimEnd: 0,
      notes: notes.map(n => ({
        id: crypto.randomUUID(), pitch: n.pitch, startBeat: n.startBeat,
        durationBeats: n.durationBeats, velocity: Math.round(n.velocity * 127),
      })),
    } as never })
    setDone(`${notes.length} notes printed`)
    window.setTimeout(() => setDone(null), 2600)
  }

  return (
    <div data-apollo-arpprint style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, letterSpacing: 0.4, color: 'var(--text-muted, #8b93a0)' }}>
        {`ARP ${arp.on ? 'ON' : 'OFF'} \u00b7 ${arp.mode} \u00b7 ${arp.octaves} oct`}
      </span>
      <button
        onClick={print}
        disabled={!canPrint}
        data-apollo-arp-print
        data-apollo-arp-count={preview}
        title={canPrint
          ? `Run the arp over this track\u2019s chord and write ${preview} notes into a new clip you can edit`
          : 'Add some notes to this track first \u2014 the arp needs a chord to run over'}
        style={{
          height: 22, padding: '0 9px', borderRadius: 5, flex: 'none',
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
          background: 'transparent', color: 'var(--text-muted, #8b93a0)',
          border: '1px solid var(--border, #262c35)',
          cursor: canPrint ? 'pointer' : 'not-allowed', opacity: canPrint ? 1 : 0.4,
        }}
      >Print arp{canPrint ? ` (${preview})` : ''}</button>
      {done && <span data-apollo-arp-done style={{ fontSize: 9, color: 'var(--accent, #4aa9ff)' }}>{done}</span>}
    </div>
  )
}
