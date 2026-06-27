'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getPresets, addPreset } from '@/lib/midi-presets'
import { importSoundfontToLibrary } from '@/lib/default-samples'

const SF_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM'
const sfUrl = (gmName: string) => `${SF_BASE}/${gmName}-mp3.js`

interface Instrument {
  name:        string
  folder:      string
  gmName:      string
  presetGroup: string
  description: string
}

const CATALOG: { category: string; items: Instrument[] }[] = [
  {
    category: 'Piano',
    items: [
      { name: 'Harpsichord',      folder: 'Harpsichord – All Notes',      gmName: 'harpsichord',      presetGroup: 'Piano', description: 'Bright plucked-string baroque keyboard' },
      { name: 'Honky-tonk Piano', folder: 'Honky-tonk Piano – All Notes', gmName: 'honkytonk_piano',  presetGroup: 'Piano', description: 'Out-of-tune ragtime upright' },
      { name: 'Celesta',          folder: 'Celesta – All Notes',           gmName: 'celesta',           presetGroup: 'Piano', description: 'Delicate bell-like orchestral keyboard' },
    ],
  },
  {
    category: 'Mallets',
    items: [
      { name: 'Glockenspiel', folder: 'Glockenspiel – All Notes', gmName: 'glockenspiel', presetGroup: 'Mallets', description: 'Steel bars, bright and cutting' },
      { name: 'Vibraphone',   folder: 'Vibraphone – All Notes',   gmName: 'vibraphone',   presetGroup: 'Mallets', description: 'Metal bars with tremolo motor' },
      { name: 'Marimba',      folder: 'Marimba – All Notes',      gmName: 'marimba',      presetGroup: 'Mallets', description: 'Wooden bars, warm and rounded' },
      { name: 'Xylophone',    folder: 'Xylophone – All Notes',    gmName: 'xylophone',    presetGroup: 'Mallets', description: 'Wooden bars, bright and percussive' },
      { name: 'Tubular Bells',folder: 'Tubular Bells – All Notes',gmName: 'tubular_bells',presetGroup: 'Mallets', description: 'Orchestral chime tower' },
    ],
  },
  {
    category: 'Organ',
    items: [
      { name: 'Rock Organ',    folder: 'Rock Organ – All Notes',    gmName: 'rock_organ',    presetGroup: 'Organ', description: 'Overdriven drawbar Hammond sound' },
      { name: 'Church Organ',  folder: 'Church Organ – All Notes',  gmName: 'church_organ',  presetGroup: 'Organ', description: 'Grand pipe organ with reverb tail' },
      { name: 'Reed Organ',    folder: 'Reed Organ – All Notes',    gmName: 'reed_organ',    presetGroup: 'Organ', description: 'Vintage harmonium texture' },
      { name: 'Accordion',     folder: 'Accordion – All Notes',     gmName: 'accordion',     presetGroup: 'Organ', description: 'French musette reedy texture' },
      { name: 'Harmonica',     folder: 'Harmonica – All Notes',     gmName: 'harmonica',     presetGroup: 'Organ', description: 'Blues diatonic harmonica' },
    ],
  },
  {
    category: 'Guitar',
    items: [
      { name: 'Acoustic Guitar (Nylon)',  folder: 'Acoustic Guitar (Nylon) – All Notes',  gmName: 'acoustic_guitar_nylon',  presetGroup: 'Guitar', description: 'Warm classical nylon-string' },
      { name: 'Acoustic Guitar (Steel)',  folder: 'Acoustic Guitar (Steel) – All Notes',  gmName: 'acoustic_guitar_steel',  presetGroup: 'Guitar', description: 'Bright strummed steel acoustic' },
      { name: 'Electric Guitar (Clean)',  folder: 'Electric Guitar (Clean) – All Notes',  gmName: 'electric_guitar_clean',  presetGroup: 'Guitar', description: 'Clean Fender-style tone' },
      { name: 'Electric Guitar (Muted)', folder: 'Electric Guitar (Muted) – All Notes', gmName: 'electric_guitar_muted', presetGroup: 'Guitar', description: 'Palm-muted funk chops' },
      { name: 'Overdriven Guitar',        folder: 'Overdriven Guitar – All Notes',        gmName: 'overdriven_guitar',      presetGroup: 'Guitar', description: 'Classic rock crunch' },
      { name: 'Distortion Guitar',        folder: 'Distortion Guitar – All Notes',        gmName: 'distortion_guitar',      presetGroup: 'Guitar', description: 'Heavy saturated metal tone' },
    ],
  },
  {
    category: 'Bass',
    items: [
      { name: 'Acoustic Bass',  folder: 'Acoustic Bass – All Notes',  gmName: 'acoustic_bass',  presetGroup: 'Bass', description: 'Upright double bass' },
      { name: 'Electric Bass (Finger)', folder: 'Electric Bass (Finger) – All Notes', gmName: 'electric_bass_finger', presetGroup: 'Bass', description: 'Fingerstyle electric bass' },
      { name: 'Electric Bass (Pick)',   folder: 'Electric Bass (Pick) – All Notes',   gmName: 'electric_bass_pick',   presetGroup: 'Bass', description: 'Picked electric bass, punchy attack' },
      { name: 'Slap Bass',      folder: 'Slap Bass – All Notes',      gmName: 'slap_bass_1',    presetGroup: 'Bass', description: 'Punchy percussive slap technique' },
      { name: 'Fretless Bass',  folder: 'Fretless Bass – All Notes',  gmName: 'fretless_bass',  presetGroup: 'Bass', description: 'Smooth legato fretless bass' },
    ],
  },
  {
    category: 'Strings',
    items: [
      { name: 'Cello',              folder: 'Cello – All Notes',              gmName: 'cello',              presetGroup: 'Strings', description: 'Rich bowed cello' },
      { name: 'Contrabass',         folder: 'Contrabass – All Notes',         gmName: 'contrabass',         presetGroup: 'Strings', description: 'Deep orchestral double bass' },
      { name: 'Pizzicato Strings',  folder: 'Pizzicato Strings – All Notes',  gmName: 'pizzicato_strings',  presetGroup: 'Strings', description: 'Plucked string section staccato' },
      { name: 'Orchestral Harp',    folder: 'Orchestral Harp – All Notes',    gmName: 'orchestral_harp',    presetGroup: 'Strings', description: 'Concert pedal harp, full range' },
      { name: 'String Ensemble 2',  folder: 'String Ensemble 2 – All Notes',  gmName: 'string_ensemble_2',  presetGroup: 'Strings', description: 'Slow-attack warm string section' },
      { name: 'Synth Strings',      folder: 'Synth Strings – All Notes',      gmName: 'synth_strings_1',    presetGroup: 'Strings', description: 'Cinematic synth string layer' },
    ],
  },
  {
    category: 'Brass',
    items: [
      { name: 'Trumpet',       folder: 'Trumpet – All Notes',       gmName: 'trumpet',       presetGroup: 'Brass', description: 'Bright solo trumpet' },
      { name: 'Trombone',      folder: 'Trombone – All Notes',      gmName: 'trombone',      presetGroup: 'Brass', description: 'Warm slide trombone' },
      { name: 'Tuba',          folder: 'Tuba – All Notes',          gmName: 'tuba',          presetGroup: 'Brass', description: 'Deep orchestral tuba' },
      { name: 'Muted Trumpet', folder: 'Muted Trumpet – All Notes', gmName: 'muted_trumpet', presetGroup: 'Brass', description: 'Harmon-muted jazz trumpet' },
      { name: 'French Horn',   folder: 'French Horn – All Notes',   gmName: 'french_horn',   presetGroup: 'Brass', description: 'Mellow French horn' },
      { name: 'Brass Section', folder: 'Brass Section – All Notes', gmName: 'brass_section', presetGroup: 'Brass', description: 'Full section stabs and swells' },
    ],
  },
  {
    category: 'Woodwinds',
    items: [
      { name: 'Flute',          folder: 'Flute – All Notes',          gmName: 'flute',          presetGroup: 'Woodwinds', description: 'Breathy concert flute' },
      { name: 'Piccolo',        folder: 'Piccolo – All Notes',        gmName: 'piccolo',        presetGroup: 'Woodwinds', description: 'High-register piccolo flute' },
      { name: 'Oboe',           folder: 'Oboe – All Notes',           gmName: 'oboe',           presetGroup: 'Woodwinds', description: 'Nasal double-reed oboe' },
      { name: 'English Horn',   folder: 'English Horn – All Notes',   gmName: 'english_horn',   presetGroup: 'Woodwinds', description: 'Rich alto oboe' },
      { name: 'Clarinet',       folder: 'Clarinet – All Notes',       gmName: 'clarinet',       presetGroup: 'Woodwinds', description: 'Single-reed warm and woody' },
      { name: 'Bassoon',        folder: 'Bassoon – All Notes',        gmName: 'bassoon',        presetGroup: 'Woodwinds', description: 'Low double-reed, orchestral' },
      { name: 'Alto Sax',       folder: 'Alto Sax – All Notes',       gmName: 'alto_sax',       presetGroup: 'Woodwinds', description: 'Bright alto saxophone' },
      { name: 'Tenor Sax',      folder: 'Tenor Sax – All Notes',      gmName: 'tenor_sax',      presetGroup: 'Woodwinds', description: 'Smoky jazz tenor saxophone' },
      { name: 'Soprano Sax',    folder: 'Soprano Sax – All Notes',    gmName: 'soprano_sax',    presetGroup: 'Woodwinds', description: 'Bright soprano saxophone' },
      { name: 'Pan Flute',      folder: 'Pan Flute – All Notes',      gmName: 'pan_flute',      presetGroup: 'Woodwinds', description: 'Airy pan pipes, world flavor' },
      { name: 'Shakuhachi',     folder: 'Shakuhachi – All Notes',     gmName: 'shakuhachi',     presetGroup: 'Woodwinds', description: 'Japanese bamboo flute' },
      { name: 'Whistle',        folder: 'Whistle – All Notes',        gmName: 'whistle',        presetGroup: 'Woodwinds', description: 'Tin whistle / pennywhistle' },
      { name: 'Ocarina',        folder: 'Ocarina – All Notes',        gmName: 'ocarina',        presetGroup: 'Woodwinds', description: 'Ceramic vessel flute' },
    ],
  },
  {
    category: 'World',
    items: [
      { name: 'Sitar',        folder: 'Sitar – All Notes',        gmName: 'sitar',        presetGroup: 'World', description: 'Indian classical sitar with drone' },
      { name: 'Banjo',        folder: 'Banjo – All Notes',        gmName: 'banjo',        presetGroup: 'World', description: 'American folk banjo twang' },
      { name: 'Shamisen',     folder: 'Shamisen – All Notes',     gmName: 'shamisen',     presetGroup: 'World', description: 'Japanese three-string lute' },
      { name: 'Koto',         folder: 'Koto – All Notes',         gmName: 'koto',         presetGroup: 'World', description: 'Japanese zither, pentatonic' },
      { name: 'Kalimba',      folder: 'Kalimba – All Notes',      gmName: 'kalimba',      presetGroup: 'World', description: 'African thumb piano' },
      { name: 'Bagpipe',      folder: 'Bagpipe – All Notes',      gmName: 'bagpipe',      presetGroup: 'World', description: 'Scottish highland drone' },
      { name: 'Steel Drums',  folder: 'Steel Drums – All Notes',  gmName: 'steel_drums',  presetGroup: 'World', description: 'Caribbean steel pan melody' },
      { name: 'Tinkle Bell',  folder: 'Tinkle Bell – All Notes',  gmName: 'tinkle_bell',  presetGroup: 'World', description: 'High delicate bell texture' },
    ],
  },
  {
    category: 'Synth Leads',
    items: [
      { name: 'Square Lead',   folder: 'Square Lead – All Notes',   gmName: 'lead_2_sawtooth',  presetGroup: 'Synth', description: 'Buzzy sawtooth synth lead' },
      { name: 'Calliope Lead', folder: 'Calliope Lead – All Notes', gmName: 'lead_3_calliope',  presetGroup: 'Synth', description: 'Soft flute-like lead synth' },
      { name: 'Chiff Lead',    folder: 'Chiff Lead – All Notes',    gmName: 'lead_4_chiff',     presetGroup: 'Synth', description: 'Breathy attack synth lead' },
      { name: 'Fifth Lead',    folder: 'Fifth Lead – All Notes',    gmName: 'lead_6_voice',     presetGroup: 'Synth', description: 'Synth voice unison lead' },
    ],
  },
  {
    category: 'Synth Pads',
    items: [
      { name: 'Warm Pad',     folder: 'Warm Pad – All Notes',     gmName: 'pad_2_warm',      presetGroup: 'Synth', description: 'Lush slow-attack synth pad' },
      { name: 'Polysynth Pad',folder: 'Polysynth Pad – All Notes',gmName: 'pad_3_polysynth', presetGroup: 'Synth', description: 'Glassy polysynth texture' },
      { name: 'Space Voice',  folder: 'Space Voice – All Notes',  gmName: 'pad_4_choir',     presetGroup: 'Synth', description: 'Ethereal vocal-texture pad' },
      { name: 'Bowed Glass',  folder: 'Bowed Glass – All Notes',  gmName: 'pad_5_bowed',     presetGroup: 'Synth', description: 'Bowed glass shimmer texture' },
      { name: 'Metallic Pad', folder: 'Metallic Pad – All Notes', gmName: 'pad_6_metallic',  presetGroup: 'Synth', description: 'Cold metallic pad sweep' },
      { name: 'Halo Pad',     folder: 'Halo Pad – All Notes',     gmName: 'pad_7_halo',      presetGroup: 'Synth', description: 'Haunting sci-fi halo texture' },
      { name: 'Sweep Pad',    folder: 'Sweep Pad – All Notes',    gmName: 'pad_8_sweep',     presetGroup: 'Synth', description: 'Wide sweeping synth wash' },
    ],
  },
  {
    category: 'Sound Effects',
    items: [
      { name: 'Rain',         folder: 'Rain – All Notes',         gmName: 'fx_1_rain',       presetGroup: 'Synth', description: 'Pitched rain texture' },
      { name: 'Soundtrack',   folder: 'Soundtrack – All Notes',   gmName: 'fx_2_soundtrack', presetGroup: 'Synth', description: 'Cinematic sweep FX' },
      { name: 'Crystal',      folder: 'Crystal – All Notes',      gmName: 'fx_3_crystal',    presetGroup: 'Synth', description: 'Bell-like crystal tones' },
      { name: 'Atmosphere',   folder: 'Atmosphere – All Notes',   gmName: 'fx_4_atmosphere', presetGroup: 'Synth', description: 'Wide ambient atmosphere' },
      { name: 'Sci-fi',       folder: 'Sci-fi – All Notes',       gmName: 'fx_6_goblins',    presetGroup: 'Synth', description: 'Weird goblin / sci-fi texture' },
      { name: 'Star Theme',   folder: 'Star Theme – All Notes',   gmName: 'fx_7_echoes',     presetGroup: 'Synth', description: 'Echoed sci-fi arpeggio' },
    ],
  },
]

// ── Note parsing helper (mirrors sfKeyToMidi in default-samples.ts) ────────────

const FLAT_TO_SHARP: Record<string, string> = { Cb:'B',Db:'C#',Eb:'D#',Fb:'E',Gb:'F#',Ab:'G#',Bb:'A#' }
const PC: Record<string, number> = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 }
function sfKeyToMidi(key: string): number {
  const m = key.match(/^([A-Gb#]+)(-?\d+)$/)
  if (!m) return -1
  const note = FLAT_TO_SHARP[m[1]] ?? m[1]
  const pc = PC[note]
  if (pc === undefined) return -1
  return (parseInt(m[2]) + 1) * 12 + pc
}

// ── Soundfont text parser (mirrors parseSoundfontText in default-samples.ts) ──

function parseSf(text: string): Record<string, string> {
  const assignIdx = text.lastIndexOf('= {')
  const start = assignIdx >= 0 ? text.indexOf('{', assignIdx) : text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('Parse failed')
  const raw = text.slice(start, end + 1).replace(/,\s*}$/, '}')
  return JSON.parse(raw) as Record<string, string>
}

type Status = 'idle' | 'previewing' | 'importing' | 'added' | 'error'

export default function PotentialSamplesPanel() {
  const [addedFolders, setAddedFolders] = useState<Set<string>>(new Set())
  const [statuses,     setStatuses]     = useState<Record<string, Status>>({})
  const [messages,     setMessages]     = useState<Record<string, string>>({})
  const [sfCache]      = useState<Map<string, Record<string, string>>>(() => new Map())
  const audioCtxRef    = useRef<AudioContext | null>(null)
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)

  useEffect(() => {
    const presets = getPresets()
    setAddedFolders(new Set(presets.map(p => p.folder)))
  }, [])

  const getCtx = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    return audioCtxRef.current
  }

  const fetchSf = useCallback(async (gmName: string): Promise<Record<string, string>> => {
    if (sfCache.has(gmName)) return sfCache.get(gmName)!
    const url = sfUrl(gmName)
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const text = await resp.text()
    const map = parseSf(text)
    sfCache.set(gmName, map)
    return map
  }, [sfCache])

  const preview = useCallback(async (inst: Instrument) => {
    const key = inst.gmName
    setStatuses(s => ({ ...s, [key]: 'previewing' }))
    try {
      const map = await fetchSf(inst.gmName)
      // Try C4 (MIDI 60), then A4 (69), then first available
      const tryNotes = ['C4', 'A4', 'C5', 'G4']
      let dataUrl: string | undefined
      for (const n of tryNotes) {
        if (map[n]) { dataUrl = map[n]; break }
      }
      if (!dataUrl) {
        const first = Object.values(map)[0]
        dataUrl = first
      }
      if (!dataUrl) throw new Error('No audio found')
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const binary = atob(base64)
      const bytes  = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const ctx = getCtx()
      await ctx.resume()
      const buf = await ctx.decodeAudioData(bytes.buffer)
      // Stop any current preview
      try { activeSourceRef.current?.stop() } catch { /* */ }
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start()
      src.onended = () => {
        setStatuses(s => s[key] === 'previewing' ? { ...s, [key]: addedFolders.has(inst.folder) ? 'added' : 'idle' } : s)
      }
      activeSourceRef.current = src
    } catch (e) {
      setStatuses(s => ({ ...s, [key]: 'error' }))
      setMessages(m => ({ ...m, [key]: e instanceof Error ? e.message : 'Failed' }))
      setTimeout(() => setStatuses(s => ({ ...s, [key]: 'idle' })), 2500)
    }
  }, [fetchSf, addedFolders])

  const importInstrument = useCallback(async (inst: Instrument) => {
    const key = inst.gmName
    setStatuses(s => ({ ...s, [key]: 'importing' }))
    setMessages(m => ({ ...m, [key]: 'Fetching soundfont…' }))
    try {
      let sfText: string
      if (sfCache.has(inst.gmName)) {
        // Re-encode from parsed map (already fetched for preview)
        const resp = await fetch(sfUrl(inst.gmName))
        sfText = await resp.text()
      } else {
        const resp = await fetch(sfUrl(inst.gmName))
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        sfText = await resp.text()
      }
      setMessages(m => ({ ...m, [key]: 'Importing notes…' }))
      const { count, loNote, hiNote } = await importSoundfontToLibrary(
        sfText,
        inst.folder,
        (done, total) => {
          setMessages(m => ({ ...m, [key]: `Importing ${done}/${total} notes…` }))
        },
      )
      addPreset({ name: inst.name, folder: inst.folder, loNote, hiNote, category: 'custom', group: inst.presetGroup })
      setAddedFolders(s => new Set([...s, inst.folder]))
      setStatuses(s => ({ ...s, [key]: 'added' }))
      setMessages(m => ({ ...m, [key]: `${count} notes added` }))
    } catch (e) {
      setStatuses(s => ({ ...s, [key]: 'error' }))
      setMessages(m => ({ ...m, [key]: e instanceof Error ? e.message : 'Import failed' }))
      setTimeout(() => setStatuses(s => ({ ...s, [key]: 'idle' })), 4000)
    }
  }, [sfCache])

  const C = {
    bg:     '#0f0f11',
    card:   '#161618',
    border: '#1e1e22',
    text:   '#e8e8f0',
    muted:  '#555568',
    accent: '#7c3aed',
    green:  '#22c55e',
    red:    '#ef4444',
  }

  return (
    <div>
      {CATALOG.map(({ category, items }) => (
        <div key={category} style={{ marginBottom: 32 }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>{category}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {items.map(inst => {
              const key     = inst.gmName
              const status  = statuses[key] ?? (addedFolders.has(inst.folder) ? 'added' : 'idle')
              const msg     = messages[key]
              const isAdded = status === 'added' || addedFolders.has(inst.folder)
              const busy    = status === 'previewing' || status === 'importing'

              return (
                <div key={key} style={{
                  display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px',
                  background: C.card, border: `1px solid ${isAdded ? 'rgba(34,197,94,0.25)' : C.border}`,
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>{inst.name}</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{inst.description}</div>
                    </div>
                    {isAdded && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.green, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>
                        Added
                      </span>
                    )}
                  </div>

                  {msg && (
                    <div style={{ fontSize: 9, color: status === 'error' ? C.red : C.muted }}>{msg}</div>
                  )}

                  <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                    <button
                      onClick={() => preview(inst)}
                      disabled={busy}
                      title="Preview middle C"
                      style={{
                        padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                        border: `1px solid ${C.border}`,
                        background: status === 'previewing' ? 'rgba(61,143,239,0.15)' : 'transparent',
                        color: status === 'previewing' ? '#3d8fef' : C.muted,
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}>
                      {status === 'previewing' ? '◼ Playing' : '▶ Preview'}
                    </button>

                    {!isAdded && (
                      <button
                        onClick={() => importInstrument(inst)}
                        disabled={busy}
                        title="Import all notes and add as MIDI preset"
                        style={{
                          flex: 1, padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          border: `1px solid ${status === 'importing' ? 'rgba(124,58,237,0.4)' : C.border}`,
                          background: status === 'importing' ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.08)',
                          color: status === 'importing' ? '#a78bfa' : '#7c3aed',
                          cursor: busy ? 'not-allowed' : 'pointer',
                        }}>
                        {status === 'importing' ? 'Adding…' : '+ Add to Library'}
                      </button>
                    )}
                    {isAdded && (
                      <div style={{ flex: 1, padding: '4px 10px', borderRadius: 4, fontSize: 10, color: C.green, display: 'flex', alignItems: 'center' }}>
                        ✓ In preset library
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
